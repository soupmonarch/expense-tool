import type { Transaction } from "./types";

// 여러 파일(엑셀/영수증 PDF)을 합칠 때 같은 거래가 중복으로 들어오는 것을 제거한다.
// 카드사 홈페이지에서 결제내역이 페이지별로 분할 내보내기되면 동일 거래가 반복될 수
// 있으므로, 승인번호를 우선 키로 쓰고 없으면 가맹점+금액+일시 조합으로 키를 만든다.
//
// 주의: 같은 승인번호라도 결제/취소는 부호(금액)가 반대이므로 키에 '부호 금액'을
// 포함한다. 이렇게 해야 정상적인 결제-취소 쌍을 중복으로 잘못 제거하지 않는다.

function signedOf(t: Transaction): number {
  return typeof t.rawAmount === "number" ? t.rawAmount : t.amount;
}

function approvalDigits(t: Transaction): string {
  return String(t.approval ?? "")
    .replace(/[^0-9]/g, "")
    .replace(/^0+/, "");
}

export function dedupeTransactions(txs: Transaction[]): {
  unique: Transaction[];
  removed: number;
} {
  const seen = new Set<string>();
  const unique: Transaction[] = [];
  let removed = 0;
  for (const t of txs) {
    const appr = approvalDigits(t);
    const amt = Math.round(signedOf(t));
    const key = appr
      ? `a:${appr}|${amt}`
      : `m:${(t.merchant || "").trim()}|${amt}|${t.date || ""}|${t.time || ""}`;
    if (seen.has(key)) {
      removed++;
      continue;
    }
    seen.add(key);
    unique.push(t);
  }
  return { unique, removed };
}
