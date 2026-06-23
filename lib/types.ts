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
  preauth?: boolean; // 가승인(pre-auth) 건 → 정산에서 자동 제외
  approval?: string; // 승인번호 (영수증 PDF 매칭 키)
  rawAmount?: number; // 부호 보존 금액(음수=취소/환불/가승인). amount는 절댓값.
  cancelAmount?: number; // 자동 부분취소가 반영된 결제의 연결 취소액(절댓값) — 영수증 페어링용
  raw?: Record<string, unknown>;
}

export type ClassificationSource =
  | "learned"
  | "mcc"
  | "rule"
  | "ai"
  | "gateway"
  | "none";

export interface ClassifiedTransaction extends Transaction {
  id: number; // UI용 안정 id (rowIndex 사용)
  group: Group | "unclassified";
  category: Category | "UNCLASSIFIED";
  source: ClassificationSource;
  confidence?: number;
  needsReview?: boolean; // true -> 검토 팝업에서 사용자에게 확인
  noLearn?: boolean; // true -> 결제대행사 등: 절대 학습하지 않음
  suspectGateway?: boolean; // true -> PSP일 가능성(휴리스틱): 팝업에서 'PSP인가요?' 체크박스 제안
}

// 사용자가 분류를 검토/수정한 뒤 /api/generate 로 다시 전달되는 형태.
export interface FinalRow {
  date?: string;
  merchant: string;
  amount: number;
  currency?: string;
  category: string;
  approval?: string; // 승인번호 (영수증 매칭)
  cancel?: { amount: number }; // 부분취소 행 -> 취소 영수증도 함께 첨부
}
