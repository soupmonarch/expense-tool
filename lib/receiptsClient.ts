// 브라우저(클라이언트)에서 영수증 PDF를 다루는 헬퍼.
//
// Vercel 서버리스 함수는 요청 본문 4.5MB 한도가 있어, 큰 영수증 PDF는
// 서버로 통째로 올릴 수 없다(올리면 "Request Entity Too Large" 텍스트가
// 돌아와 JSON 파싱 오류가 난다). 그래서:
//  - 파싱: PDF를 페이지 단위 조각(≤3MB)으로 나눠 /api/parse-receipts 에 보낸다.
//  - 영수증 PDF 생성(자르기/정렬): 브라우저에서 pdf-lib 으로 직접 수행하고,
//    서버가 만든 엑셀 ZIP 에 결과 PDF를 합친다. 원본 PDF는 서버로 전송되지 않는다.

import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import type { ParsedReceipts, ReceiptInfo } from "./parseReceipts";
import {
  matchReceipts,
  renderReceiptPdf,
  type RowMeta,
} from "./buildReceiptPdf";
import { ALL_CATEGORIES, groupOf, type Category } from "./categories";

// 조각당 목표 크기. Vercel 한도(4.5MB) 대비 크게 여유를 둔다.
const CHUNK_TARGET = 2.5 * 1024 * 1024;
// 저장 후 실측 크기 상한: 이보다 크면 페이지를 반으로 나눠 재분할한다.
// (페이지별 용량 편차가 커도 조각이 4.5MB를 넘지 않게 보장)
const CHUNK_HARD_MAX = 3.5 * 1024 * 1024;
// 한 페이지짜리 조각의 절대 한도(Vercel 요청 본문 제한)
const PAGE_ABS_MAX = 4.3 * 1024 * 1024;

// 응답을 안전하게 JSON 으로 읽는다. 플랫폼이 JSON 이 아닌 텍스트(예:
// "Request Entity Too Large")를 돌려주면 친절한 한국어 오류로 바꿔 던진다.
export async function readJsonSafe(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (res.status === 413 || /request entity too large/i.test(text)) {
      throw new Error(
        "업로드 용량이 서버 한도(4.5MB)를 초과했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.",
      );
    }
    throw new Error(`서버 응답 오류 (${res.status}): ${text.slice(0, 120)}`);
  }
}

// 여러 영수증 PDF 파일을 페이지 순서대로 하나로 합친다.
export async function mergePdfFiles(files: File[]): Promise<Uint8Array> {
  if (files.length === 1) {
    return new Uint8Array(await files[0].arrayBuffer());
  }
  const out = await PDFDocument.create();
  for (const f of files) {
    const src = await PDFDocument.load(new Uint8Array(await f.arrayBuffer()));
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const pg of pages) out.addPage(pg);
  }
  return await out.save();
}

// 지정한 페이지 범위만 담은 새 PDF 바이트를 만든다.
async function savePageRange(
  src: PDFDocument,
  start: number,
  count: number,
): Promise<Uint8Array> {
  const idx: number[] = [];
  for (let i = start; i < start + count; i++) idx.push(i);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, idx);
  for (const pg of pages) out.addPage(pg);
  return await out.save();
}

// 큰 PDF를 페이지 단위로 여러 조각으로 나눈다.
// 중요: 평균 페이지 크기로 조각 크기를 재단하면, 용량이 큰 페이지가 몰린
// 조각이 4.5MB를 넘을 수 있다(실제 발생한 버그). 그래서 저장 후 실측
// 크기를 검사하고, 상한을 넘으면 페이지를 반씩 나눠 재귀적으로 재분할한다.
async function splitPdfBytes(
  bytes: Uint8Array,
  maxBytes = CHUNK_TARGET,
): Promise<{ bytes: Uint8Array; pageStart: number }[]> {
  if (bytes.length <= maxBytes) return [{ bytes, pageStart: 0 }];
  const src = await PDFDocument.load(bytes);
  const total = src.getPageCount();
  const chunks: { bytes: Uint8Array; pageStart: number }[] = [];

  async function emit(start: number, count: number): Promise<void> {
    const saved = await savePageRange(src, start, count);
    if (saved.length > CHUNK_HARD_MAX && count > 1) {
      const half = Math.ceil(count / 2);
      await emit(start, half);
      await emit(start + half, count - half);
      return;
    }
    if (count === 1 && saved.length > PAGE_ABS_MAX) {
      throw new Error(
        "영수증 PDF의 " +
          (start + 1) +
          "페이지 한 장이 " +
          (saved.length / 1024 / 1024).toFixed(1) +
          "MB로 서버 한도(4.5MB)를 넘어 처리할 수 없습니다. " +
          "스캔 해상도를 낮춰 다시 만들어 주세요.",
      );
    }
    chunks.push({ bytes: saved, pageStart: start });
  }

  const perPage = Math.max(1, bytes.length / Math.max(1, total));
  const pagesPerChunk = Math.max(1, Math.floor(maxBytes / perPage));
  for (let start = 0; start < total; start += pagesPerChunk) {
    await emit(start, Math.min(pagesPerChunk, total - start));
  }
  return chunks;
}

// 조각을 차례로 /api/parse-receipts 에 보내 파싱하고, 페이지 번호를 원본
// 기준으로 보정해 합친다.
// 진행 상황을 화면에 알리기 위한 콜백 (예: "조각 2/4 분석 중")
export type ReceiptProgress = (msg: string) => void;

export async function parseReceiptsRemote(
  bytes: Uint8Array,
  onProgress?: ReceiptProgress,
  options: { useAi?: boolean } = {},
): Promise<ParsedReceipts> {
  const chunks = await splitPdfBytes(bytes);
  const receipts: ReceiptInfo[] = [];
  let pageCount = 0;
  const errors: string[] = [];
  let sample: string | undefined;
  const ocrTargets: number[] = [];

  for (let ci = 0; ci < chunks.length; ci++) {
    const c = chunks[ci];
    onProgress?.(
      chunks.length > 1
        ? `영수증 조각 ${ci + 1}/${chunks.length} 업로드·분석 중 · 지금까지 ${receipts.length}장 인식`
        : "영수증 업로드·분석 중…",
    );
    const fd = new FormData();
    fd.append(
      "file",
      new Blob([c.bytes as BlobPart], { type: "application/pdf" }),
      "receipts.pdf",
    );
    const res = await fetch("/api/parse-receipts", {
      method: "POST",
      body: fd,
    });
    const data = await readJsonSafe(res);
    if (!res.ok) {
      throw new Error(data?.error || `영수증 분석 실패 (${res.status})`);
    }
    const parsed = data as ParsedReceipts;
    if (parsed.error) errors.push(parsed.error);
    for (const r of parsed.receipts || []) {
      receipts.push({ ...r, page: r.page + c.pageStart });
    }
    const chunkPages = parsed.pageCount || 0;
    // 글자를 하나도 못 읽은 조각(스캔·"Microsoft Print to PDF" 등)은 OCR 대상으로 모은다.
    if ((parsed.receipts || []).length === 0 && !parsed.error) {
      for (let i = 0; i < chunkPages; i++) ocrTargets.push(c.pageStart + i);
    }
    pageCount += chunkPages;
    if (!sample && parsed.sample) sample = parsed.sample;
  }

  // 글자가 없는 페이지: "AI로 영수증 읽기"가 켜져 있으면 AI 로, 아니면 OCR 로 읽는다.
  // AI 가 실패한 페이지는 OCR 로 대신 읽는다(실패해도 나머지 결과는 유지).
  let ocrPages = 0;
  const ai = { pages: 0, cached: 0, tokens: 0 };
  let ocrQueue = ocrTargets;
  if (ocrTargets.length > 0 && options.useAi) {
    try {
      const { aiReceiptPages } = await import("./aiReceipts");
      const r = await aiReceiptPages(bytes, ocrTargets, onProgress);
      receipts.push(...r.receipts);
      ai.pages = r.aiPages;
      ai.cached = r.cachedPages;
      ai.tokens = r.inputTokens + r.outputTokens;
      if (r.error) errors.push("AI 인식 일부 실패(OCR로 대신 읽음): " + r.error);
      ocrQueue = r.failedPages;
    } catch (e: any) {
      errors.push("AI 인식 실패(OCR로 대신 읽음): " + (e?.message || e));
    }
  }
  if (ocrQueue.length > 0) {
    try {
      const { ocrReceiptPages } = await import("./ocrReceipts");
      const found = await ocrReceiptPages(bytes, ocrQueue, onProgress);
      receipts.push(...found);
      ocrPages = ocrQueue.length;
    } catch (e: any) {
      errors.push("글자 인식(OCR) 실패: " + (e?.message || e));
    }
  }
  // 페이지·좌우 순서로 정렬 (AI·OCR 결과가 섞여도 원본 순서 유지)
  receipts.sort((a, b) => a.page - b.page || (a.side === b.side ? 0 : a.side === "L" ? -1 : 1));

  return {
    receipts,
    pageCount,
    error: errors.length ? errors.join(" / ") : undefined,
    sample: receipts.length === 0 ? sample : undefined,
    ...(ocrPages ? { ocrPages } : {}),
    ...(ai.pages ? { aiPages: ai.pages, aiTokens: ai.tokens } : {}),
    ...(ai.cached ? { aiCachedPages: ai.cached } : {}),
  };
}

export interface ClaimRowLike {
  merchant: string;
  category: string;
  approval?: string;
  cancel?: { amount: number };
}

// 엑셀 행을 Expense / Travel 영수증 매칭용 정보로 나눈다.
// 행 분리 규칙은 /api/generate 와 정확히 같다.
function splitRowMeta(rows: ClaimRowLike[]): {
  expenseMeta: RowMeta[];
  travelMeta: RowMeta[];
} {
  const valid = new Set<string>(ALL_CATEGORIES);
  const expenseMeta: RowMeta[] = [];
  const travelMeta: RowMeta[] = [];
  for (const r of rows) {
    const meta: RowMeta = {
      approval: r.approval || "",
      merchant: r.merchant,
      cancel: r.cancel,
    };
    if (
      r.category &&
      valid.has(r.category) &&
      groupOf(r.category as Category) === "travel"
    ) {
      travelMeta.push(meta);
    } else {
      expenseMeta.push(meta);
    }
  }
  return { expenseMeta, travelMeta };
}

// 사용 통계용 영수증 인식 결과 (숫자만 — 영수증 내용은 담지 않는다).
export interface ReceiptStatClient {
  pages: number;
  recognized: number;
  matched: number;
  missing: number;
  leftover: number;
  textItems?: number; // 인식 0건일 때 PDF에서 읽힌 글자 조각 수
  ocrPages?: number; // OCR 로 읽은 페이지 수
  aiPages?: number; // AI 로 읽은 페이지 수
  aiCachedPages?: number; // 저장된 AI 결과를 다시 쓴 페이지 수
  aiTokens?: number; // AI 인식 토큰 수
  error?: string;
}

export function receiptStats(
  rows: ClaimRowLike[],
  parsed: ParsedReceipts,
): ReceiptStatClient {
  const base = {
    pages: parsed.pageCount || 0,
    recognized: parsed.receipts.length,
    ...(parsed.error ? { error: parsed.error } : {}),
    ...(parsed.ocrPages ? { ocrPages: parsed.ocrPages } : {}),
    ...(parsed.aiPages ? { aiPages: parsed.aiPages, aiTokens: parsed.aiTokens || 0 } : {}),
    ...(parsed.aiCachedPages ? { aiCachedPages: parsed.aiCachedPages } : {}),
  };
  if (parsed.receipts.length === 0) {
    // 진단 문구 "[진단] 추출 텍스트조각 N개, ..." 에서 숫자만 꺼낸다.
    const m = /텍스트조각\s*(\d+)/.exec(parsed.sample || "");
    return {
      ...base,
      matched: 0,
      missing: rows.length,
      leftover: 0,
      ...(m ? { textItems: Number(m[1]) } : {}),
    };
  }
  const { expenseMeta, travelMeta } = splitRowMeta(rows);
  const s = matchReceipts(expenseMeta, travelMeta, parsed.receipts);
  return {
    ...base,
    matched: s.expense.matchedRows + s.travel.matchedRows,
    missing: s.expense.missingRows + s.travel.missingRows,
    leftover: s.leftover.length,
  };
}

// 서버가 만든 엑셀 ZIP 에 영수증 PDF 2개(Expense/Travel, 엑셀 행 순서와 동일)와
// 리포트를 추가한다.
export async function attachReceiptsToZip(
  zipBlob: Blob,
  rows: ClaimRowLike[],
  srcBytes: Uint8Array,
  parsed: ParsedReceipts,
): Promise<Blob> {
  const { expenseMeta, travelMeta } = splitRowMeta(rows);

  const zip = await JSZip.loadAsync(zipBlob);
  const reportLines: string[] = [];
  reportLines.push("영수증 PDF 처리 리포트");
  reportLines.push("=====================");
  reportLines.push(
    "원본 페이지: " +
      parsed.pageCount +
      ", 인식된 영수증: " +
      parsed.receipts.length,
  );
  if (parsed.aiPages || parsed.aiCachedPages)
    reportLines.push(
      "AI로 읽은 페이지: " +
        ((parsed.aiPages || 0) + (parsed.aiCachedPages || 0)) +
        (parsed.aiCachedPages ? ` (이전에 읽은 결과 재사용 ${parsed.aiCachedPages})` : ""),
    );
  if (parsed.ocrPages)
    reportLines.push(
      "글자가 없는 PDF여서 글자 인식(OCR)으로 읽은 페이지: " + parsed.ocrPages,
    );
  if (parsed.sample) reportLines.push("", parsed.sample);

  if (parsed.receipts.length === 0) {
    if (parsed.error) reportLines.push("⚠️ " + parsed.error);
    reportLines.push(
      "⚠️ 영수증을 인식하지 못해 영수증 PDF를 만들지 않았습니다.",
    );
  } else {
    const summary = matchReceipts(expenseMeta, travelMeta, parsed.receipts);
    // 각 호출에 독립 복사본을 넘긴다(버퍼 공유 문제 방지).
    const [expensePdf, travelPdf] = await Promise.all([
      renderReceiptPdf(new Uint8Array(srcBytes), summary.expense),
      renderReceiptPdf(new Uint8Array(srcBytes), summary.travel),
    ]);
    zip.file("Expense_Receipts.pdf", expensePdf);
    zip.file("Travel_Receipts.pdf", travelPdf);

    reportLines.push("");
    reportLines.push(
      "Expense: " +
        expenseMeta.length +
        "행 중 영수증 매칭 " +
        summary.expense.matchedRows +
        "건, 미매칭 " +
        summary.expense.missingRows +
        "건",
    );
    reportLines.push(
      "Travel: " +
        travelMeta.length +
        "행 중 영수증 매칭 " +
        summary.travel.matchedRows +
        "건, 미매칭 " +
        summary.travel.missingRows +
        "건",
    );
    if (parsed.error) reportLines.push("", "⚠️ " + parsed.error);
    if (summary.leftover.length > 0) {
      reportLines.push("");
      reportLines.push(
        "⚠️ 어느 행에도 매칭되지 않아 제외된 영수증 " +
          summary.leftover.length +
          "장:",
      );
      for (const lo of summary.leftover) {
        reportLines.push(
          "  - p" +
            (lo.page + 1) +
            "(" +
            lo.side +
            ") 승인번호:" +
            (lo.approval || "없음") +
            " " +
            (lo.merchant || ""),
        );
      }
    }
  }
  zip.file("영수증_리포트.txt", reportLines.join("\n"));
  return await zip.generateAsync({ type: "blob" });
}
