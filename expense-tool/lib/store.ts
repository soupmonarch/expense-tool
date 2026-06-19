import { kv } from "@vercel/kv";

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

export function kvEnabled(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

// Normalize so small formatting differences map to the same merchant.
// e.g. "카카오T일반택시_0" and "카카오T일반택시" collapse together.
export function normalizeMerchant(s: string): string {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[_\-]?\d+$/, "")
    .trim();
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

export async function saveLearned(merchant: string, category: string): Promise<void> {
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
