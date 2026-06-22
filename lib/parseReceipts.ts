// 카드사에서 출력한 영수증(매출전표) PDF를 파싱한다.
// 한 페이지에 좌/우 두 장씩 들어 있으므로, 텍스트의 x좌표로 좌/우를 나눠
// 각 영수증의 승인번호 / 가맹점명 / 거래금액을 추출한다.
// 추출한 승인번호로 카드 승인내역 엑셀의 각 행과 1:1로 매칭한다.
//
// unpdf 는 serverless(Node/Vercel) 전용으로 빌드된 pdf.js 래퍼라 별도 워커
// 파일(pdf.worker.js)이 필요 없다. (pdfjs-dist 를 직접 쓰면 serverless 번들에서
// 'Cannot find module ./pdf.worker.js' 로 실패한다.)

export interface ReceiptInfo {
  page: number; // 0-based 원본 페이지 인덱스
  side: "L" | "R"; // 좌/우 영수증
  approval: string; // 승인번호(숫자만, 선행 0 제거). 없으면 ""
  merchant: string; // 가맹점명(보고/취소 매칭용)
  amount: number; // 거래금액(원). 추출 실패 시 0
  hasContent: boolean;
}

export interface ParsedReceipts {
  receipts: ReceiptInfo[];
  pageCount: number;
  error?: string;
}

// 숫자만 남기고 선행 0 제거 → 승인번호 비교 키
export function approvalKey(s: string): string {
  const d = String(s ?? "").replace(/[^0-9]/g, "");
  if (!d) return "";
  const n = d.replace(/^0+/, "");
  return n || "0";
}

function num(s: string): number {
  const cleaned = String(s ?? "").replace(/[^0-9.]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

// 한 영수증(한쪽 면)의 텍스트 라인들에서 필드를 뽑는다.
function extractFields(lines: string[]): {
  approval: string;
  merchant: string;
  amount: number;
} {
  const flat = lines.join(" ").replace(/\s+/g, " ");

  let approval = "";
  const am = flat.match(/승인번호[^0-9]{0,8}([0-9]{4,12})/);
  if (am) approval = approvalKey(am[1]);

  let merchant = "";
  for (const ln of lines) {
    const mm = ln.match(/가맹점명[^가-힣A-Za-z0-9]*(.+)/);
    if (mm && mm[1].trim()) {
      merchant = mm[1].trim();
      break;
    }
  }

  let amount = 0;
  const amt = flat.match(/거래금액[^0-9-]{0,8}(-?[0-9,]+)\s*원/);
  if (amt) amount = num(amt[1]);

  return { approval, merchant, amount };
}

export async function parseReceiptPdf(
  data: Uint8Array,
): Promise<ParsedReceipts> {
  let getDocumentProxy: any;
  try {
    const mod: any = await import("unpdf");
    getDocumentProxy = mod.getDocumentProxy;
  } catch (e: any) {
    return {
      receipts: [],
      pageCount: 0,
      error: "pdf 라이브러리 로드 실패: " + (e?.message || e),
    };
  }

  try {
    // unpdf 는 워커 없이 메인 스레드에서 동작하는 pdf.js 를 내장한다.
    // 주의: pdf.js 는 넘겨받은 ArrayBuffer 의 소유권을 가져가며 detach(무효화)한다.
    // 호출자의 원본 버퍼를 보호하려면 반드시 복사본을 넘겨야 한다. 안 그러면
    // 같은 바이트를 재사용하는 pdf-lib 쪽에서 "No PDF header found" 로 실패한다.
    const doc: any = await getDocumentProxy(new Uint8Array(data));
    const receipts: ReceiptInfo[] = [];

    for (let p = 0; p < doc.numPages; p++) {
      const page = await doc.getPage(p + 1);
      const viewport = page.getViewport({ scale: 1 });
      const mid = viewport.width / 2;
      const content = await page.getTextContent();

      const left: { x: number; y: number; s: string }[] = [];
      const right: { x: number; y: number; s: string }[] = [];
      for (const it of content.items as any[]) {
        const s = String(it.str ?? "");
        if (!s.trim()) continue;
        const x = it.transform[4];
        const y = it.transform[5];
        (x < mid ? left : right).push({ x, y, s });
      }

      for (const side of ["L", "R"] as const) {
        const toks = side === "L" ? left : right;
        if (toks.length === 0) continue;
        // y 내림차순(위→아래)으로 줄을 묶고, 각 줄은 x 오름차순(왼→오른)
        toks.sort((a, b) => b.y - a.y || a.x - b.x);
        const lines: string[] = [];
        let curY = Infinity;
        let cur: { x: number; s: string }[] = [];
        const flush = () => {
          if (cur.length) {
            cur.sort((a, b) => a.x - b.x);
            lines.push(cur.map((t) => t.s).join(" "));
          }
          cur = [];
        };
        for (const t of toks) {
          if (Math.abs(t.y - curY) > 2.5) {
            flush();
            curY = t.y;
          }
          cur.push({ x: t.x, s: t.s });
        }
        flush();

        const text = lines.join("\n");
        const hasContent = /(매출전표|거래일시|승인번호|가맹점)/.test(text);
        if (!hasContent) continue;
        const f = extractFields(lines);
        receipts.push({
          page: p,
          side,
          approval: f.approval,
          merchant: f.merchant,
          amount: f.amount,
          hasContent: true,
        });
      }
    }

    return { receipts, pageCount: doc.numPages };
  } catch (e: any) {
    return {
      receipts: [],
      pageCount: 0,
      error: "영수증 PDF 파싱 실패: " + (e?.message || e),
    };
  }
}
