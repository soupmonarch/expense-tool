import { T } from "@/lib/theme";
import type { ReactNode, CSSProperties } from "react";

export const metadata = {
  title: "Expense Tool",
  description: "Card statement to Expense & Travel claim forms",
};

const bodyStyle: CSSProperties = {
  margin: 0,
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans KR', sans-serif",
  background: T.page,
  color: T.text,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body style={bodyStyle}>{children}</body>
    </html>
  );
}
