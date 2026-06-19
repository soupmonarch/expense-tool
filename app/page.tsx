"use client";

import { useState, type CSSProperties } from "react";

interface Stats {
  total: number;
  expense: number;
  travel: number;
  unclassified: number;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    setError(null);
    setStats(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/convert", { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed (${res.status})`);
      }
      const statsHeader = res.headers.get("X-Stats");
      if (statsHeader) setStats(JSON.parse(statsHeader));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "expense_claims.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={wrap}>
      <div style={card}>
        <h1 style={title}>지출 증빙 · 변제 양식 자동 생성기</h1>
        <p style={subtitle}>
          카드 사용 내역 파일(.xls / .xlsx)을 올리면 <b>Expense</b>와{" "}
          <b>Travel</b> 두 개의 제출 양식을 만들어 ZIP으로 다운로드합니다.
        </p>

        <form onSubmit={handleSubmit}>
          <label style={drop}>
            <input
              type="file"
              accept=".xls,.xlsx,.csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              style={hiddenInput}
            />
            {file ? (
              <span>📎 {file.name}</span>
            ) : (
              <span style={mutedText}>
                클릭하여 카드 내역 파일 선택
              </span>
            )}
          </label>

          <button type="submit" disabled={!file || loading} style={button(!file || loading)}>
            {loading ? "분류 중…" : "양식 생성 및 다운로드"}
          </button>
        </form>

        {error && <div style={errBox}>{error}</div>}

        {stats && (
          <div style={statBox}>
            <div>✅ 총 {stats.total}건 처리 완료</div>
            <div>🧾 Expense: {stats.expense}건 · ✈️ Travel: {stats.travel}건</div>
            {stats.unclassified > 0 && (
              <div style={warnText}>
                ⚠️ 미분류 {stats.unclassified}건 — Expense 파일에서 "UNCLASSIFIED"로
                표시되어 있으니 수동 확인하세요.
              </div>
            )}
          </div>
        )}

        <p style={hint}>
          💡 ZIP 안에는 Expense.xlsx, Travel.xlsx 와 함께 분류 근거를 담은
          classification_report.json 이 포함됩니다.
        </p>
      </div>
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
  maxWidth: 520,
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
  padding: "28px 16px",
  cursor: "pointer",
  marginBottom: 16,
  fontSize: 14,
  textAlign: "center",
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
  };
}
const errBox: CSSProperties = {
  marginTop: 16,
  padding: 12,
  borderRadius: 8,
  background: "#fdecea",
  color: "#c0392b",
  fontSize: 13,
};
const statBox: CSSProperties = {
  marginTop: 16,
  padding: 14,
  borderRadius: 8,
  background: "#eef5ff",
  fontSize: 13,
  lineHeight: 1.7,
};
const hint: CSSProperties = { marginTop: 20, fontSize: 12, color: "#8a9099", lineHeight: 1.6 };
const hiddenInput: CSSProperties = { display: "none" };
const mutedText: CSSProperties = { color: "#8a9099" };
const warnText: CSSProperties = { color: "#b9770e", marginTop: 4 };
