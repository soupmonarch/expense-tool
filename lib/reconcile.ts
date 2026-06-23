import type { Transaction } from "./types";
import { normalizeMerchant } from "./store";

// 취소·환불 정산 (사용자 확정 설계).
//
// 카드사마다 취소 표기가 다르므로 신뢰도 순으로 단계적으로 연결한다.
//   ① 승인번호 그룹      : 결제와 취소의 승인번호가 같은 카드(예: BC계열).
//                          그룹 부호합으로 전액/부분취소를 자동 판정. (고신뢰, 질문 없음)
//   ② 행 내 취소 플래그   : 취소여부=Y / 전표구분=취소 로 표시되는 카드(예: 롯데).
//                          플래그된 양수 원결제는 전액취소로 자동 제외. (고신뢰, 질문 없음)
//   ③ 휴리스틱           : 승인번호가 다른 카드. 같은 가맹점 + 동일 취소금액(날짜 무관)으로
//                          추정 매칭 → 사용자에게 확인. 매칭 실패 음수는 '고아 환불'로 확인.
//
// 가승인(pre-auth) 음수 건은 실제 청구가 아니므로 무조건 자동 제외한다.
// surviving payments 중 자동 부분취소가 반영된 건은 amount=순액, cancelAmount=취소액(절댓값).

export type CancelQuestionKind = "heuristic" | "orphan";

export interface CancelQuestion {
  id: number; // 고유 키 (취소 행 rowIndex)
  kind: CancelQuestionKind;
  merchant: string;
  cancelAmount: number; // 취소/환불 금액(절댓값)
  cancelDate?: string;
  cancelTime?: string;
  // heuristic 전용: 추정 매칭된 원결제
  paymentId?: number;
  paymentAmount?: number;
  paymentDate?: string;
}

export interface ReconcileResult {
  payments: Transaction[]; // 분류 대상이 되는 살아남은 결제 건
  questions: CancelQuestion[];
  autoVoided: number; // 자동 제외된 건 수(전액취소 + 가승인 등)
}

const TOLERANCE = 1; // 원 단위 반올림 오차 허용

// 승인번호 비교 키(숫자만, 선행 0 제거). 비어 있으면 "".
function approvalGroupKey(t: Transaction): string {
  const d = String(t.approval ?? "")
    .replace(/[^0-9]/g, "")
    .replace(/^0+/, "");
  return d || "";
}

// 부호 보존 금액. rawAmount 가 없으면(구버전 파싱) amount 를 그대로 사용.
function signed(t: Transaction): number {
  return typeof t.rawAmount === "number" ? t.rawAmount : t.amount;
}

export function reconcileCancellations(
  transactions: Transaction[],
): ReconcileResult {
  const consumed = new Set<number>(); // 제외/그룹처리된 rowIndex
  const questions: CancelQuestion[] = [];
  let autoVoided = 0;

  // 자동 부분취소 결과(살아남은 결제에 반영)
  const netAmount = new Map<number, number>(); // rowIndex -> 순액
  const cancelLink = new Map<number, number>(); // rowIndex -> 취소액 합(절댓값)

  // 0) 가승인(pre-auth): 자동 제외 (실제 청구는 별도 정상 행)
  for (const t of transactions) {
    if (t.preauth) {
      consumed.add(t.rowIndex);
      autoVoided++;
    }
  }

  // 1) 승인번호 그룹 — 고신뢰 자동 정산
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (consumed.has(t.rowIndex)) continue;
    const k = approvalGroupKey(t);
    if (!k) continue;
    const arr = groups.get(k) || [];
    arr.push(t);
    groups.set(k, arr);
  }
  for (const [, arr] of groups) {
    if (arr.length < 2) continue;
    const hasNeg = arr.some((t) => signed(t) < 0 || t.canceled);
    const hasPos = arr.some((t) => signed(t) > 0);
    if (!hasNeg || !hasPos) continue; // 취소 관계가 아닌 그룹은 통과

    const net = arr.reduce((s, t) => s + signed(t), 0);
    const posSum = arr
      .filter((t) => signed(t) > 0)
      .reduce((s, t) => s + signed(t), 0);

    // 그룹 전체를 일단 소비 처리한 뒤, 살릴 건만 되돌린다.
    for (const t of arr) consumed.add(t.rowIndex);

    if (Math.abs(net) <= TOLERANCE) {
      autoVoided += arr.length; // 전액취소 → 그룹 전체 제외
      continue;
    }

    const survivor = arr
      .filter((t) => signed(t) > 0)
      .sort((a, b) => signed(b) - signed(a))[0];

    if (net > 0 && net < posSum - TOLERANCE) {
      // 부분취소 → 대표 결제 1건만 순액으로 남김
      consumed.delete(survivor.rowIndex);
      netAmount.set(survivor.rowIndex, net);
      cancelLink.set(survivor.rowIndex, posSum - net);
      autoVoided += arr.length - 1;
      continue;
    }

    if (net > 0) {
      // 취소가 사실상 무효(순액 ≈ 양수합) → 대표 양수만 유지
      consumed.delete(survivor.rowIndex);
      autoVoided += arr.length - 1;
      continue;
    }

    // net 음수(환불 초과) → 전부 제외
    autoVoided += arr.length;
  }

  // 2) 행 내 취소 플래그 — 고신뢰 자동 (남은 것 중)
  for (const t of transactions) {
    if (consumed.has(t.rowIndex)) continue;
    if (!t.canceled) continue;
    if (signed(t) > 0) {
      // 전액취소된 원결제 행 → 제외
      consumed.add(t.rowIndex);
      autoVoided++;
    }
    // 음수 플래그 취소행은 아래 ③에서 휴리스틱/고아로 처리
  }

  // 3) 휴리스틱 / 고아 — 남은 음수 이벤트
  const leftoverNeg = transactions.filter(
    (t) => !consumed.has(t.rowIndex) && signed(t) < 0,
  );
  const payPool = transactions.filter(
    (t) => !consumed.has(t.rowIndex) && signed(t) > 0 && !t.canceled,
  );
  const matched = new Set<number>();

  for (const c of leftoverNeg) {
    // 음수 이벤트 자체는 분류 대상에서 빼고 질문으로만 다룬다.
    consumed.add(c.rowIndex);
    const abs = Math.abs(signed(c));
    const cand = payPool.find(
      (p) =>
        !matched.has(p.rowIndex) &&
        normalizeMerchant(p.merchant) === normalizeMerchant(c.merchant) &&
        Math.abs(p.amount - abs) <= TOLERANCE,
    );
    if (cand) {
      matched.add(cand.rowIndex);
      questions.push({
        id: c.rowIndex,
        kind: "heuristic",
        merchant: c.merchant || cand.merchant,
        cancelAmount: abs,
        cancelDate: c.date,
        cancelTime: c.time,
        paymentId: cand.rowIndex,
        paymentAmount: cand.amount,
        paymentDate: cand.date,
      });
    } else {
      questions.push({
        id: c.rowIndex,
        kind: "orphan",
        merchant: c.merchant,
        cancelAmount: abs,
        cancelDate: c.date,
        cancelTime: c.time,
      });
    }
  }

  // 살아남은 결제 + 순액/취소 정보 반영
  const surviving = transactions
    .filter((t) => !consumed.has(t.rowIndex))
    .map((t) => {
      const net = netAmount.get(t.rowIndex);
      const cancel = cancelLink.get(t.rowIndex);
      if (net === undefined && cancel === undefined) return t;
      return {
        ...t,
        amount: net !== undefined ? net : t.amount,
        rawAmount: net !== undefined ? net : t.rawAmount,
        cancelAmount: cancel,
      };
    });

  return { payments: surviving, questions, autoVoided };
}
