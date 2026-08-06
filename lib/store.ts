import { kv } from "@vercel/kv";
import { normalizeMerchant } from "./normalize";

export { normalizeMerchant };

// Shared, cross-user learning store: maps a normalized merchant name to a
// category that a user explicitly confirmed. Once saved, EVERY user's future
// uploads classify that merchant automatically (no AI needed).
//
// Backend: Vercel KV (Upstash Redis). Enable it in Vercel -> Storage -> KV and
// it auto-injects KV_REST_API_URL / KV_REST_API_TOKEN. Without those env vars
// we fall back to an in-memory map so the app still runs (but learning resets
// on each cold start / is per-instance only).

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
  if (kvEnabled()) {
    try {
      const map = await kv.hgetall<Record<string, string>>(HASH);
      return map || {};
    } catch (e) {
      console.error("KV read failed, using memory:", e);
    }
  }
  return Object.fromEntries(memory);
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
