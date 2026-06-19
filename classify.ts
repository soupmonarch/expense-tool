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
}

interface Stats {
  total: number;
  expense: number;
  travel: number;
  needsReview: number;
  skippedCanceled: number;
}

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

  const [reviewOpen, setReviewOpen] = useState(false);
  const [shareLearning, setShareLearning] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const reviewRows = useMemo(() => (rows || []).filter((r) => r.needsReview), [rows]);

  function pickFile(f: File | null) {
    setFile(f);
    setRows(null);
    setStats(null);
    setError(null);
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
      setRows(data.rows);
      setStats(data.stats);
      setPersistent(!!data.persistent);
      if ((data.rows as Row[]).some((r) => r.needsReview)) setReviewOpen(true);
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

  async function applyReview() {
    // Save confirmed (non-unclassified) merchant->category pairs to the shared store.
    if (shareLearning) {
      const items = reviewRows
        .filter((r) => r.category && r.category !== UNCLASSIFIED)
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
    }
    // Mark reviewed rows as resolved so they leave the review list.
    setRows((prev) => (prev || []).map((r) => ({ ...r, needsReview: false })));
    setReviewOpen(false);
  }

  async function download() {
    if (!rows) return;
    setDownloading(true);
    setError(null);
    try {
      const payload = rows.map((r) => ({
        date: r.date,
        merchant: r.merchant,
        amount: r.amount,
        currency: r.currency,
        category: r.category,
      }));
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
            <span style={mutedText}>
              여기로 파일을 끌어다 놓거나 클릭해서 선택하세요
            </span>
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
            <div>✅ 총 {fmt(stats.total)}건 분류 완료{stats.skippedCanceled > 0 ? ` (취소 건 ${fmt(stats.skippedCanceled)}건 제외)` : ""}</div>
            <div>🧾 Expense: {fmt(stats.expense)}건 · ✈️ Travel: {fmt(stats.travel)}건</div>
            {remainingReview > 0 ? (
              <div style={warnText}>
                ⚠️ 확인 필요 {fmt(remainingReview)}건 —
                <button type="button" style={linkBtn} onClick={() => setReviewOpen(true)}>
                  검토하기
                </button>
              </div>
            ) : (
              <div style={okText}>✅ 모든 항목 분류 완료</div>
            )}
          </div>
        )}

        {rows && (
          <button
            type="button"
            onClick={download}
            disabled={downloading}
            style={button(downloading)}
          >
            {downloading ? "생성 중…" : "엑셀 다운로드 (Expense + Travel)"}
          </button>
        )}

        <p style={hint}>
          💡 분류가 애매한 항목은 확인 창이 뜨고, 여기서 고른 분류는 서버에 저장돼 다음부터 모두에게
          자동 적용됩니다{persistent ? "" : " (공유 저장소 미설정: 현재는 임시 저장)"}.
        </p>
      </div>

      {reviewOpen && (
        <div style={overlay} onClick={() => setReviewOpen(false)}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={modalTitle}>이 항목들은 어떤 분류가 적절한가요?</h2>
            <p style={modalSub}>
              AI가 추천한 분류가 기본 선택되어 있습니다. 필요하면 바꾸세요.
            </p>

            <div style={reviewList}>
              {reviewRows.length === 0 && <div style={mutedText}>확인할 항목이 없습니다.</div>}
              {reviewRows.map((r) => (
                <div key={r.id} style={reviewItem}>
                  <div style={reviewInfo}>
                    <div style={reviewMerchant}>{r.merchant || "(가맹점명 없음)"}</div>
                    <div style={reviewMeta}>
                      {r.date ? r.date + " · " : ""}
                      {fmt(r.amount)} {r.currency}
                      {r.merchantCategory ? " · " + r.merchantCategory : ""}
                      {r.isForeign ? " · 해외" : ""}
                    </div>
                  </div>
                  <select
                    style={select}
                    value={r.category}
                    onChange={(e) => setRowCategory(r.id, e.target.value)}
                  >
                    <optgroup label="Expense">
                      {EXPENSE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Travel">
                      {TRAVEL_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </optgroup>
                    <option value={UNCLASSIFIED}>(미분류 유지 — 나중에)</option>
                  </select>
                </div>
              ))}
            </div>

            <label style={shareRow}>
              <input
                type="checkbox"
                checked={shareLearning}
                onChange={(e) => setShareLearning(e.target.checked)}
              />
              <span>이 분류를 모두에게 저장 (다음부터 같은 가맹점은 자동 분류)</span>
            </label>

            <div style={modalActions}>
              <button type="button" style={ghostBtn} onClick={() => setReviewOpen(false)}>
                닫기
              </button>
              <button type="button" style={primaryBtn} onClick={applyReview}>
                적용{shareLearning ? " · 저장" : ""}
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
const select: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #c7ccd3",
  fontSize: 13,
};
const shareRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  color: "#1f2329",
  marginBottom: 16,
  cursor: "pointer",
};
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
