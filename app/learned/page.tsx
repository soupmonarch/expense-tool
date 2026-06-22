"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

interface Entry {
  merchant: string;
  category: string;
  group: string;
}

function csvCell(v: string): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export default function LearnedPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [persistent, setPersistent] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/learn", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "불러오기 실패");
      setEntries(data.entries || []);
      setPersistent(!!data.persistent);
    } catch (e: any) {
      setError(e?.message || "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return entries;
    return entries.filter(
      (e) => e.merchant.toLowerCase().includes(k) || e.category.toLowerCase().includes(k),
    );
  }, [entries, q]);

  const expenseCount = entries.filter((e) => e.group === "expense").length;
  const travelCount = entries.filter((e) => e.group === "travel").length;

  async function remove(merchant: string) {
    if (!confirm(merchant + " 항목을 학습 데이터에서 삭제할까요? 모든 사용자에게 적용됩니다.")) return;
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

  function exportCsv() {
    const header = "merchant,category,group\n";
    const body = entries
      .map((e) => [e.merchant, e.category, e.group].map(csvCell).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + header + body], { type: "text/csv;charset=utf-8;" });
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
        <a href="/" style={back}>← 메인으로</a>
        <h1 style={title}>학습된 분류 데이터</h1>
        <p style={subtitle}>
          검토 팝업에서 “학습”을 체크해 확정한 가맹점 → 분류 매핑입니다.
          여기 누적된 데이터는 <b>모든 사용자</b>의 다음 업로드부터 자동 적용됩니다.
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
          <button style={ghostBtn} onClick={exportCsv} disabled={!entries.length}>
            CSV 내보내기
          </button>
        </div>

        {loading ? (
          <p style={muted}>불러오는 중…</p>
        ) : error ? (
          <p style={errBox}>{error}</p>
        ) : filtered.length === 0 ? (
          <p style={muted}>
            {entries.length === 0 ? "아직 학습된 데이터가 없습니다." : "검색 결과가 없습니다."}
          </p>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>가맹점(정규화)</th>
                <th style={th}>분류</th>
                <th style={thC}>그룹</th>
                <th style={thC}>관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.merchant}>
                  <td style={td}>{e.merchant}</td>
                  <td style={tdCat}>{e.category}</td>
                  <td style={tdC}>
                    <span style={e.group === "travel" ? tagTravel : tagExpense}>{e.group}</span>
                  </td>
                  <td style={tdC}>
                    <button
                      style={delBtn}
                      disabled={busy === e.merchant}
                      onClick={() => remove(e.merchant)}
                    >
                      {busy === e.merchant ? "…" : "삭제"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p style={hint}>
          팀·지사 전체 개요는 위 수치와 표로 확인하고, 외부 리포팅이 필요하면 CSV로
          내보낼 수 있습니다. 원본 데이터는 Vercel → Storage → KV(Upstash) 데이터
          브라우저의 해시 <code>expense_merchant_categories</code> 에서도 볼 수 있습니다.
        </p>
      </div>
    </main>
  );
}

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
const back: CSSProperties = { fontSize: 13, color: "#2d6cdf", textDecoration: "none" };
const title: CSSProperties = { fontSize: 22, margin: "10px 0 8px" };
const subtitle: CSSProperties = { fontSize: 14, color: "#5f6873", lineHeight: 1.6, marginBottom: 16 };
const badges: CSSProperties = { marginBottom: 16 };
const badgeBase: CSSProperties = {
  display: "inline-block",
  fontSize: 12,
  fontWeight: 600,
  padding: "4px 10px",
  borderRadius: 999,
};
const badgeOn: CSSProperties = { ...badgeBase, background: "#e6f4ea", color: "#1e7a3d" };
const badgeOff: CSSProperties = { ...badgeBase, background: "#fdecec", color: "#b3261e" };
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
const muted: CSSProperties = { color: "#6b7280", fontSize: 14, padding: "20px 0" };
const errBox: CSSProperties = {
  color: "#b3261e",
  background: "#fdecec",
  padding: "12px 14px",
  borderRadius: 8,
  fontSize: 14,
};
const table: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const th: CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "2px solid #eceef1",
  color: "#6b7280",
  fontWeight: 600,
};
const thC: CSSProperties = { ...th, textAlign: "center" };
const td: CSSProperties = { padding: "8px 10px", borderBottom: "1px solid #f0f1f3" };
const tdCat: CSSProperties = { ...td, color: "#374151" };
const tdC: CSSProperties = { ...td, textAlign: "center" };
const tagBase: CSSProperties = {
  display: "inline-block",
  fontSize: 11,
  fontWeight: 600,
  padding: "2px 8px",
  borderRadius: 999,
};
const tagExpense: CSSProperties = { ...tagBase, background: "#e7f0ff", color: "#2d6cdf" };
const tagTravel: CSSProperties = { ...tagBase, background: "#fff1e0", color: "#c2710c" };
const delBtn: CSSProperties = {
  padding: "5px 12px",
  border: "1px solid #f0c2bd",
  background: "#fff",
  color: "#b3261e",
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
