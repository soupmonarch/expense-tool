// 브라우저 전용: 글자가 없는 영수증 PDF 페이지를 OCR(글자 인식)로 읽는다.
//
// "Microsoft Print to PDF" 로 만든 매출전표 PDF는 글자가 선(그림)으로 바뀌어
// 서버의 텍스트 추출로는 아무것도 읽히지 않는다. 그런 페이지만 골라서
//   1) unpdf(pdf.js)로 페이지를 고해상도 그림으로 그리고
//   2) 좌/우 반쪽(한 페이지에 매출전표 2장)을 각각 Tesseract 로 읽은 뒤
//   3) extractFieldsFromOcr 로 승인번호·가맹점·금액·일시를 뽑는다.
// 모든 처리는 직원의 브라우저 안에서만 일어나며 영수증 그림은 밖으로 나가지 않는다.
// (Tesseract 엔진과 한글/영문 인식 데이터는 처음 한 번 CDN 에서 받아 브라우저에 저장된다)

import {
  extractFieldsFromOcr,
  type ReceiptInfo,
} from "./parseReceipts";

// 페이지를 그리는 배율. A4(595pt) 기준 약 1,786px — 작은 글자까지 읽히는 크기.
const RENDER_SCALE = 3;

export type OcrProgress = (msg: string) => void;

// pdf.js 페이지를 흰 바탕 캔버스에 그린다 (OCR · AI 인식 공용).
export async function renderPageToCanvas(
  page: any,
  scale: number,
): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

// pageIndices: 0부터 시작하는 원본 페이지 번호들
export async function ocrReceiptPages(
  bytes: Uint8Array,
  pageIndices: number[],
  onProgress?: OcrProgress,
): Promise<ReceiptInfo[]> {
  if (pageIndices.length === 0) return [];
  const { getDocumentProxy } = await import("unpdf");
  const Tesseract: any = await import("tesseract.js");
  const createWorker = Tesseract.createWorker ?? Tesseract.default?.createWorker;

  onProgress?.(
    "영수증 글자 인식(OCR) 준비 중… (처음 한 번은 인식 데이터를 받느라 조금 더 걸려요)",
  );
  // pdf.js 는 넘겨받은 버퍼를 무효화하므로 복사본을 넘긴다.
  const doc: any = await getDocumentProxy(new Uint8Array(bytes));

  // 컴퓨터 성능이 되면 2개를 동시에 돌려 시간을 줄인다.
  const workerCount =
    typeof navigator !== "undefined" && (navigator.hardwareConcurrency || 2) >= 4
      ? 2
      : 1;
  const workers: any[] = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(await createWorker(["kor", "eng"], 1));
  }

  const out: ReceiptInfo[] = [];
  try {
    for (let k = 0; k < pageIndices.length; k++) {
      const p = pageIndices[k];
      onProgress?.(
        `영수증 글자 인식(OCR) 중 · ${k + 1}/${pageIndices.length}페이지 · 지금까지 ${out.length}장 인식`,
      );
      const page = await doc.getPage(p + 1);
      const canvas = await renderPageToCanvas(page, RENDER_SCALE);

      // 좌/우 반쪽을 나눠 (가능하면 동시에) 읽는다.
      const halfW = Math.floor(canvas.width / 2);
      const sides = (["L", "R"] as const).map((side) => {
        const h = document.createElement("canvas");
        h.width = halfW;
        h.height = canvas.height;
        h.getContext("2d")!.drawImage(canvas, side === "L" ? 0 : -halfW, 0);
        return { side, canvas: h };
      });
      const texts = await Promise.all(
        sides.map(async (s, i) => {
          const { data } = await workers[i % workers.length].recognize(s.canvas);
          return { side: s.side, text: String(data?.text || "") };
        }),
      );
      for (const { side, text } of texts) {
        const f = extractFieldsFromOcr(text);
        if (!f.hasContent) continue; // 빈 반쪽(마지막 페이지 등)
        out.push({
          page: p,
          side,
          approval: f.approval,
          merchant: f.merchant,
          amount: f.amount,
          date: f.date,
          time: f.time,
          canceled: f.canceled,
          hasContent: true,
        });
      }
      page.cleanup?.();
    }
  } finally {
    await Promise.all(workers.map((w) => w.terminate().catch(() => {})));
    doc.destroy?.();
  }
  return out;
}
