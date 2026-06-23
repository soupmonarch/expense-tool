// 엑셀 행(순번대로) ↔ 영수증 매칭 후, pdf-lib 로 영수증을 잘라
// 한 페이지에 하나씩 엑셀 순번과 동일하게 나열한 PDF를 만든다.
//
// 규칙(사용자 확정):
//  - 정상 거래        : 영수증 1장 = 1페이지 (엑셀 순번과 동일)
//  - 부분취소/수수료 : 한 페이지에 구매+취소 영수증 둘 다 (좌=구매, 우=취소)
//  - 전액상쇄(순액 0) : 엑셀·PDF 모두에서 제외 (이미 reconcile 단계에서 빠짐)
//  - 매칭 안 되는 영수증 : PDF에서 제외, 리포트로만 알림

import { PDFDocument } from "pdf-lib";
import { normalizeMerchant } from "./store";
import { approvalKey, type ReceiptInfo } from "./parseReceipts";

export interface RowMeta {
  approval?: string; // 결제 승인번호
  merchant: string;
  cancel?: { amount: number }; // 부분취소 행 → 취소 영수증도 같이 첨부
}

interface Half {
  page: number;
  side: "L" | "R";
}

export interface MatchPlan {
  // 각 원소 = 한 출력 페이지에 들어갈 반쪽 면 목록(1개=단일, 2개=구매+취소)
  pages: Half[][];
  matchedRows: number; // 영수증을 찾은 행 수
  missingRows: number; // 영수증을 못 찾은 행 수
}

export interface MatchSummary {
  expense: MatchPlan;
  travel: MatchPlan;
  leftover: ReceiptInfo[]; // 어느 행에도 매칭되지 않은 영수증
}

// 공유 영수증 풀에서 expense → travel 순서로 소비하며 매칭
export function matchReceipts(
  expenseRows: RowMeta[],
  travelRows: RowMeta[],
  receipts: ReceiptInfo[],
): MatchSummary {
  const used = new Set<number>(); // receipts 배열 인덱스

  const byApproval = new Map<string, number>();
  receipts.forEach((r, i) => {
    const k = approvalKey(r.approval);
    if (k && !byApproval.has(k)) byApproval.set(k, i);
  });

  function takePurchase(meta: RowMeta): number {
    const k = approvalKey(meta.approval || "");
    if (k && byApproval.has(k)) {
      const idx = byApproval.get(k)!;
      if (!used.has(idx)) return idx;
    }
    // 폴백: 같은 가맹점명 + 승인번호 있는 미사용 영수증
    const target = normalizeMerchant(meta.merchant);
    for (let i = 0; i < receipts.length; i++) {
      if (used.has(i)) continue;
      if (!receipts[i].approval) continue;
      if (normalizeMerchant(receipts[i].merchant) === target) return i;
    }
    return -1;
  }

  function takeCancel(meta: RowMeta): number {
    if (!meta.cancel) return -1;
    const target = normalizeMerchant(meta.merchant);
    const want = meta.cancel.amount;
    // 취소 영수증은 보통 승인번호가 비어있다. 가맹점명 + 금액으로 찾는다.
    let best = -1;
    for (let i = 0; i < receipts.length; i++) {
      if (used.has(i)) continue;
      if (normalizeMerchant(receipts[i].merchant) !== target) continue;
      const blank = !receipts[i].approval;
      const amtClose = want > 0 && Math.abs(receipts[i].amount - want) <= 1;
      if (blank && amtClose) return i;
      if (blank && best < 0) best = i;
      if (amtClose && best < 0) best = i;
    }
    return best;
  }

  function planFor(rows: RowMeta[]): MatchPlan {
    const pages: Half[][] = [];
    let matched = 0;
    let missing = 0;
    for (const meta of rows) {
      const halves: Half[] = [];
      const pIdx = takePurchase(meta);
      if (pIdx >= 0) {
        used.add(pIdx);
        halves.push({ page: receipts[pIdx].page, side: receipts[pIdx].side });
        matched++;
      } else {
        missing++;
      }
      const cIdx = takeCancel(meta);
      if (cIdx >= 0) {
        used.add(cIdx);
        halves.push({ page: receipts[cIdx].page, side: receipts[cIdx].side });
      }
      if (halves.length > 0) pages.push(halves);
    }
    return { pages, matchedRows: matched, missingRows: missing };
  }

  const expense = planFor(expenseRows);
  const travel = planFor(travelRows);
  const leftover = receipts.filter((_, i) => !used.has(i));
  return { expense, travel, leftover };
}

// plan 대로 원본 PDF를 잘라 새 PDF를 구성한다.
export async function renderReceiptPdf(
  srcBytes: Uint8Array,
  plan: MatchPlan,
): Promise<Uint8Array> {
  const src = await PDFDocument.load(srcBytes);
  const out = await PDFDocument.create();

  // 영수증 이미지는 절반 크기로 축소해 배치한다(사용자 요청).
  const SCALE = 0.5;
  const GAP = 16;

  for (const group of plan.pages) {
    const embeds = [];
    for (const half of group) {
      const srcPage = src.getPage(half.page);
      const size = srcPage.getSize();
      const mid = size.width / 2;
      const box =
        half.side === "L"
          ? { left: 0, bottom: 0, right: mid, top: size.height }
          : { left: mid, bottom: 0, right: size.width, top: size.height };
      const emb = await out.embedPage(srcPage, box);
      embeds.push(emb);
    }

    if (embeds.length === 1) {
      // 단일 영수증: 원본 한 면 크기 페이지에 50%로 상단 중앙 배치(여백 확보).
      const e = embeds[0];
      const w = e.width * SCALE;
      const h = e.height * SCALE;
      const np = out.addPage([e.width, e.height]);
      np.drawPage(e, {
        x: (e.width - w) / 2,
        y: e.height - h,
        width: w,
        height: h,
      });
    } else {
      // 구매(좌) + 취소(우)를 각각 50%로 줄여 한 페이지에 나란히.
      const scaled = embeds.map((e) => ({
        e,
        w: e.width * SCALE,
        h: e.height * SCALE,
      }));
      const h = Math.max(...scaled.map((s) => s.h));
      const totalW =
        scaled.reduce((a, s) => a + s.w, 0) + GAP * (scaled.length - 1);
      const np = out.addPage([totalW, h]);
      let x = 0;
      for (const s of scaled) {
        np.drawPage(s.e, { x, y: h - s.h, width: s.w, height: s.h });
        x += s.w + GAP;
      }
    }
  }

  // 빈 그룹(매칭 영수증 없음) 대비 — 페이지가 하나도 없으면 안내 페이지 1장
  if (out.getPageCount() === 0) {
    out.addPage([300, 120]);
  }
  return await out.save();
}
