import type { CSSProperties } from "react";
import { CHANGELOG } from "@/lib/changelog";

export default function ChangelogPage() {
  return (
    <main style={wrap}>
      <div style={card}>
        <a href="/" style={back}>
          ← 메인으로
        </a>
        <h1 style={title}>🆕 업데이트 이력</h1>
        <p style={subtitle}>Expense Tool 의 버전별 변경 내용입니다 (최신순).</p>

        {CHANGELOG.map((entry, i) => (
          <section key={entry.version} style={i === 0 ? itemLatest : item}>
            <div style={itemHead}>
              <span style={version}>v{entry.version}</span>
              {i === 0 && <span style={latestBadge}>최신</span>}
              <span style={date}>{entry.date.replace(/-/g, ".")}</span>
            </div>
            <ul style={list}>
              {entry.changes.map((c) => (
                <li key={c} style={listItem}>
                  {c}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}

const wrap: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  justifyContent: "center",
  padding: 24,
};
const card: CSSProperties = {
  width: "100%",
  maxWidth: 640,
  background: "#fff",
  borderRadius: 16,
  padding: 32,
  boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
  alignSelf: "flex-start",
};
const back: CSSProperties = {
  fontSize: 13,
  color: "#2d6cdf",
  textDecoration: "none",
  fontWeight: 600,
};
const title: CSSProperties = { fontSize: 22, margin: "12px 0 6px" };
const subtitle: CSSProperties = {
  fontSize: 13.5,
  color: "#5f6873",
  marginBottom: 20,
};
const item: CSSProperties = {
  padding: "14px 0",
  borderTop: "1px solid #eef0f3",
};
const itemLatest: CSSProperties = {
  ...item,
  padding: "14px 16px",
  borderTop: "none",
  borderRadius: 10,
  background: "#f0f5ff",
  border: "1px solid #c9daf8",
  marginBottom: 6,
};
const itemHead: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 6,
};
const version: CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: "#1f2329",
};
const latestBadge: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#fff",
  background: "#2d6cdf",
  borderRadius: 6,
  padding: "2px 6px",
};
const date: CSSProperties = {
  marginLeft: "auto",
  fontSize: 12.5,
  color: "#8a9099",
  fontVariantNumeric: "tabular-nums",
};
const list: CSSProperties = { margin: 0, paddingLeft: 18 };
const listItem: CSSProperties = {
  fontSize: 13.5,
  color: "#3a4149",
  lineHeight: 1.7,
};
