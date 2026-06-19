import type { ReactNode, CSSProperties } from "react";

export const metadata = {
  title: "Expense Claim Generator",
  description: "Card statement to Expense & Travel claim forms",
};

const bodyStyle: CSSProperties = {
  margin: 0,
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans KR', sans-serif",
  background: "#f5f6f8",
  color: "#1f2329",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body style={bodyStyle}>{children}</body>
    </html>
  );
}
