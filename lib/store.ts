import { createClient } from "@vercel/kv";
import { normalizeMerchant } from "./normalize";
import { canonCategory } from "./categories";

export { normalizeMerchant };

// Shared, cross-user learning store: maps a normalized merchant name to a
// category that a user explicitly confirmed. Once saved, EVERY user's future
// uploads classify that merchant automatically (no AI needed).
//
// Backend: Vercel KV (Upstash Redis). Enable it in Vercel -> Storage -> KV and
// it auto-injects KV_REST_API_URL / KV_REST_API_TOKEN. Without those env vars
// we fall back to an in-memory map so the app still runs (but learning resets
// on each cold start / is per-instance only).

// KV 클라이언트. @vercel/kv 기본 클라이언트는 fetch 를 cache: "default" 로 보내서
// Next.js 가 GET 응답(예: /api/stats)을 최대 1년간 저장해 두고 옛 값을 돌려주는
// 문제가 있었다. 항상 최신 값을 읽도록 "no-store" 로 직접 만든다.
// (환경변수가 있을 때 처음 쓰는 순간 만든다 — kvEnabled() 로 먼저 확인)
let _kv: ReturnType<typeof createClient> | null = null;
const kv = new Proxy({} as ReturnType<typeof createClient>, {
  get(_target, prop) {
    if (!_kv) {
      _kv = createClient({
        url: process.env.KV_REST_API_URL as string,
        token: process.env.KV_REST_API_TOKEN as string,
        cache: "no-store",
      });
    }
    const value = (_kv as any)[prop];
    return typeof value === "function" ? value.bind(_kv) : value;
  },
});

const HASH = "expense_merchant_categories";
const memory = new Map<string, string>();

// 결제대행사(PSP) 학습 세트. 사용자가 검토 팝업/관리 페이지에서 "이건 결제대행사"
// 라고 확정한 가맹점의 정규화 키를 모은다. 여기 등록된 가맹점은 이후 모든 업로드에서
// 항상 수동 분류를 요구하고 카테고리는 절대 학습하지 않는다(고정 키워드 목록의 보완).
const GATEWAY_HASH = "expense_payment_gateways";
const gatewayMemory = new Set<string>();

export function kvEnabled(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export async function getLearnedMap(): Promise<Record<string, string>> {
  let raw: Record<string, string> | null = null;
  if (kvEnabled()) {
    try {
      raw = (await kv.hgetall<Record<string, string>>(HASH)) || {};
    } catch (e) {
      console.error("KV read failed, using memory:", e);
    }
  }
  if (raw === null) raw = Object.fromEntries(memory);
  // 양식 개정으로 이름이 바뀐 카테고리는 읽을 때 새 이름으로 변환한다
  // (옛 이름으로 저장된 학습 데이터도 그대로 계속 동작).
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = canonCategory(v);
  return out;
}

export async function saveLearned(
  merchant: string,
  category: string,
): Promise<void> {
  const key = normalizeMerchant(merchant);
  if (!key) return;
  if (kvEnabled()) {
    try {
      await kv.hset(HASH, { [key]: category });
      return;
    } catch (e) {
      console.error("KV write failed, using memory:", e);
    }
  }
  memory.set(key, category);
}

// 공유 저장소에서 매핑 하나를 제거한다(관리 페이지에서 잘못 학습된 항목을
// 모든 사용자 기준으로 바로잡을 때 사용).
export async function deleteLearned(merchant: string): Promise<void> {
  const key = normalizeMerchant(merchant);
  if (!key) return;
  if (kvEnabled()) {
    try {
      await kv.hdel(HASH, key);
      return;
    } catch (e) {
      console.error("KV delete failed, using memory:", e);
    }
  }
  memory.delete(key);
}

// PSP로 확정된 가맹점명들의 정규화 키 집합을 반환한다.
export async function getLearnedGateways(): Promise<Set<string>> {
  if (kvEnabled()) {
    try {
      const map = await kv.hgetall<Record<string, string>>(GATEWAY_HASH);
      return new Set(Object.keys(map || {}));
    } catch (e) {
      console.error("KV read failed, using memory:", e);
    }
  }
  return new Set(gatewayMemory);
}

// PSP 표시된 가맹점명→원본표기 맵을 전체 반환한다(관리 페이지 목록용).
export async function getLearnedGatewayMap(): Promise<Record<string, string>> {
  if (kvEnabled()) {
    try {
      const map = await kv.hgetall<Record<string, string>>(GATEWAY_HASH);
      return map || {};
    } catch (e) {
      console.error("KV read failed, using memory:", e);
    }
  }
  return Object.fromEntries([...gatewayMemory].map((k) => [k, k]));
}

// 가맹점을 PSP로 학습한다. PSP는 카테고리 학습이 무의미하므로 기존 카테고리 매핑은 함께 지운다.
export async function saveLearnedGateway(merchant: string): Promise<void> {
  const key = normalizeMerchant(merchant);
  if (!key) return;
  await deleteLearned(merchant);
  if (kvEnabled()) {
    try {
      await kv.hset(GATEWAY_HASH, { [key]: merchant });
      return;
    } catch (e) {
      console.error("KV write failed, using memory:", e);
    }
  }
  gatewayMemory.add(key);
}

// PSP 학습 항목 하나를 제거한다(잘못 표시된 경우 복구용).
export async function deleteLearnedGateway(merchant: string): Promise<void> {
  const key = normalizeMerchant(merchant);
  if (!key) return;
  if (kvEnabled()) {
    try {
      await kv.hdel(GATEWAY_HASH, key);
      return;
    } catch (e) {
      console.error("KV delete failed, using memory:", e);
    }
  }
  gatewayMemory.delete(key);
}

// ---------------------------------------------------------------------------
// 분류 기록(감사 로그): 누가 어떤 가맹점을 어떤 분류로 확정했는지 시간순으로 남긴다.
// 개별 로그인 대신 공용 비밀번호를 쓰므로 작성자(by)는 사용자가 입력한 이름이다.
// Vercel KV(Upstash Redis) 리스트에 최신순(lpush)으로 쌓고 최대 MAX_HISTORY건 유지한다.
// ---------------------------------------------------------------------------
const HISTORY_KEY = "expense_classify_history";
const MAX_HISTORY = 1000;
const historyMemory: HistoryEntry[] = [];

export interface HistoryEntry {
  key: string; // 정규화된 가맹점 키 (entries.merchant 와 매칭)
  merchant: string; // 원본 가맹점 표기
  category: string; // 확정 분류 (또는 "__GATEWAY__")
  by: string; // 작성자 이름 (빈 값이면 UI에서 '익명' 처리)
  at: string; // ISO 타임스탬프
  source?: string; // "review" | "manual" | "gateway" 등
}

// 분류 기록 한 건을 추가한다. 저장 실패해도 양식 생성 흐름을 막지 않도록 조용히 실패한다.
export async function appendHistory(
  entry: Omit<HistoryEntry, "key" | "at"> & { at?: string },
): Promise<void> {
  const e: HistoryEntry = {
    key: normalizeMerchant(entry.merchant),
    merchant: entry.merchant,
    category: entry.category,
    by: (entry.by || "").trim(),
    at: entry.at || new Date().toISOString(),
    source: entry.source,
  };
  if (!e.key) return;
  if (kvEnabled()) {
    try {
      await kv.lpush(HISTORY_KEY, e);
      await kv.ltrim(HISTORY_KEY, 0, MAX_HISTORY - 1);
      return;
    } catch (err) {
      console.error("KV history write failed, using memory:", err);
    }
  }
  historyMemory.unshift(e);
  if (historyMemory.length > MAX_HISTORY) historyMemory.length = MAX_HISTORY;
}

// ---------------------------------------------------------------------------
// 사용 통계 (두 가지를 저장한다. 가맹점명·사람 이름·승인번호 원문은 저장하지 않는다)
//
//  1) 작업(batch) 요약 — USAGE_HASH, 키 = batchId
//     다운로드할 때마다 그 작업의 건수·금액과 영수증 인식 결과를 남긴다.
//     같은 작업을 여러 번 다운로드하면 덮어쓴다. "다운로드한 작업 수"와
//     "영수증 인식" 통계에 쓴다.
//     v 가 없는 항목은 v2.4.0 이전 형식(분류별 합계 포함, 다운로드 월 기준)이다.
//
//  2) 결제 1건씩 — PAYMENT_HASH, 키 = 결제 지문(승인번호+금액의 해시)
//     같은 카드 내역을 다시 올려 분류해도 같은 결제는 같은 키라 덮어쓰므로
//     금액이 두 번 집계되지 않는다. 월은 결제일 기준이다.
// ---------------------------------------------------------------------------
const USAGE_HASH = "expense_usage_stats";
const usageMemory = new Map<string, UsageSummary>();
const PAYMENT_HASH = "expense_usage_payments";
const paymentMemory = new Map<string, PaymentRecord>();

export interface ReceiptStat {
  pages: number; // 영수증 PDF 페이지 수
  recognized: number; // 인식된 영수증 수
  matched: number; // 영수증을 찾은 엑셀 행 수
  missing: number; // 영수증을 못 찾은 엑셀 행 수
  leftover: number; // 어느 행에도 맞지 않은 영수증 수
  textItems?: number; // 인식 0건일 때 PDF에서 읽힌 글자 조각 수 (0이면 스캔/이미지 PDF)
  ocrPages?: number; // 글자가 없어 브라우저 OCR 로 읽은 페이지 수
  aiPages?: number; // AI 이미지 인식으로 새로 읽은 페이지 수
  aiCachedPages?: number; // 저장된 AI 결과를 다시 쓴 페이지 수
  aiTokens?: number; // AI 인식 토큰 수 (입력+출력)
  error?: string; // 파싱 오류 메시지
}

export interface UsageSummary {
  v?: number; // 2 = v2.4.0 이후 형식
  at: string; // ISO 타임스탬프 (다운로드 시각)
  rows: number;
  amount: number;
  receipt?: ReceiptStat;
  // 아래 둘은 v2.4.0 이전 형식에만 있다 (이후로는 PAYMENT_HASH 에서 집계).
  byCategory?: Record<string, { n: number; amount: number }>;
  bySource?: Record<string, number>; // learned | rule | ai | manual
}

export interface PaymentRecord {
  m: string; // 결제 월 YYYY-MM
  a: number; // 금액(원)
  c: string; // 분류
  s: string; // 분류 방식: learned | rule | ai | manual
  t: string; // 마지막으로 다운로드한 시각 (ISO)
}

export async function savePayments(
  records: Record<string, PaymentRecord>,
): Promise<void> {
  const entries = Object.entries(records);
  if (entries.length === 0) return;
  if (kvEnabled()) {
    try {
      const payload: Record<string, string> = {};
      for (const [k, v] of entries) payload[k] = JSON.stringify(v);
      await kv.hset(PAYMENT_HASH, payload);
      return;
    } catch (e) {
      console.error("KV payment write failed, using memory:", e);
    }
  }
  for (const [k, v] of entries) paymentMemory.set(k, v);
}

export async function getAllPayments(): Promise<PaymentRecord[]> {
  if (kvEnabled()) {
    try {
      const map = await kv.hgetall<Record<string, unknown>>(PAYMENT_HASH);
      return Object.values(map || {})
        .map((v) => (typeof v === "string" ? JSON.parse(v) : v))
        .filter(Boolean) as PaymentRecord[];
    } catch (e) {
      console.error("KV payment read failed, using memory:", e);
    }
  }
  return [...paymentMemory.values()];
}

export async function saveUsage(
  batchId: string,
  summary: UsageSummary,
): Promise<void> {
  const id = String(batchId || "").slice(0, 64);
  if (!id) return;
  if (kvEnabled()) {
    try {
      await kv.hset(USAGE_HASH, { [id]: JSON.stringify(summary) });
      return;
    } catch (e) {
      console.error("KV usage write failed, using memory:", e);
    }
  }
  usageMemory.set(id, summary);
}

export async function getAllUsage(): Promise<UsageSummary[]> {
  if (kvEnabled()) {
    try {
      const map = await kv.hgetall<Record<string, unknown>>(USAGE_HASH);
      return Object.values(map || {})
        .map((v) => (typeof v === "string" ? JSON.parse(v) : v))
        .filter(Boolean) as UsageSummary[];
    } catch (e) {
      console.error("KV usage read failed, using memory:", e);
    }
  }
  return [...usageMemory.values()];
}

// 최신순 분류 기록을 반환한다(관리 페이지 표시용).
export async function getHistory(limit = 200): Promise<HistoryEntry[]> {
  const n = Math.max(1, Math.min(limit, MAX_HISTORY));
  if (kvEnabled()) {
    try {
      const list = await kv.lrange<HistoryEntry>(HISTORY_KEY, 0, n - 1);
      return Array.isArray(list) ? list : [];
    } catch (err) {
      console.error("KV history read failed, using memory:", err);
    }
  }
  return historyMemory.slice(0, n);
}
