import * as XLSX from "xlsx";
import type { Transaction } from "./types";

// 카드 내역은 카드사(롯데/신한/삼성/현대/KB/BC ...)마다 형식이 제각각이므로
// 한 가지 레이아웃을 하드코딩하지 않고 헤더 행을 탐색해 키워드로 열을 매핑한다.
// 카드사 공통으로 가장 강한 신호를 함께 사용한다:
//   - 가맹점업종명 (MCC name)   -> 가장 좋은 분류 신호
//   - 국내/해외 구분            -> 국내 vs 해외 출장
//   - 취소여부 / 전표구분       -> 취소 건 표시(버리지 않고 취소 정산에 사용)
// 변제 금액은 항상 원화(KRW) 금액 열을 사용한다.

const MERCHANT_KEYS = [
  "가맹점명",
  "가맹점",
  "이용내역",
  "이용점",
  "상호",
  "사용처",
  "적요",
  "내용",
  "merchant",
  "description",
  "store",
  "vendor",
  "payee",
  "details",
];
// 금액 탐지는 2단계: 먼저 원화/KRW 명시 열을, 없으면 일반 금액 열을 사용한다.
// (해외 건의 현지금액 열을 잘못 고르는 것을 방지)
const AMOUNT_PRIMARY_KEYS = ["원화", "이용금액", "청구금액", "결제금액", "krw"]; // 원화 -> "승인금액(원화)" 포함
const AMOUNT_FALLBACK_KEYS = [
  "승인금액",
  "금액",
  "합계",
  "amount",
  "total",
  "price",
  "charge",
];
const CATEGORY_NAME_KEYS = ["업종명"]; // "가맹점업종명" 우선
const CATEGORY_FALLBACK_KEYS = ["업종", "mcc", "category"]; // "업종코드"는 제외
const REGION_KEYS = ["국내외", "사용구분", "사용처", "국내/해외", "국내해외"];
const CANCEL_PRIMARY_KEYS = ["취소여부", "전표구분"]; // 명시적 취소 플래그
const CANCEL_FALLBACK_KEYS = ["부분취소"]; // "부분취소 후 잔액"(금액) 은 제외
const CURRENCY_KEYS = ["통화", "화폐", "currency", "curr", "ccy"]; // 원 통화(국내/해외 판정용)
const DATE_KEYS = [
  "이용일",
  "이용일자",
  "승인일",
  "거래일",
  "일자",
  "날짜",
  "사용일",
  "date",
];
const TIME_KEYS = [
  "승인시간",
  "이용시간",
  "거래시간",
  "사용시간",
  "시간",
  "시각",
  "time",
];
// 승인번호: 영수증 PDF와 매칭하는 키. "승인일자/시간/금액"과 혜동하지 않도록 제외.
const APPROVAL_KEYS = [
  "승인번호",
  "승인no",
  "approvalno",
  "approval",
  "authno",
  "auth",
];

export interface ColumnMapping {
  merchant?: number;
  amount?: number;
  currency?: number;
  date?: number;
  time?: number;
  category?: number;
  region?: number;
  cancel?: number;
  approval?: number;
}

function normalize(s: unknown): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}
function includesAny(cell: string, keys: string[]): boolean {
  const c = normalize(cell);
  if (!c) return false;
  return keys.some((k) => c.includes(normalize(k)));
}
function firstIndex(
  header: string[],
  keys: string[],
  exclude: string[] = [],
): number | undefined {
  for (let i = 0; i < header.length; i++) {
    if (includesAny(header[i], keys) && !includesAny(header[i], exclude))
      return i;
  }
  return undefined;
}
// 부호 보존 숫자 파싱(음수 취소/환불/가승인 감지에 필수).
function toSignedNumber(v: unknown): number {
  if (typeof v === "number") return v;
  const cleaned = String(v ?? "")
    .replace(/[^0-9.\-]/g, "")
    .trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}
function toNumber(v: unknown): number {
  return Math.abs(toSignedNumber(v));
}

// 날짜 셀과(있다면) 시간 셀에서 날짜와 시간을 분리한다.
// 별도 시간 열이 없으면 날짜 셀 안의 HH:mm 패턴을 추출한다.
function splitDateTime(
  dateRaw: string,
  timeRaw: string,
): { date?: string; time?: string } {
  let date = (dateRaw || "").trim();
  let time = (timeRaw || "").trim();
  if (!time && date) {
    const m = date.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
    if (m) {
      time = m[1];
      date = date.replace(m[1], "").trim();
    }
  }
  if (time) {
    const tm = time.match(/(\d{1,2}):(\d{2})/);
    time = tm ? tm[1].padStart(2, "0") + ":" + tm[2] : "";
  }
  return { date: date || undefined, time: time || undefined };
}

export interface ParseResult {
  transactions: Transaction[];
  detectedMapping: ColumnMapping;
  headerRowIndex: number;
  canceledCount: number;
}

export function parseStatement(
  buffer: Buffer,
  override?: ColumnMapping,
): ParseResult {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    blankrows: false,
    defval: "",
  });

  // 헤더 행 탐색: 처음 15행 중 키워드 점수가 가장 높은 행.
  let headerRowIndex = 0;
  let bestScore = -1;
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const row = (rows[r] || []).map(String);
    let score = 0;
    for (const cell of row) {
      if (includesAny(cell, MERCHANT_KEYS)) score += 2;
      if (
        includesAny(cell, AMOUNT_PRIMARY_KEYS) ||
        includesAny(cell, AMOUNT_FALLBACK_KEYS)
      )
        score += 2;
      if (
        includesAny(cell, CATEGORY_NAME_KEYS) ||
        includesAny(cell, CATEGORY_FALLBACK_KEYS)
      )
        score += 1;
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
    amount:
      firstIndex(header, AMOUNT_PRIMARY_KEYS) ??
      firstIndex(header, AMOUNT_FALLBACK_KEYS),
    category:
      firstIndex(header, CATEGORY_NAME_KEYS) ??
      firstIndex(header, CATEGORY_FALLBACK_KEYS, ["코드", "code"]),
    region: firstIndex(header, REGION_KEYS),
    cancel:
      firstIndex(header, CANCEL_PRIMARY_KEYS) ??
      firstIndex(header, CANCEL_FALLBACK_KEYS, ["잔액", "금액"]),
    currency: firstIndex(header, CURRENCY_KEYS),
    date: firstIndex(header, DATE_KEYS),
    time: firstIndex(header, TIME_KEYS),
    approval: firstIndex(header, APPROVAL_KEYS, [
      "일자",
      "시간",
      "금액",
      "date",
    ]),
  };
  const m: ColumnMapping = { ...detected, ...(override || {}) };

  const get = (row: unknown[], idx?: number) =>
    idx !== undefined ? String(row[idx] ?? "").trim() : "";

  const transactions: Transaction[] = [];
  let canceledCount = 0;
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const merchant = get(row, m.merchant);
    const approvalCell = get(row, m.approval);
    const rawAmount =
      m.amount !== undefined ? toSignedNumber(row[m.amount]) : 0;
    const amount = Math.abs(rawAmount);
    // 빈 행 / 합계·소계 행 건너뜀: 가맹점·승인번호가 모두 없으면 거래가 아님
    // (이용금액만 들어있는 footer 합계 행이 결제로 잘못 잡히는 문제 방지)
    if (!merchant && !approvalCell) continue;
    if (/^(합계|소계|총계|total|sum)$/i.test(merchant.replace(/\s+/g, "")))
      continue;

    // 취소: "Y" 또는 "취소"를 포함하면 취소 건. ("정상"은 취소 아님)
    const cancelVal = get(row, m.cancel);
    const canceled =
      cancelVal.toUpperCase() === "Y" || cancelVal.includes("취소");
    if (canceled) canceledCount++;
    // 가승인(pre-auth): 실제 청구가 아니므로 정산에서 자동 제외 대상으로 표시
    const preauth =
      merchant.includes("가승인") ||
      merchant.toLowerCase().includes("pre-auth");

    // 해외 여부: 국내/해외 열이 우선, 없으면 비원화 원통화 기준.
    const regionVal = get(row, m.region);
    const originCurrency = get(row, m.currency).toUpperCase();
    const isForeign =
      regionVal.includes("해외") ||
      regionVal.toUpperCase().includes("OVERSEAS") ||
      (!regionVal && originCurrency !== "" && originCurrency !== "KRW");

    const { date, time } = splitDateTime(get(row, m.date), get(row, m.time));

    transactions.push({
      rowIndex: r,
      date,
      time,
      merchant,
      amount,
      rawAmount,
      currency: "KRW", // 변제는 항상 원화(원화 금액)
      merchantCategory: get(row, m.category) || undefined,
      isForeign,
      canceled,
      preauth,
      approval: approvalCell || undefined,
    });
  }

  return {
    transactions,
    detectedMapping: detected,
    headerRowIndex,
    canceledCount,
  };
}
