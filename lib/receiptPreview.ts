// 브라우저 전용: 최종 검토 화면의 영수증 미리보기.
// 엑셀 행에 붙을 영수증 조각(페이지 + 좌/우 또는 영역)을 PDF에서 그림으로 잘라 보여 준다.
// 이미 브라우저에 있는 영수증 PDF를 쓰므로 서버 요청·비용이 없다.

import type { Half } from "./buildReceiptPdf";
import { renderPageToCanvas } from "./ocrReceipts";

const PREVIEW_SCALE = 2;

let cachedDoc: { bytes: Uint8Array; doc: any } | null = null;
const imageCache = new Map<string, string>();

async function getDoc(bytes: Uint8Array): Promise<any> {
  if (cachedDoc && cachedDoc.bytes === bytes) return cachedDoc.doc;
  cachedDoc?.doc?.destroy?.();
  imageCache.clear();
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  cachedDoc = { bytes, doc };
  return doc;
}

// 영수증 조각 하나를 PNG 데이터 URL 로 만든다.
export async function renderReceiptPiece(bytes: Uint8Array, half: Half): Promise<string> {
  const key = `${half.page}:${half.side}:${half.box ? JSON.stringify(half.box) : ""}`;
  const hit = imageCache.get(key);
  if (hit) return hit;

  const doc = await getDoc(bytes);
  const page = await doc.getPage(half.page + 1);
  const base = page.getViewport({ scale: 1 });
  const W = base.width;
  const H = base.height;
  const box =
    half.box ??
    (half.side === "L"
      ? { left: 0, bottom: 0, right: W / 2, top: H }
      : { left: W / 2, bottom: 0, right: W, top: H });
  const full = await renderPageToCanvas(page, PREVIEW_SCALE);
  // PDF 좌표(왼쪽 아래 기준) → 캔버스 좌표(왼쪽 위 기준)
  const sx = Math.max(0, box.left * PREVIEW_SCALE);
  const sy = Math.max(0, (H - box.top) * PREVIEW_SCALE);
  const sw = Math.min(full.width - sx, (box.right - box.left) * PREVIEW_SCALE);
  const sh = Math.min(full.height - sy, (box.top - box.bottom) * PREVIEW_SCALE);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(sw));
  out.height = Math.max(1, Math.round(sh));
  out.getContext("2d")!.drawImage(full, sx, sy, sw, sh, 0, 0, out.width, out.height);
  const url = out.toDataURL("image/png");
  imageCache.set(key, url);
  page.cleanup?.();
  return url;
}
