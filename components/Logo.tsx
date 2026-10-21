// Expense Tool 로고: 파란 그라데이션 칸 안의 영수증(지그재그 아래) + 체크 표시, 옆에 이름.
import type { CSSProperties } from "react";
import { T } from "@/lib/theme";

export function LogoMark({ size = 38 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="et-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b7bf0" />
          <stop offset="1" stopColor="#6d5cf5" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="48" height="48" rx="12" fill="url(#et-bg)" />
      {/* 영수증 */}
      <path
        d="M14 10.5h20a1.5 1.5 0 0 1 1.5 1.5v24.2l-3.2-2-3.1 2-3.2-2-3.2 2-3.1-2-3.2 2V12a1.5 1.5 0 0 1 1.5-1.5z"
        fill="#ffffff"
      />
      <rect x="17" y="16" width="14" height="2.2" rx="1.1" fill="#c9d6fb" />
      <rect x="17" y="21" width="9" height="2.2" rx="1.1" fill="#c9d6fb" />
      {/* 체크 배지 */}
      <circle cx="31.5" cy="29" r="6.2" fill="#22b573" stroke="#ffffff" strokeWidth="2" />
      <path
        d="M28.7 29.1l2 2 3.6-3.8"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Logo() {
  return (
    <div style={wrap}>
      <LogoMark />
      <div style={{ minWidth: 0 }}>
        <div style={word}>
          Expense<span style={wordLight}>Tool</span>
        </div>
        <div style={tagline}>법카 영수증 · 변제 양식 자동 정리</div>
      </div>
    </div>
  );
}

const wrap: CSSProperties = { display: "flex", alignItems: "center", gap: 10 };
const word: CSSProperties = {
  fontSize: 21,
  fontWeight: 800,
  letterSpacing: -0.4,
  color: T.text,
  lineHeight: 1.1,
};
const wordLight: CSSProperties = {
  fontWeight: 500,
  marginLeft: 5,
  background: "linear-gradient(90deg, #3b7bf0, #6d5cf5)",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
};
const tagline: CSSProperties = { fontSize: 11.5, color: T.textFaint, marginTop: 3, letterSpacing: 0.1 };
