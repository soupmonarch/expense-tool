import * as XLSX from "xlsx";
import type { Transaction } from "./types";

// Card statements vary a lot by issuer (롯데/신한/삼성/현대/KB/BC ...). Instead of
// hard-coding one layout we scan for the header row and map columns by keyword.
// We also use the strongest cross-issuer signals when present:
//   - 가맹점업종명 (MCC name)   -> best classification signal
//   - 국내/해외 구분            -> domestic vs overseas travel
//   - 취소여부 / 전표구분       -> drop canceled rows
// The reimbursement amount is always the KRW (원화) amount column.

const MERCHANT_KEYS = [
  "가맹점명", "가맹점", "이용내역", "이용점", "상호", "사용처", "적요", "내용",
  "merchant", "description", "store", "vendor", "payee", "details",
];
// Amount detection is two-tier: prefer an explicit KRW/원화 amount column, then
// fall back to a generic amount column. This avoids accidentally picking the
// foreign-currency (현지금액) column for overseas rows.
const AMOUNT_PRIMARY_KEYS = ["원화", "이용금액", "청구금액", "결제금액", "krw"]; // 원화 catches "승인금액(원화)"
const AMOUNT_FALLBACK_KEYS = ["승인금액", "금액", "합계", "amount", "total", "price", "charge"];
const CATEGORY_NAME_KEYS = ["업종명"]; // prefer "가맹점업종명"
const CATEGORY_FALLBACK_KEYS = ["업종", "mcc", "category"]; // but skip "업종코드"
const REGION_KEYS = ["국내외", "사용구분", "사용처", "국내/해외", "국내해외"];
const CANCEL_PRIMARY_KEYS = ["취소여부", "전표구분"]; // explicit cancel flag
const CANCEL_FALLBACK_KEYS = ["부분취소"]; // avoid "부분취소 후 잔액" (a balance, not a flag)
const CURRENCY_KEYS = ["통화", "화폐", "currency", "curr", "ccy"]; // origin currency (for region)
const DATE_KEYS = ["이용일", "이용일자", "승인일", "거래일", "일자", "날짜", "사용일", "date"];

export interface ColumnMapping {
  merchant?: number;
  amount?: number;
  currency?: number;
  date?: number;
  category?: number;
  region?: number;
  cancel?: number;
}

function normalize(s: unknown): string {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, "");
}
function includesAny(cell: string, keys: string[]): boolean {
  const c = normalize(cell);
  if (!c) return false;
  return keys.some((k) => c.includes(normalize(k)));
}
function firstIndex(header: string[], keys: string[], exclude: string[] = []): number | undefined {
  for (let i = 0; i < header.length; i++) {
    if (includesAny(header[i], keys) && !includesAny(header[i], exclude)) return i;
  }
  return undefined;
}
function toNumber(v: unknown): number {
  if (typeof v === "number") return Math.abs(v);
  const cleaned = String(v ?? "").replace(/[^0-9.\-]/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : Math.abs(n);
}

export interface ParseResult {
  transactions: Transaction[];
  detectedMapping: ColumnMapping;
  headerRowIndex: number;
  skippedCanceled: number;
}

export function parseStatement(buffer: Buffer, override?: ColumnMapping): ParseResult {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: "" });

  // Find the header row: highest keyword score within the first 15 rows.
  let headerRowIndex = 0;
  let bestScore = -1;
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const row = (rows[r] || []).map(String);
    let score = 0;
    for (const cell of row) {
      if (includesAny(cell, MERCHANT_KEYS)) score += 2;
      if (includesAny(cell, AMOUNT_PRIMARY_KEYS) || includesAny(cell, AMOUNT_FALLBACK_KEYS)) score += 2;
      if (includesAny(cell, CATEGORY_NAME_KEYS) || includesAny(cell, CATEGORY_FALLBACK_KEYS)) score += 1;
      if (includesAny(cell, REGION_KEYS)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      headerRowIndex = r;
    }
  }

  const header = (rows[headerRowIndex] || []).map(String);
  const detected: ColumnMapping = {
    merchant: firstIndex(header, MERCHANT_KEYS),
    amount: firstIndex(header, AMOUNT_PRIMARY_KEYS) ?? firstIndex(header, AMOUNT_FALLBACK_KEYS),
    category: firstIndex(header, CATEGORY_NAME_KEYS) ?? firstIndex(header, CATEGORY_FALLBACK_KEYS, ["코드", "code"]),
    region: firstIndex(header, REGION_KEYS),
    cancel:
      firstIndex(header, CANCEL_PRIMARY_KEYS) ??
      firstIndex(header, CANCEL_FALLBACK_KEYS, ["잔액", "금액"]),
    currency: firstIndex(header, CURRENCY_KEYS),
    date: firstIndex(header, DATE_KEYS),
  };
  const m: ColumnMapping = { ...detected, ...(override || {}) };

  const get = (row: unknown[], idx?: number) =>
    idx !== undefined ? String(row[idx] ?? "").trim() : "";

  const transactions: Transaction[] = [];
  let skippedCanceled = 0;
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const merchant = get(row, m.merchant);
    const amount = m.amount !== undefined ? toNumber(row[m.amount]) : 0;
    if (!merchant && amount === 0) continue; // skip blank / summary rows

    // Cancellation: "Y" or any value containing "취소" means voided.
    const cancelVal = get(row, m.cancel);
    const canceled = cancelVal.toUpperCase() === "Y" || cancelVal.includes("취소");
    if (canceled) {
      skippedCanceled++;
      continue;
    }

    // Overseas? explicit 국내/해외 column wins, else non-KRW origin currency.
    const regionVal = get(row, m.region);
    const originCurrency = get(row, m.currency).toUpperCase();
    const isForeign =
      regionVal.includes("해외") ||
      regionVal.toUpperCase().includes("OVERSEAS") ||
      (!regionVal && originCurrency !== "" && originCurrency !== "KRW");

    transactions.push({
      rowIndex: r,
      date: get(row, m.date) || undefined,
      merchant,
      amount,
      currency: "KRW", // reimbursement is always KRW (원화 amount)
      merchantCategory: get(row, m.category) || undefined,
      isForeign,
    });
  }

  return { transactions, detectedMapping: detected, headerRowIndex, skippedCanceled };
}
