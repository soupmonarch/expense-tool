// 브라우저 전용: 글자가 없는 영수증 PDF 페이지를 AI(이미지 인식)로 읽는다.
//
// 메인 화면의 "AI로 영수증 읽기" 토글을 켰을 때만 쓴다(기본은 OCR).
//   1) 페이지를 그림(JPEG)으로 그려 /api/ai-receipts 로 보낸다 (페이지당 요청 1번)
//   2) AI 가 그 페이지의 영수증을 양식과 상관없이 모두 읽어 돌려준다
//   3) 같은 PDF·같은 페이지 결과는 이 브라우저에 저장해 두고 다시 쓰므로,
//      같은 파일을 다시 올려도 AI 비용이 다시 들지 않는다
// AI 호출이 실패한 페이지는 호출한 쪽에서 OCR 로 대신 읽는다.

import type { ReceiptBox, ReceiptInfo } from "./parseReceipts";
import { approvalKey } from "./parseReceipts";
import { renderPageToCanvas, type OcrProgress } from "./ocrReceipts";

// A4(595pt) → 약 950px. 작은 글자도 읽히면서 토큰(그림 크기)을 아끼는 크기.
const AI_RENDER_SCALE = 1.6;
const AI_CONCURRENCY = 3;
const CACHE_KEY = "expense_tool_ai_receipt_cache";
const CACHE_MAX = 80; // 저장해 둘 페이지 결과 수

interface AiReceipt {
  approval: string;
  merchant: string;
  amount: number;
  canceled: boolean;
  date: string;
  time: string;
  box: number[] | null;
}

export interface AiReadResult {
  receipts: ReceiptInfo[];
  aiPages: number; // AI 로 실제 호출한 페이지 수
  cachedPages: number; // 저장된 결과를 다시 쓴 페이지 수 (비용 0)
  inputTokens: number;
  outputTokens: number;
  failedPages: number[]; // AI 가 실패한 페이지 (OCR 로 대신 읽을 대상)
  error?: string;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type CacheMap = Record<string, { at: number; receipts: AiReceipt[] }>;

function readCache(): CacheMap {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") as CacheMap;
  } catch {
    return {};
  }
}

function writeCache(map: CacheMap) {
  try {
    const entries = Object.entries(map)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, CACHE_MAX);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* 저장 공간 부족 등은 무시 (다음에 다시 AI 로 읽을 뿐) */
  }
}

function normDate(d: string): string | undefined {
  const m = String(d || "").match(/(20\d{2})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})/);
  return m ? `${m[1]}.${m[2].padStart(2, "0")}.${m[3].padStart(2, "0")}` : undefined;
}

function normTime(t: string): string | undefined {
  const m = String(t || "").match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : undefined;
}

// AI 가 준 영역(0~1, 왼쪽 위 기준)을 PDF 좌표(왼쪽 아래 기준)로 바꾼다.
// 좌/우 2장짜리 양식처럼 영역이 한쪽 반에 들어가면, 검증된 '반쪽 자르기'를 쓴다.
function toPlacement(
  r: AiReceipt,
  countOnPage: number,
  pageW: number,
  pageH: number,
): { side: "L" | "R"; box?: ReceiptBox } {
  const b = r.box;
  const valid =
    b &&
    b.every((v) => v >= -0.05 && v <= 1.05) &&
    b[2] > b[0] &&
    b[3] > b[1] &&
    (b[2] - b[0]) * (b[3] - b[1]) > 0.03;
  if (!valid) {
    // 영역을 모르면: 한 장뿐이면 페이지 전체, 아니면 순서대로 좌/우
    return countOnPage <= 1
      ? { side: "L", box: { left: 0, bottom: 0, right: pageW, top: pageH } }
      : { side: "L" };
  }
  const [x0, y0, x1, y1] = b!;
  const side: "L" | "R" = (x0 + x1) / 2 < 0.5 ? "L" : "R";
  if (countOnPage <= 2 && (x1 <= 0.55 || x0 >= 0.45)) return { side };
  const pad = 0.02;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return {
    side,
    box: {
      left: clamp(x0 - pad) * pageW,
      right: clamp(x1 + pad) * pageW,
      top: (1 - clamp(y0 - pad)) * pageH,
      bottom: (1 - clamp(y1 + pad)) * pageH,
    },
  };
}

// pageIndices: 0부터 시작하는 원본 페이지 번호들
export async function aiReceiptPages(
  bytes: Uint8Array,
  pageIndices: number[],
  onProgress?: OcrProgress,
): Promise<AiReadResult> {
  const result: AiReadResult = {
    receipts: [],
    aiPages: 0,
    cachedPages: 0,
    inputTokens: 0,
    outputTokens: 0,
    failedPages: [],
  };
  if (pageIndices.length === 0) return result;

  const fileHash = await sha256Hex(bytes);
  const cache = readCache();
  const { getDocumentProxy } = await import("unpdf");
  const doc: any = await getDocumentProxy(new Uint8Array(bytes));
  const errors: string[] = [];
  let done = 0;

  const perPage = new Map<number, { receipts: AiReceipt[]; w: number; h: number }>();

  async function readPage(p: number) {
    const page = await doc.getPage(p + 1);
    const base = page.getViewport({ scale: 1 });
    const key = `${fileHash}:${p}`;
    let receipts: AiReceipt[] | null = cache[key]?.receipts ?? null;
    if (receipts) {
      result.cachedPages++;
    } else {
      const canvas = await renderPageToCanvas(page, AI_RENDER_SCALE);
      const image = canvas.toDataURL("image/jpeg", 0.85);
      const res = await fetch("/api/ai-receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `AI 인식 실패 (${res.status})`);
      receipts = (data.receipts || []) as AiReceipt[];
      result.aiPages++;
      result.inputTokens += data.usage?.input || 0;
      result.outputTokens += data.usage?.output || 0;
      cache[key] = { at: Date.now(), receipts };
    }
    perPage.set(p, { receipts, w: base.width, h: base.height });
    page.cleanup?.();
  }

  // 몇 페이지씩 동시에 보내 기다리는 시간을 줄인다.
  const queue = [...pageIndices];
  async function worker() {
    while (queue.length) {
      const p = queue.shift()!;
      try {
        await readPage(p);
      } catch (e: any) {
        result.failedPages.push(p);
        errors.push(`p${p + 1}: ${e?.message || e}`);
      }
      done++;
      onProgress?.(
        `AI로 영수증 읽는 중 · ${done}/${pageIndices.length}페이지`,
      );
    }
  }
  onProgress?.(`AI로 영수증 읽는 중 · 0/${pageIndices.length}페이지`);
  await Promise.all(
    Array.from({ length: Math.min(AI_CONCURRENCY, pageIndices.length) }, worker),
  );
  doc.destroy?.();
  writeCache(cache);

  for (const p of [...perPage.keys()].sort((a, b) => a - b)) {
    const { receipts, w, h } = perPage.get(p)!;
    receipts.forEach((r, i) => {
      const placed = toPlacement(r, receipts.length, w, h);
      // 영역을 모르고 여러 장이면 순서대로 좌/우를 번갈아 배정한다.
      const side = !r.box && receipts.length > 1 ? (i % 2 === 0 ? "L" : "R") : placed.side;
      result.receipts.push({
        page: p,
        side,
        approval: approvalKey(r.approval),
        merchant: r.merchant || "",
        amount: Math.abs(Number(r.amount) || 0),
        date: normDate(r.date),
        time: normTime(r.time),
        canceled: !!r.canceled,
        hasContent: true,
        ...(placed.box ? { box: placed.box } : {}),
      });
    });
  }
  if (errors.length) result.error = errors.slice(0, 3).join(" / ");
  return result;
}
