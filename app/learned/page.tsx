"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { EXPENSE_CATEGORIES, TRAVEL_CATEGORIES } from "@/lib/categories";
import { PSP_MARK } from "@/lib/gateways";

interface Gateway {
  merchant: string;
  label: string;
}

interface Entry {
  merchant: string;
  category: string;
  group: string;
}

interface HistoryItem {
  key: string;
  merchant: string;
  category: string;
  by: string;
  at: string;
  source?: string;
}

function csvCell(v: string): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// ISO 타임스탬프를 한국 시각(KST) 짧은 표기로 변환.
function fmtAt(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CategorySelect(props: {
  value: string;
  onChange: (v: string) => void;
  style?: CSSProperties;
}) {
  return (
    <select
      style={props.style}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    >
      <option value="">분류 선택…</option>
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
    </select>
  );
}

export default function LearnedPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [userName, setUserName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [persistent, setPersistent] = useState(false);
  const [q, setQ] = useState("");
  const [historyBy, setHistoryBy] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 추가 폼
  const [addMerchant, setAddMerchant] = useState("");
  const [addCategory, setAddCategory] = useState("");

  // 인라인 수정
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editMerchant, setEditMerchant] = useState("");
  const [editCategory, setEditCategory] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/learn", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "불러오기 실패");
      setEntries(data.entries || []);
      setGateways(data.gateways || []);
      setHistory(data.history || []);
      setPersistent(!!data.persistent);
    } catch (e: any) {
      setError(e?.message || "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    try {
      const saved = localStorage.getItem("expense_tool_user_name");
      if (saved) setUserName(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return entries;
    return entries.filter(
      (e) =>
        e.merchant.toLowerCase().includes(k) ||
        e.category.toLowerCase().includes(k),
    );
  }, [entries, q]);

  // 가맹점별 최근 분류자(history는 최신순이므로 첫 등장이 최신).
  const latestBy = useMemo(() => {
    const m = new Map<string, HistoryItem>();
    for (const h of history) if (!m.has(h.key)) m.set(h.key, h);
    return m;
  }, [history]);

  // 분류 기록에 등장한 작성자 목록(중복 제거, 가나다순).
  const historyAuthors = useMemo(() => {
    const set = new Set<string>();
    for (const h of history)
      set.add(h.by && h.by.trim() ? h.by.trim() : "익명");
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
  }, [history]);

  // 드롭다운에서 선택한 작성자의 기록만 표시.
  const visibleHistory = useMemo(() => {
    if (!historyBy) return history;
    return history.filter(
      (h) => (h.by && h.by.trim() ? h.by.trim() : "익명") === historyBy,
    );
  }, [history, historyBy]);

  const expenseCount = entries.filter((e) => e.group === "expense").length;
  const travelCount = entries.filter((e) => e.group === "travel").length;

  async function addEntry() {
    const merchant = addMerchant.trim();
    if (!merchant || !addCategory) {
      alert("가맹점명과 분류를 모두 입력해 주세요.");
      return;
    }
    setSaving(true);
    try {
      try {
        localStorage.setItem("expense_tool_user_name", userName.trim());
      } catch {
        /* ignore */
      }
      const res = await fetch("/api/learn", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant,
          category: addCategory,
          by: userName.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "추가 실패");
      setAddMerchant("");
      setAddCategory("");
      await load();
    } catch (e: any) {
      alert(e?.message || "추가 실패");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(e: Entry) {
    setEditKey(e.merchant);
    setEditMerchant(e.merchant);
    setEditCategory(e.category);
  }

  async function saveEdit(oldMerchant: string) {
    const merchant = editMerchant.trim();
    if (!merchant || !editCategory) {
      alert("가맹점명과 분류를 모두 입력해 주세요.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/learn", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oldMerchant,
          merchant,
          category: editCategory,
          by: userName.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "수정 실패");
      setEditKey(null);
      await load();
    } catch (e: any) {
      alert(e?.message || "수정 실패");
    } finally {
      setSaving(false);
    }
  }

  async function remove(merchant: string) {
    if (
      !confirm(
        merchant +
          " 항목을 학습 데이터에서 삭제할까요? 모든 사용자에게 적용됩니다.",
      )
    )
      return;
    setBusy(merchant);
    try {
      const res = await fetch("/api/learn", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchant }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "삭제 실패");
      setEntries((prev) => prev.filter((e) => e.merchant !== merchant));
    } catch (e: any) {
      alert(e?.message || "삭제 실패");
    } finally {
      setBusy(null);
    }
  }

  // 잘못 학습된 가맹점을 결제대행사로 재분류(카테고리 학습 제거 + PSP 목록으로 이동).
  async function convertToGateway(merchant: string) {
    if (
      !confirm(
        merchant +
          " 항목을 결제대행사로 변경할까요? 카테고리 학습이 삭제되고, 다음부터 이 가맹점은 항상 수동 분류로 표시됩니다. 모든 사용자에게 적용됩니다.",
      )
    )
      return;
    setBusy(merchant);
    try {
      const res = await fetch("/api/learn", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oldMerchant: merchant,
          merchant,
          category: PSP_MARK,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "변경 실패");
      await load();
    } catch (e: any) {
      alert(e?.message || "변경 실패");
    } finally {
      setBusy(null);
    }
  }

  async function removeGateway(merchant: string) {
    if (
      !confirm(
        merchant + " 결제대행사 항목을 삭제할까요? 모든 사용자에게 적용됩니다.",
      )
    )
      return;
    setBusy("g:" + merchant);
    try {
      const res = await fetch("/api/learn", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchant, kind: "gateway" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "삭제 실패");
      setGateways((prev) => prev.filter((g) => g.merchant !== merchant));
    } catch (e: any) {
      alert(e?.message || "삭제 실패");
    } finally {
      setBusy(null);
    }
  }

  function exportCsv() {
    const header = "merchant,category,group\n";
    const body = entries
      .map((e) => [e.merchant, e.category, e.group].map(csvCell).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + header + body], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "learned_categories.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main style={wrap}>
      <div style={card}>
        <a href="/" style={back}>
          ← 메인으로
        </a>
        <h1 style={title}>학습된 분류 데이터</h1>
        <p style={subtitle}>
          가맹점 → 분류 매핑을 직접 추가·수정·삭제할 수 있습니다. 여기 누적된
          데이터는 <b>모든 사용자</b>의 다음 업로드부터 자동 적용됩니다.
        </p>

        <div style={badges}>
          <span style={persistent ? badgeOn : badgeOff}>
            {persistent
              ? "공유 저장소 연결됨 (Vercel KV)"
              : "임시 저장 — KV 미연결(재시작 시 초기화)"}
          </span>
        </div>

        <div style={statsRow}>
          <div style={stat}>
            <div style={statN}>{entries.length}</div>
            <div style={statL}>전체</div>
          </div>
          <div style={stat}>
            <div style={statN}>{expenseCount}</div>
            <div style={statL}>Expense</div>
          </div>
          <div style={stat}>
            <div style={statN}>{travelCount}</div>
            <div style={statL}>Travel</div>
          </div>
        </div>

        <div style={addBox}>
          <div style={addTitle}>+ 새 항목 추가</div>
          <div style={addRow}>
            <input
              style={addInput}
              placeholder="가맹점명 (예: 스타벅스)"
              value={addMerchant}
              onChange={(e) => setAddMerchant(e.target.value)}
            />
            <CategorySelect
              value={addCategory}
              onChange={setAddCategory}
              style={addSelect}
            />
            <input
              style={addInput}
              placeholder="작성자 이름(선택)"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
            />
            <button style={addBtn} disabled={saving} onClick={addEntry}>
              추가
            </button>
          </div>
          <p style={addHint}>
            가맹점명은 자동으로 정규화되어 저장됩니다(소문자·끝 숫자 제거).
            결제대행사명은 추가할 수 없습니다.
          </p>
        </div>

        <div style={toolbar}>
          <input
            style={searchBox}
            placeholder="가맹점 또는 분류 검색…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button style={ghostBtn} onClick={load}>
            새로고침
          </button>
          <button
            style={ghostBtn}
            onClick={exportCsv}
            disabled={!entries.length}
          >
            CSV 내보내기
          </button>
        </div>

        {loading ? (
          <p style={muted}>불러오는 중…</p>
        ) : error ? (
          <p style={errBox}>{error}</p>
        ) : filtered.length === 0 ? (
          <p style={muted}>
            {entries.length === 0
              ? "아직 학습된 데이터가 없습니다. 위에서 새 항목을 추가해 보세요."
              : "검색 결과가 없습니다."}
          </p>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>가맹점(정규화)</th>
                <th style={th}>분류</th>
                <th style={thC}>그룹</th>
                <th style={thC}>최근 분류자</th>
                <th style={thC}>관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const editing = editKey === e.merchant;
                return (
                  <tr key={e.merchant}>
                    <td style={td}>
                      {editing ? (
                        <input
                          style={cellInput}
                          value={editMerchant}
                          onChange={(ev) => setEditMerchant(ev.target.value)}
                        />
                      ) : (
                        e.merchant
                      )}
                    </td>
                    <td style={tdCat}>
                      {editing ? (
                        <CategorySelect
                          value={editCategory}
                          onChange={setEditCategory}
                          style={cellSelect}
                        />
                      ) : (
                        e.category
                      )}
                    </td>
                    <td style={tdC}>
                      {editing ? (
                        <span style={dash}>—</span>
                      ) : (
                        <span
                          style={e.group === "travel" ? tagTravel : tagExpense}
                        >
                          {e.group}
                        </span>
                      )}
                    </td>
                    <td style={tdByCell}>
                      {(() => {
                        const h = latestBy.get(e.merchant);
                        if (!h) return <span style={dash}>—</span>;
                        return (
                          <span style={byCell}>
                            <b>{h.by || "익명"}</b>
                            <span style={byDate}>{fmtAt(h.at)}</span>
                          </span>
                        );
                      })()}
                    </td>
                    <td style={tdC}>
                      {editing ? (
                        <div style={btnRow}>
                          <button
                            style={saveBtn}
                            disabled={saving}
                            onClick={() => saveEdit(e.merchant)}
                          >
                            저장
                          </button>
                          <button
                            style={cancelBtn}
                            disabled={saving}
                            onClick={() => setEditKey(null)}
                          >
                            취소
                          </button>
                        </div>
                      ) : (
                        <div style={btnRow}>
                          <button style={editBtn} onClick={() => startEdit(e)}>
                            수정
                          </button>
                          <button
                            style={editBtn}
                            disabled={busy === e.merchant}
                            onClick={() => convertToGateway(e.merchant)}
                            title="이 가맹점을 결제대행사로 변경(학습 삭제)"
                          >
                            결제대행사로
                          </button>
                          <button
                            style={delBtn}
                            disabled={busy === e.merchant}
                            onClick={() => remove(e.merchant)}
                          >
                            {busy === e.merchant ? "…" : "삭제"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div style={gwWrap}>
          <h2 style={gwTitle}>
            💳 결제대행사 (학습 금지) · {gateways.length}건
          </h2>
          <p style={subtitle}>
            아래 가맹점은 결제대행사로 등록되어 카테고리를 자동 학습하지 않고,
            업로드할 때마다 수동 분류를 요청합니다. 검토 팝업에서 '결제대행사'
            체크하거나 위 목록에서 '결제대행사로' 버튼을 누르면 여기 추가됩니다.
          </p>
          {gateways.length === 0 ? (
            <p style={muted}>아직 등록�� 결제대행사가 없습니다.</p>
          ) : (
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>가맹점(정규화)</th>
                  <th style={thC}>관리</th>
                </tr>
              </thead>
              <tbody>
                {gateways.map((g) => (
                  <tr key={g.merchant}>
                    <td style={td}>{g.label || g.merchant}</td>
                    <td style={tdC}>
                      <button
                        style={delBtn}
                        disabled={busy === "g:" + g.merchant}
                        onClick={() => removeGateway(g.merchant)}
                      >
                        {busy === "g:" + g.merchant ? "…" : "삭제"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={histWrap}>
          <h2 style={gwTitle}>📜 분류 기록 · 최근 {history.length}건</h2>
          <p style={subtitle}>
            누가 어떤 가맹점을 어떤 분류로 확정했는지 시간순으로 보여줍니다(공용
            저장소 기준, 최신순). 검토 팝업이나 여기서 분류할 때 입력한 작성자
            이름이 함께 기록됩니다.
          </p>
          {historyAuthors.length > 0 && (
            <div style={histFilterRow}>
              <label style={histFilterLabel}>분류자별 보기</label>
              <select
                style={histFilterSelect}
                value={historyBy}
                onChange={(e) => setHistoryBy(e.target.value)}
              >
                <option value="">전체 ({history.length}건)</option>
                {historyAuthors.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              {historyBy ? (
                <span style={histFilterCount}>
                  {historyBy} · {visibleHistory.length}건
                </span>
              ) : null}
            </div>
          )}
          {history.length === 0 ? (
            <p style={muted}>아직 기록이 없습니다.</p>
          ) : (
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>일시</th>
                  <th style={th}>분류자</th>
                  <th style={th}>가맹점</th>
                  <th style={th}>분류</th>
                </tr>
              </thead>
              <tbody>
                {visibleHistory.map((h, i) => (
                  <tr key={h.at + "_" + i}>
                    <td style={td}>{fmtAt(h.at)}</td>
                    <td style={td}>{h.by || "익명"}</td>
                    <td style={td}>{h.merchant}</td>
                    <td style={tdCat}>
                      {h.category === "__GATEWAY__" ? "결제대행사" : h.category}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p style={hint}>
          수정은 분류뿐 아니라 가맹점명도 바꿀 수 있습니다(이름을 바꿀 경우 기존
          항목은 자동으로 ���겨집니다). 모든 변경은 공유 저장소에 즉시 반영되어
          전체 사용자에게 적용됩니다. 원본 데이터는 Vercel → Storage →
          KV(Upstash) 데이터 브라우저의 해시{" "}
          <code>expense_merchant_categories</code> 에서도 볼 수 있습니다.
        </p>
      </div>
    </main>
  );
}

const histWrap: CSSProperties = { marginTop: 28 };
const histFilterRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  margin: "4px 0 12px",
  flexWrap: "wrap",
};
const histFilterLabel: CSSProperties = { fontSize: 13, color: "#555" };
const histFilterSelect: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #ccc",
  fontSize: 13,
  background: "#fff",
};
const histFilterCount: CSSProperties = { fontSize: 13, color: "#2563eb" };
const tdByCell: CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid #eef0f3",
  textAlign: "center",
  fontSize: 12,
};
const byCell: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  alignItems: "center",
};
const byDate: CSSProperties = { fontSize: 11, color: "#9aa1a9" };
const wrap: CSSProperties = {
  minHeight: "100vh",
  background: "#f4f5f7",
  padding: "40px 16px",
  display: "flex",
  justifyContent: "center",
  fontFamily: "system-ui, -apple-system, 'Malgun Gothic', sans-serif",
};
const card: CSSProperties = {
  width: "100%",
  maxWidth: 860,
  background: "#fff",
  borderRadius: 14,
  padding: 32,
  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
};
const back: CSSProperties = {
  fontSize: 13,
  color: "#2d6cdf",
  textDecoration: "none",
};
const title: CSSProperties = { fontSize: 22, margin: "10px 0 8px" };
const subtitle: CSSProperties = {
  fontSize: 14,
  color: "#5f6873",
  lineHeight: 1.6,
  marginBottom: 16,
};
const gwWrap: CSSProperties = { marginTop: 28 };
const gwTitle: CSSProperties = { fontSize: 18, margin: "0 0 6px" };
const badges: CSSProperties = { marginBottom: 16 };
const badgeBase: CSSProperties = {
  display: "inline-block",
  fontSize: 12,
  fontWeight: 600,
  padding: "4px 10px",
  borderRadius: 999,
};
const badgeOn: CSSProperties = {
  ...badgeBase,
  background: "#e6f4ea",
  color: "#1e7a3d",
};
const badgeOff: CSSProperties = {
  ...badgeBase,
  background: "#fdecec",
  color: "#b3261e",
};
const statsRow: CSSProperties = { display: "flex", gap: 12, marginBottom: 20 };
const stat: CSSProperties = {
  flex: 1,
  background: "#f7f8fa",
  borderRadius: 10,
  padding: "12px 8px",
  textAlign: "center",
};
const statN: CSSProperties = { fontSize: 22, fontWeight: 700 };
const statL: CSSProperties = { fontSize: 12, color: "#6b7280", marginTop: 2 };
const addBox: CSSProperties = {
  background: "#f7f9fc",
  border: "1px solid #e6ebf2",
  borderRadius: 10,
  padding: 16,
  marginBottom: 20,
};
const addTitle: CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  marginBottom: 10,
  color: "#374151",
};
const addRow: CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };
const addInput: CSSProperties = {
  flex: "1 1 200px",
  padding: "9px 12px",
  border: "1px solid #d9dde3",
  borderRadius: 8,
  fontSize: 14,
};
const addSelect: CSSProperties = {
  flex: "1 1 260px",
  padding: "9px 12px",
  border: "1px solid #d9dde3",
  borderRadius: 8,
  fontSize: 13,
  background: "#fff",
};
const addBtn: CSSProperties = {
  padding: "9px 20px",
  border: "none",
  background: "#2d6cdf",
  color: "#fff",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
const addHint: CSSProperties = {
  fontSize: 12,
  color: "#9097a1",
  marginTop: 8,
  marginBottom: 0,
};
const toolbar: CSSProperties = { display: "flex", gap: 8, marginBottom: 16 };
const searchBox: CSSProperties = {
  flex: 1,
  padding: "9px 12px",
  border: "1px solid #d9dde3",
  borderRadius: 8,
  fontSize: 14,
};
const ghostBtn: CSSProperties = {
  padding: "9px 14px",
  border: "1px solid #d9dde3",
  background: "#fff",
  borderRadius: 8,
  fontSize: 13,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const muted: CSSProperties = {
  color: "#6b7280",
  fontSize: 14,
  padding: "20px 0",
};
const errBox: CSSProperties = {
  color: "#b3261e",
  background: "#fdecec",
  padding: "12px 14px",
  borderRadius: 8,
  fontSize: 14,
};
const table: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};
const th: CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "2px solid #eceef1",
  color: "#6b7280",
  fontWeight: 600,
};
const thC: CSSProperties = { ...th, textAlign: "center" };
const td: CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid #f0f1f3",
  verticalAlign: "middle",
};
const tdCat: CSSProperties = { ...td, color: "#374151" };
const tdC: CSSProperties = { ...td, textAlign: "center" };
const dash: CSSProperties = { color: "#c0c5cc" };
const cellInput: CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid #c7ccd3",
  borderRadius: 6,
  fontSize: 13,
};
const cellSelect: CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid #c7ccd3",
  borderRadius: 6,
  fontSize: 12,
  background: "#fff",
};
const tagBase: CSSProperties = {
  display: "inline-block",
  fontSize: 11,
  fontWeight: 600,
  padding: "2px 8px",
  borderRadius: 999,
};
const tagExpense: CSSProperties = {
  ...tagBase,
  background: "#e7f0ff",
  color: "#2d6cdf",
};
const tagTravel: CSSProperties = {
  ...tagBase,
  background: "#fff1e0",
  color: "#c2710c",
};
const btnRow: CSSProperties = {
  display: "flex",
  gap: 6,
  justifyContent: "center",
};
const editBtn: CSSProperties = {
  padding: "5px 12px",
  border: "1px solid #c9d4e6",
  background: "#fff",
  color: "#2d6cdf",
  borderRadius: 7,
  fontSize: 12,
  cursor: "pointer",
};
const delBtn: CSSProperties = {
  padding: "5px 12px",
  border: "1px solid #f0c2bd",
  background: "#fff",
  color: "#b3261e",
  borderRadius: 7,
  fontSize: 12,
  cursor: "pointer",
};
const saveBtn: CSSProperties = {
  padding: "5px 12px",
  border: "none",
  background: "#1e7a3d",
  color: "#fff",
  borderRadius: 7,
  fontSize: 12,
  cursor: "pointer",
};
const cancelBtn: CSSProperties = {
  padding: "5px 12px",
  border: "1px solid #d9dde3",
  background: "#fff",
  color: "#6b7280",
  borderRadius: 7,
  fontSize: 12,
  cursor: "pointer",
};
const hint: CSSProperties = {
  marginTop: 20,
  fontSize: 12,
  color: "#9097a1",
  lineHeight: 1.6,
};
