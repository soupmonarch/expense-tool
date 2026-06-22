"use client";

import { useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import {
  EXPENSE_CATEGORIES,
  TRAVEL_CATEGORIES,
  UNCLASSIFIED,
} from "@/lib/categories";

interface Row {
  id: number;
  date: string;
  time: string;
  merchant: string;
  amount: number;
  currency: string;
  merchantCategory: string;
  isForeign: boolean;
  group: string;
  category: string;
  source: string;
  confidence: number | null;
  needsReview: boolean;
  noLearn: boolean;
}

interface CancelQuestion {
  paymentId: number;
  merchant: string;
  paymentAmount: number;
  cancelAmount: number;
  proposedNet: number;
  paymentDate?: string;
  cancelDate?: string;
}

interface Stats {
  total: number;
  expense: number;
  travel: number;
  needsReview: number;
  autoVoided: number;
  cancelQuestions: number;
}

type CancelChoice = "partial" | "full" | "separate";

function fmt(n: number): string {
  return (n || 0).toLocaleString("ko-KR");
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [persistent, setPersistent] = useState(false);

  const [cancelQuestions, setCancelQuestions] = useState<CancelQuestion[]>([]);
  const [cancelChoice, setCancelChoice] = useState<Record<number, CancelChoice>>({});
  const [learnChoice, setLearnChoice] = useState<Record<number, boolean>>({});

  const [reviewOpen, setReviewOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const reviewRows = useMemo(() => (rows || []).filter((r) => r.needsReview), [rows]);

  function pickFile(f: File | null) {
    setFile(f);
    setRows(null);
    setStats(null);
    setError(null);
    setCancelQuestions([]);
    setCancelChoice({});
    setLearnChoice({});
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) pickFile(f);
  }

  async function classify() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setRows(null);
    setStats(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/classify", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);

      const newRows = data.rows as Row[];
      const questions = (data.cancelQuestions || []) as CancelQuestion[];
      setRows(newRows);
      setStats(data.stats);
      setPersistent(!!data.persistent);
      setCancelQuestions(questions);

      // Default: treat each cancellation as a partial refund (net amount).
      const cc: Record<number, CancelChoice> = {};
      for (const q of questions) cc[q.paymentId] = "partial";
      setCancelChoice(cc);

      // Default: learn every reviewed row except gateway (no-learn) rows.
      const lc: Record<number, boolean> = {};
      for (const r of newRows) if (r.needsReview) lc[r.id] = !r.noLearn;
      setLearnChoice(lc);

      if (questions.length > 0 || newRows.some((r) => r.needsReview)) setReviewOpen(true);
    } catch (err: any) {
      setError(err?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function setRowCategory(id: number, category: string) {
    setRows((prev) =>
      (prev || []).map((r) =>
        r.id === id
          ? {
              ...r,
              category,
              group: category === UNCLASSIFIED ? "unclassified" : r.group,
            }
          : r,
      ),
    );
  }

  function setCancel(id: number, choice: CancelChoice) {
    setCancelChoice((p) => ({ ...p, [id]: choice }));
  }
  function setLearn(id: number, on: boolean) {
    setLearnChoice((p) => ({ ...p, [id]: on }));
  }
  function setAllLearn(on: boolean) {
    setLearnChoice(() => {
      const next: Record<number, boolean> = {};
      for (const r of reviewRows) if (!r.noLearn) next[r.id] = on;
      return next;
    });
  }

  async function applyReview() {
    // Save only the rows the user chose to learn (per-item), excluding gateways
    // and unclassified.
    const items = reviewRows
      .filter((r) => !r.noLearn && learnChoice[r.id] && r.category && r.category !== UNCLASSIFIED)
      .map((r) => ({ merchant: r.merchant, category: r.category }));
    if (items.length > 0) {
      try {
        await fetch("/api/learn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        });
      } catch {
        /* non-fatal: still let the user download */
      }
    }
    // Category rows are now resolved; cancel choices stay in state for download.
    setRows((prev) => (prev || []).map((r) => ({ ...r, needsReview: false })));
    setReviewOpen(false);
  }

  // Apply confirmed cancellation choices to produce the final payload rows.
  function finalizeRows(): { date: string; merchant: string; amount: number; currency: string; category: string }[] {
    const qById = new Map(cancelQuestions.map((q) => [q.paymentId, q]));
    const out: Row[] = [];
    for (const r of rows || []) {
      const q = qById.get(r.id);
      if (q) {
        const choice = cancelChoice[r.id] || "partial";
        if (choice === "full") continue; // fully canceled -> drop
        if (choice === "partial") {
          const net = Math.max(0, r.amount - q.cancelAmount);
          if (net <= 0) continue;
          out.push({ ...r, amount: net });
          continue;
        }
        // "separate" -> keep the full original amount
      }
      out.push(r);
    }
    return out.map((r) => ({
      date: r.date,
      merchant: r.merchant,
      amount: r.amount,
      currency: r.currency,
      category: r.category,
    }));
  }

  async function download() {
    if (!rows) return;
    setDownloading(true);
    setError(null);
    try {
      const payload = finalizeRows();
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: payload }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "expense_claims.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  const remainingReview = (rows || []).filter((r) => r.needsReview).length;
  const hasModalContent = cancelQuestions.length > 0 || reviewRows.length > 0;

  return (
    <main style={wrap}>
      <div style={card}>
        <h1 style={title}>지출 증빙 · 변제 양식 자동 생성기</h1>
        <p style={subtitle}>
          카드 사용 내역 파일(.xls / .xlsx)을 올리면 <b>Expense</b>와 <b>Travel</b> 두 개의
          제출 양식을 만들어 ZIP으로 다운로드합니다. 카드사가 달라도 자동 인식합니다.
        </p>

        <label
          style={dragOver ? dropActive : drop}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xls,.xlsx,.csv"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            style={hiddenInput}
          />
          {file ? (
            <span>📎 {file.name}</span>
          ) : (
            <span style={mutedText}>여기로 파일을 끌어다 놓거나 클릭해서 선택하세요</span>
          )}
        </label>

        <button
          type="button"
          onClick={classify}
          disabled={!file || loading}
          style={button(!file || loading)}
        >
          {loading ? "분류 중…" : "분류하기"}
        </button>

        {error && <div style={errBox}>{error}</div>}

        {stats && (
          <div style={statBox}>
            <div>✅ 총 {fmt(stats.total)}건 분류 완료</div>
            <div>🧾 Expense: {fmt(stats.expense)}건 · ✈️ Travel: {fmt(stats.travel)}건</div>
            {stats.autoVoided > 0 && (
              <div style={mutedText}>↩️ 취소·환불 {fmt(stats.autoVoided)}건 자동 반영(제외)</div>
            )}
            {remainingReview > 0 || cancelQuestions.length > 0 ? (
              <div style={warnText}>
                ⚠️ 확인 필요
                {cancelQuestions.length > 0 ? ` · 취소확인 ${fmt(cancelQuestions.length)}건` : ""}
                {remainingReview > 0 ? ` · 분류확인 ${fmt(remainingReview)}건` : ""}
                <button type="button" style={linkBtn} onClick={() => setReviewOpen(true)}>
                  검토하기
                </button>
              </div>
            ) : (
              <div style={okText}>✅ 모든 항목 확인 완료</div>
            )}
          </div>
        )}

        {rows && (
          <button type="button" onClick={download} disabled={downloading} style={button(downloading)}>
            {downloading ? "생성 중…" : "엑셀 다운로드 (Expense + Travel)"}
          </button>
        )}

        <p style={hint}>
          💡 분류가 애매하거나 취소·환불이 있는 항목은 확인 창이 뜨고, 항목별로 체크한 분류는 서버에
          저장돼 다음부터 모두에게 자동 적용됩니다{persistent ? "" : " (공유 저장소 미설정: 현재는 임시 저장)"}.
        </p>
      </div>

      {reviewOpen && (
        <div style={overlay} onClick={() => setReviewOpen(false)}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={modalTitle}>확인이 필요한 항목</h2>
            <p style={modalSub}>
              아래 항목들을 확인해 주세요. 취소·환불 여부와 분류를 정하면 그대로 엑셀에 반영됩니다.
            </p>

            <div style={reviewList}>
              {!hasModalContent && <div style={mutedText}>확인할 항목이 없습니다.</div>}

              {cancelQuestions.length > 0 && (
                <div style={sectionLabel}>↩️ 취소·환불 확인</div>
              )}
              {cancelQuestions.map((q) => (
                <div key={"c" + q.paymentId} style={reviewItem}>
                  <div style={reviewInfo}>
                    <div style={reviewMerchant}>{q.merchant || "(가맹점명 없음)"}</div>
                    <div style={reviewMeta}>
                      결제 {fmt(q.paymentAmount)}원
                      {q.paymentDate ? " (" + q.paymentDate + ")" : ""} · 취소 {fmt(q.cancelAmount)}원
                      {q.cancelDate ? " (" + q.cancelDate + ")" : ""}
                    </div>
                    <div style={reviewQuestion}>
                      이 결제 건의 취소(환불)가 맞나요?
                    </div>
                  </div>
                  <select
                    style={select}
                    value={cancelChoice[q.paymentId] || "partial"}
                    onChange={(e) => setCancel(q.paymentId, e.target.value as CancelChoice)}
                  >
                    <option value="partial">부분취소 — 최종 {fmt(q.proposedNet)}원으로 합산</option>
                    <option value="full">전액취소 — 제외(0원)</option>
                    <option value="separate">별개 건 — 결제 {fmt(q.paymentAmount)}원 그대로</option>
                  </select>
                </div>
              ))}

              {reviewRows.length > 0 && (
                <div style={sectionRow}>
                  <div style={sectionLabel}>🯷 분류 확인</div>
                  <div style={sectionTools}>
                    학습
                    <button type="button" style={miniBtn} onClick={() => setAllLearn(true)}>모두</button>
                    <button type="button" style={miniBtn} onClick={() => setAllLearn(false)}>해제</button>
                  </div>
                </div>
              )}
              {reviewRows.map((r) => {
                const isGateway = r.source === "gateway";
                return (
                  <div key={r.id} style={reviewItem}>
                    <div style={reviewInfo}>
                      <div style={reviewMerchant}>{r.merchant || "(가맹점명 없음)"}</div>
                      <div style={reviewMeta}>
                        {r.date ? r.date + " " : ""}
                        {r.time ? r.time + " · " : (r.date ? "· " : "")}
                        {fmt(r.amount)} {r.currency}
                        {r.merchantCategory ? " · " + r.merchantCategory : ""}
                        {r.isForeign ? " · 해외" : ""}
                      </div>
                      {isGateway && (
                        <div style={gatewayNote}>
                          🔍 {r.date || ""}{r.time ? " " + r.time : ""}에 결제한 내역입니다. 결제대행사(
                          {r.merchant})만 표시되어 무엇을 결제했는지 알 수 없으니 직접 분류해 주세요.
                        </div>
                      )}
                    </div>
                    <select
                      style={select}
                      value={r.category}
                      onChange={(e) => setRowCategory(r.id, e.target.value)}
                    >
                      <optgroup label="Expense">
                        {EXPENSE_CATEGORIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Travel">
                        {TRAVEL_CATEGORIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </optgroup>
                      <option value={UNCLASSIFIED}>(미분류 유지 — 나중에)</option>
                    </select>
                    <label style={learnRow}>
                      <input
                        type="checkbox"
                        checked={isGateway ? false : !!learnChoice[r.id]}
                        disabled={isGateway}
                        onChange={(e) => setLearn(r.id, e.target.checked)}
                      />
                      <span style={isGateway ? learnTextOff : undefined}>
                        {isGateway
                          ? "결제대행 — 학습 불가 (매번 확인)"
                          : "이 분류를 모두에게 저장 (다음부터 자동)"}
                      </span>
                    </label>
                  </div>
                );
              })}
            </div>

            <div style={modalActions}>
              <button type="button" style={ghostBtn} onClick={() => setReviewOpen(false)}>
                닫기
              </button>
              <button type="button" style={primaryBtn} onClick={applyReview}>
                적용·저장
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

const wrap: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
};
const card: CSSProperties = {
  width: "100%",
  maxWidth: 560,
  background: "#fff",
  borderRadius: 16,
  padding: 32,
  boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
};
const title: CSSProperties = { fontSize: 22, margin: "0 0 8px" };
const subtitle: CSSProperties = { fontSize: 14, color: "#5f6873", lineHeight: 1.6, marginBottom: 24 };
const drop: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "2px dashed #c7ccd3",
  borderRadius: 12,
  padding: "36px 16px",
  cursor: "pointer",
  marginBottom: 16,
  fontSize: 14,
  textAlign: "center",
  transition: "all 0.15s",
};
const dropActive: CSSProperties = {
  ...drop,
  border: "2px dashed #2d6cdf",
  background: "#eef5ff",
};
function button(disabled: boolean): CSSProperties {
  return {
    width: "100%",
    padding: "12px 16px",
    borderRadius: 10,
    border: "none",
    background: disabled ? "#c7ccd3" : "#2d6cdf",
    color: "#fff",
    fontSize: 15,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    marginBottom: 12,
  };
}
const errBox: CSSProperties = {
  marginTop: 4,
  marginBottom: 12,
  padding: 12,
  borderRadius: 8,
  background: "#fdecea",
  color: "#c0392b",
  fontSize: 13,
};
const statBox: CSSProperties = {
  marginBottom: 12,
  padding: 14,
  borderRadius: 8,
  background: "#f3f5f8",
  fontSize: 13,
  lineHeight: 1.9,
};
const hint: CSSProperties = { marginTop: 8, fontSize: 12, color: "#8a9099", lineHeight: 1.6 };
const hiddenInput: CSSProperties = { display: "none" };
const mutedText: CSSProperties = { color: "#8a9099" };
const warnText: CSSProperties = { color: "#b9770e" };
const okText: CSSProperties = { color: "#1e874b" };
const linkBtn: CSSProperties = {
  border: "none",
  background: "none",
  color: "#2d6cdf",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
  textDecoration: "underline",
  padding: "0 4px",
};

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 50,
};
const modal: CSSProperties = {
  width: "100%",
  maxWidth: 640,
  maxHeight: "85vh",
  display: "flex",
  flexDirection: "column",
  background: "#fff",
  borderRadius: 16,
  padding: 24,
  boxShadow: "0 12px 48px rgba(0,0,0,0.25)",
};
const modalTitle: CSSProperties = { fontSize: 18, margin: "0 0 6px" };
const modalSub: CSSProperties = { fontSize: 13, color: "#5f6873", marginBottom: 16 };
const reviewList: CSSProperties = { overflowY: "auto", flex: 1, marginBottom: 16 };
const sectionLabel: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "#1f2329",
  margin: "12px 0 4px",
};
const sectionRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  margin: "16px 0 4px",
};
const sectionTools: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
  color: "#8a9099",
};
const miniBtn: CSSProperties = {
  border: "1px solid #c7ccd3",
  background: "#fff",
  borderRadius: 6,
  fontSize: 12,
  padding: "2px 8px",
  cursor: "pointer",
  color: "#5f6873",
};
const reviewItem: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: "12px 0",
  borderBottom: "1px solid #eef0f3",
};
const reviewInfo: CSSProperties = { display: "flex", flexDirection: "column" };
const reviewMerchant: CSSProperties = { fontSize: 14, fontWeight: 600 };
const reviewMeta: CSSProperties = { fontSize: 12, color: "#8a9099", marginTop: 2 };
const reviewQuestion: CSSProperties = { fontSize: 13, color: "#1f2329", marginTop: 4 };
const gatewayNote: CSSProperties = {
  fontSize: 12,
  color: "#b9770e",
  marginTop: 4,
  lineHeight: 1.5,
};
const select: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #c7ccd3",
  fontSize: 13,
};
const learnRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12,
  color: "#1f2329",
  cursor: "pointer",
};
const learnTextOff: CSSProperties = { color: "#b9770e" };
const modalActions: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 8 };
const ghostBtn: CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "1px solid #c7ccd3",
  background: "#fff",
  color: "#5f6873",
  fontSize: 14,
  cursor: "pointer",
};
const primaryBtn: CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "none",
  background: "#2d6cdf",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
