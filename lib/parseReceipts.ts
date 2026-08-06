// 카드사에서 출력한 영수증(매출전표) PDF를 파싱한다.
//
// 지원 양식:
//  1) 라벨형(기존): 한 페이지에 좌/우 2장. "승인번호", "가맹점명", "거래금액" 등의
//     라벨이 텍스트로 존재한다. → 라벨 정규식으로 추출.
//  2) 그리드형(신규, "카드매출전표 인터넷 재발급용"): 한 페이지에 2×2 = 최대 4장.
//     라벨이 전부 이미지라 텍스트에는 값만 존재한다. → 전표번호(예:
//     20260607EV05W500756399)를 앵커로 컬럼을 세로 분할하고, 위치 기반으로
//     승인번호/가맹점명/합계(TOTAL)/거래일시를 추출한다. 각 영수증의 crop
//     영역(box)도 계산해 최종 PDF에서 한 장씩 잘라낼 수 있게 한다.
//
// 추출한 승인번호로 카드 승인내역 엑셀의 각 행과 1:1로 매칭한다.
//
// unpdf 는 serverless(Node/Vercel) 전용으로 빌드된 pdf.js 래퍼라 별도 워커
// 파일(pdf.worker.js)이 필요 없다.
//
// 중요: pdf.js 는 글자를 잘게 쪼개 여러 텍스트 조각으로 돌려주는 경우가 많다
// (예: "승","인","번","호"). 따라서 조각들을 공백 없이 이어 붙인 뒤 매칭한다.

import type { Transaction } from "./types";

// PDF 좌표계(원점=왼쪽 아래) 기준 crop 영역
export interface ReceiptBox {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export interface ReceiptInfo {
  page: number; // 0-based 원본 페이지 인덱스
  side: "L" | "R"; // 좌/우 컬럼
  approval: string; // 승인번호(숫자만, 선행 0 제거). 없으면 ""
  merchant: string; // 가맹점명(보고/취소 매칭용)
  amount: number; // 거래금액(원, 절댓값). 추출 실패 시 0
  date?: string; // 거래일시의 날짜 (예: 2026.03.27)
  time?: string; // 거래일시의 시각 (HH:mm)
  canceled: boolean; // 취소/환불 영수증이면 true
  hasContent: boolean;
  box?: ReceiptBox; // 그리드형: 이 영수증의 crop 영역(없으면 좌/우 반쪽 전체)
}

export interface ParsedReceipts {
  receipts: ReceiptInfo[];
  pageCount: number;
  error?: string;
  sample?: string; // 진단용: 인식 0건일 때 텍스트 추출 상태를 리포트에 남긴다
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

// ---------------------------------------------------------------------------
// 라벨형(기존 양식): 공백을 제거해 이어 붙인 한 면의 텍스트에서 필드를 뽑는다.
// ---------------------------------------------------------------------------
function extractFields(joined: string): {
  approval: string;
  merchant: string;
  amount: number;
  date?: string;
  time?: string;
  canceled: boolean;
} {
  let approval = "";
  const am = joined.match(/승인번호([0-9]{4,12})/);
  if (am) approval = approvalKey(am[1]);

  let merchant = "";
  const mm = joined.match(
    /가맹점명(.+?)(대표자명|사업자번호|전화번호|가맹점번호|주소|상기거래|$)/,
  );
  if (mm && mm[1]) merchant = mm[1].trim();

  let amount = 0;
  const amt = joined.match(/거래금액(-?[0-9,]+)원/);
  if (amt) amount = Math.abs(num(amt[1]));

  // 거래일시: 공백을 제거한 텍스트라 날짜와 시각이 붙어 있다(예: 2026.03.2717:27).
  // 월/일/시는 2자리를 먼저 시도해야 "27"을 "2"로 잘못 끊지 않는다.
  let date: string | undefined;
  let time: string | undefined;
  const dm = joined.match(
    /거래일시(?:\(DateTime\))?(\d{4})[.\-/](1[0-2]|0[1-9]|[1-9])[.\-/](3[01]|[12]\d|0[1-9]|[1-9])\s*((?:2[0-3]|[01]?\d):[0-5]\d)?/,
  );
  if (dm) {
    date = `${dm[1]}.${dm[2].padStart(2, "0")}.${dm[3].padStart(2, "0")}`;
    if (dm[4]) {
      const tm = dm[4].match(/(\d{1,2}):(\d{2})/);
      if (tm) time = tm[1].padStart(2, "0") + ":" + tm[2];
    }
  }

  // 취소/환불 영수증 감지: 거래금액이 음수이거나 취소 관련 거래유형이 보일 때.
  const negative = /거래금액-[0-9,]+원/.test(joined);
  const canceled =
    negative ||
    /(신용취소|매입취소|승인취소|취소승인|매출취소|환불)/.test(joined);

  return { approval, merchant, amount, date, time, canceled };
}

// ---------------------------------------------------------------------------
// 그리드형(신규 양식): 전표번호를 앵커로 위치 기반 추출.
// ---------------------------------------------------------------------------

interface TextLine {
  y: number; // 라인의 y 좌표(원점=아래)
  t: string; // 공백 제거 후 이어 붙인 라인 텍스트
}

// 전표번호: YYYYMMDD + 영숫자 조합(예: 20260607EV05W500756399)
const GRID_ANCHOR = /^20\d{6}[A-Z0-9]{8,}$/;
// 거래일시: 2026/06/06 + (붙어 있는) 15:44 — 공백 제거된 라인 기준
const GRID_DATE_SRC =
  "(20\\d{2})\\/(0[1-9]|1[0-2])\\/(0[1-9]|[12]\\d|3[01])((?:2[0-3]|[01]\\d):[0-5]\\d)?";
// 취소시당초거래일 등 날짜만 있는 라인(가맹점명 후보에서 제외)
const GRID_DATE_ONLY = /^20\d{2}\/[01]\d\/[0-3]\d$/;
// 금액 라인: 합계(TOTAL)는 세그먼트의 마지막 순수 숫자 라인
const PURE_NUMBER = /^-?[0-9][0-9,]*$/;
// 승인번호: 라인 끝의 6~9자리 숫자(예: "이*환00092004", "618533")
const APPROVAL_TAIL = /(?:^|[^0-9])([0-9]{6,9})$/;

function parseGridReceipts(
  lines: TextLine[],
  side: "L" | "R",
  pageWidth: number,
  pageHeight: number,
  pageIndex: number,
): ReceiptInfo[] {
  const anchorIdx: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (GRID_ANCHOR.test(lines[i].t)) anchorIdx.push(i);
  }
  if (anchorIdx.length === 0) return [];

  const mid = pageWidth / 2;
  const out: ReceiptInfo[] = [];

  for (let k = 0; k < anchorIdx.length; k++) {
    const start = anchorIdx[k];
    const end = k + 1 < anchorIdx.length ? anchorIdx[k + 1] : lines.length;
    const seg = lines.slice(start, end);

    // 거래일시: 첫 날짜 매칭. 날짜가 2개 이상이면(취소시당초거래일) 취소 영수증.
    let date: string | undefined;
    let time: string | undefined;
    let dateCount = 0;
    for (const ln of seg) {
      const re = new RegExp(GRID_DATE_SRC, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(ln.t)) !== null) {
        dateCount++;
        if (!date) {
          date = `${m[1]}.${m[2]}.${m[3]}`;
          if (m[4]) time = m[4];
        }
      }
    }

    // 합계(TOTAL): 마지막 순수 숫자 라인. 음수면 취소 영수증.
    let totalText = "";
    for (const ln of seg) {
      if (PURE_NUMBER.test(ln.t)) totalText = ln.t;
    }
    const totalNum = totalText
      ? parseInt(totalText.replace(/,/g, ""), 10) || 0
      : 0;
    const amount = Math.abs(totalNum);

    // 승인번호: 위→아래로, 구분자(/ - , :) 없는 라인 중 6~9자리 숫자로 끝나는
    // 첫 라인(예: "이*환00092004" → 대표자명+승인번호가 한 행).
    let approval = "";
    let approvalLine = -1;
    for (let i = 1; i < seg.length; i++) {
      const t = seg[i].t;
      if (/[/\-,:]/.test(t)) continue;
      const m = APPROVAL_TAIL.exec(t);
      if (m) {
        approval = approvalKey(m[1]);
        approvalLine = i;
        break;
      }
    }

    // 가맹점명: 유효기간(…/**) 라인과 승인번호 라인 사이의 텍스트(=매장명).
    // 여러 줄로 감싸진 이름은 이어 붙인다. 취소 영수증의 당초거래일 라인은 제외.
    let merchant = "";
    let expLine = -1;
    for (let i = 0; i < seg.length; i++) {
      if (seg[i].t.includes("/**")) {
        expLine = i;
        break;
      }
    }
    if (expLine >= 0 && approvalLine > expLine) {
      const parts: string[] = [];
      for (let i = expLine + 1; i < approvalLine; i++) {
        if (GRID_DATE_ONLY.test(seg[i].t)) continue;
        parts.push(seg[i].t);
      }
      merchant = parts.join("").trim();
    }
    // 폴백: 승인번호 다음 라인(하단의 가맹점명 반복)
    if (!merchant && approvalLine >= 0 && approvalLine + 1 < seg.length) {
      const t = seg[approvalLine + 1].t;
      if (!PURE_NUMBER.test(t)) merchant = t;
    }

    const canceled = totalNum < 0 || dateCount >= 2;

    // crop 영역: 앵커(전표번호) 위 ~50pt(카드 상단 테두리+제목 포함)부터
    // 다음 앵커 직전(또는 마지막 텍스트 아래 30pt)까지.
    const anchorY = seg[0].y;
    let minY = anchorY;
    for (const ln of seg) {
      if (ln.y < minY) minY = ln.y;
    }
    const nextAnchorY =
      k + 1 < anchorIdx.length ? lines[anchorIdx[k + 1]].y : null;
    const box: ReceiptBox = {
      left: side === "L" ? 0 : mid,
      right: side === "L" ? mid : pageWidth,
      top: Math.min(pageHeight, anchorY + 50),
      bottom:
        nextAnchorY !== null ? nextAnchorY + 54 : Math.max(0, minY - 30),
    };

    out.push({
      page: pageIndex,
      side,
      approval,
      merchant,
      amount,
      date,
      time,
      canceled,
      hasContent: true,
      box,
    });
  }

  return out;
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
    // 주의: pdf.js 는 넘겨받은 ArrayBuffer 의 소유권을 가져가며 detach(무효화)한다.
    // 호출자의 원본 버퍼를 보호하려면 반드시 복사본을 넘겨야 한다.
    const doc: any = await getDocumentProxy(new Uint8Array(data));
    const receipts: ReceiptInfo[] = [];
    let totalItems = 0;
    let sample = "";

    for (let p = 0; p < doc.numPages; p++) {
      const page = await doc.getPage(p + 1);
      const viewport = page.getViewport({ scale: 1 });
      const mid = viewport.width / 2;
      const content = await page.getTextContent();

      const left: { x: number; y: number; s: string }[] = [];
      const right: { x: number; y: number; s: string }[] = [];
      for (const it of content.items as any[]) {
        const s = String(it.str ?? "");
        totalItems++;
        if (!s.trim()) continue;
        const tr = it.transform || it.matrix || [1, 0, 0, 1, 0, 0];
        const x = tr[4];
        const y = tr[5];
        (x < mid ? left : right).push({ x, y, s });
      }

      for (const side of ["L", "R"] as const) {
        const toks = side === "L" ? left : right;
        if (toks.length === 0) continue;
        // y 내림차순(위→아래), 같은 줄은 x 오름차순(왼→오른)
        toks.sort((a, b) => b.y - a.y || a.x - b.x);
        const lines: TextLine[] = [];
        let curY = Infinity;
        let cur: { x: number; s: string }[] = [];
        const flush = (y: number) => {
          if (cur.length) {
            cur.sort((a, b) => a.x - b.x);
            lines.push({
              y,
              t: cur
                .map((t) => t.s)
                .join("")
                .replace(/\s+/g, ""),
            });
          }
          cur = [];
        };
        let lineY = 0;
        for (const t of toks) {
          if (Math.abs(t.y - curY) > 2.5) {
            flush(lineY);
            curY = t.y;
            lineY = t.y;
          }
          cur.push({ x: t.x, s: t.s });
        }
        flush(lineY);

        // 모든 공백 제거 → 토큰 분할/줄바꿈에 영향받지 않게 매칭
        const joined = lines.map((l) => l.t).join("");
        if (p === 0 && side === "L") sample = joined.slice(0, 200);

        // 그리드형(신규): 라벨 텍스트가 없고 전표번호 앵커가 있으면 위치 기반 파싱
        const hasLegacyLabels = /(승인번호|가맹점명|거래금액)/.test(joined);
        if (!hasLegacyLabels) {
          const grid = parseGridReceipts(
            lines,
            side,
            viewport.width,
            viewport.height,
            p,
          );
          if (grid.length > 0) {
            receipts.push(...grid);
            continue;
          }
        }

        const hasContent = /(매출전표|거래일시|승인번호|가맹점)/.test(joined);
        if (!hasContent) continue;
        const f = extractFields(joined);
        receipts.push({
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
    }

    return {
      receipts,
      pageCount: doc.numPages,
      sample:
        receipts.length === 0
          ? "[진단] 추출 텍스트조각 " +
            totalItems +
            '개, p1-좌 샘플: "' +
            sample +
            '"'
          : undefined,
    };
  } catch (e: any) {
    return {
      receipts: [],
      pageCount: 0,
      error: "영수증 PDF 파싱 실패: " + (e?.message || e),
    };
  }
}

// PDF만 모드: 파싱한 영수증들을 분류 파이프라인이 쓰는 Transaction 으로 변환한다.
// 취소 영수증은 rawAmount 를 음수로 만들어 reconcileCancellations 가 자동
// 차감하도록 한다. rowIndex 는 호출부에서 전역 고유값으로 재부여한다.
export function receiptsToTransactions(receipts: ReceiptInfo[]): Transaction[] {
  return receipts.map((r, i) => {
    const amt = Math.abs(r.amount);
    return {
      rowIndex: i,
      date: r.date,
      time: r.time,
      merchant: r.merchant || "",
      amount: amt,
      rawAmount: r.canceled ? -amt : amt,
      currency: "KRW",
      isForeign: false,
      canceled: r.canceled,
      approval: r.approval || undefined,
    };
  });
}
