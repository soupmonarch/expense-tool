import type { Category, Group } from "./categories";

// 업로드된 카드 내역에서 파싱한 정규화된 거래 한 건.
// 한국 법인카드는 해외 사용도 원화로 변제하므로 `amount`는 원화 금액이고
// 양식의 통화는 항상 "KRW"다. `isForeign`은 국내/해외 출장 분류에만 영향을 준다.
export interface Transaction {
  rowIndex: number;
  date?: string;
  time?: string; // 승인/이용 시간 (HH:mm) — 결제대행사 수동분류 안내에 사용
  merchant: string;
  amount: number;
  currency: string;
  merchantCategory?: string; // 가맹점업종명 (MCC name)
  isForeign?: boolean;
  canceled?: boolean; // 취소 건 여부 (취소 정산에서 사용)
  raw?: Record<string, unknown>;
}

export type ClassificationSource = "learned" | "mcc" | "rule" | "ai" | "gateway" | "none";

export interface ClassifiedTransaction extends Transaction {
  id: number; // UI용 안정 id (rowIndex 사용)
  group: Group | "unclassified";
  category: Category | "UNCLASSIFIED";
  source: ClassificationSource;
  confidence?: number;
  needsReview?: boolean; // true -> 검토 팝업에서 사용자에게 확인
  noLearn?: boolean; // true -> 결제대행사 등: 절대 학습하지 않음
}

// 사용자가 분류를 검토/수정한 뒤 /api/generate 로 다시 전달되는 형태.
export interface FinalRow {
  date?: string;
  merchant: string;
  amount: number;
  currency?: string;
  category: string;
}
