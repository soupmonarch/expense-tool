import type { Transaction } from "./types";
import { normalizeMerchant } from "./store";

// 취소·환불 정산.
// 같은 가맹점의 원결제와 취소 건을 매칭해서 최종 금액을 한 건으로 만든다.
//  - 금액이 (오차 이내로) 일치하는 취소  -> 전액취소로 보고 원결제·취소 모두 자동 제외
//  - 짝이 없는 취소(원결제 미포함)        -> 금액을 부풀리지 않도록 단순 제외
//  - 금액이 다른 취소(부분취소/재결제 등) -> 확신할 수 없으므로 사용자에게 확인 질문
// surviving payments 는 원래 금액을 그대로 유지한다(순액은 클라이언트가 적용).

export interface CancelQuestion {
  paymentId: number; // 대상 원결제 행의 rowIndex (= ClassifiedTransaction.id)
  merchant: string;
  paymentAmount: number;
  cancelAmount: number;
  proposedNet: number; // max(0, paymentAmount - cancelAmount)
  paymentDate?: string;
  cancelDate?: string;
}

export interface ReconcileResult {
  payments: Transaction[]; // 분류 대상이 되는 살아남은 결제 건(원래 금액 유지)
  questions: CancelQuestion[];
  autoVoided: number; // 자동 제외된 건 수(전액취소 + 고아 취소)
}

const TOLERANCE = 1; // 원 단위 반올림 오차 허용

export function reconcileCancellations(transactions: Transaction[]): ReconcileResult {
  const payments = transactions.filter((t) => !t.canceled);
  const cancels = transactions.filter((t) => t.canceled);

  const byMerchant = new Map<string, Transaction[]>();
  for (const p of payments) {
    const key = normalizeMerchant(p.merchant);
    const arr = byMerchant.get(key) || [];
    arr.push(p);
    byMerchant.set(key, arr);
  }

  const consumed = new Set<number>();
  const questioned = new Set<number>();
  const questions: CancelQuestion[] = [];
  let autoVoided = 0;

  for (const c of cancels) {
    const key = normalizeMerchant(c.merchant);
    const candidates = (byMerchant.get(key) || []).filter(
      (p) => !consumed.has(p.rowIndex) && !questioned.has(p.rowIndex),
    );

    if (candidates.length === 0) {
      autoVoided++; // 고아 취소: 매칭할 원결제 없음 -> 그냥 버림
      continue;
    }

    const exact = candidates.find((p) => Math.abs(p.amount - c.amount) <= TOLERANCE);
    if (exact) {
      consumed.add(exact.rowIndex);
      autoVoided++; // 전액취소 -> 원결제까지 조용히 제외
      continue;
    }

    // 불확실: 취소액보다 큰 결제 중 가장 작은 것을, 없으면 가장 큰 결제를 대상으로.
    const bigger = candidates
      .filter((p) => p.amount > c.amount)
      .sort((a, b) => a.amount - b.amount);
    const target = bigger.length
      ? bigger[0]
      : [...candidates].sort((a, b) => b.amount - a.amount)[0];

    questioned.add(target.rowIndex);
    questions.push({
      paymentId: target.rowIndex,
      merchant: target.merchant,
      paymentAmount: target.amount,
      cancelAmount: c.amount,
      proposedNet: Math.max(0, target.amount - c.amount),
      paymentDate: target.date,
      cancelDate: c.date,
    });
  }

  const surviving = payments.filter((p) => !consumed.has(p.rowIndex));
  return { payments: surviving, questions, autoVoided };
}
