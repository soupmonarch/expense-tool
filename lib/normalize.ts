// Normalize so small formatting differences map to the same merchant.
// e.g. "카카오T일반택시_0" and "카카오T일반택시" collapse together.
// store.ts 와 buildReceiptPdf.ts 가 함께 쓴다. 브라우저 번들(클라이언트)에서
// buildReceiptPdf 를 임포트할 때 @vercel/kv 가 딸려 들어가지 않도록
// store.ts 에서 분리했다.
export function normalizeMerchant(s: string): string {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[_\-]?\d+$/, "")
    .trim();
}
