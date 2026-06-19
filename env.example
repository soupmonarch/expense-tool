import type { Category, Group } from "./categories";

// A single normalized transaction parsed from the uploaded card statement.
// Korean corporate cards reimburse in KRW even for overseas spend, so `amount`
// is the KRW amount and form `currency` is always "KRW". `isForeign` only
// affects domestic-vs-overseas travel categories.
export interface Transaction {
  rowIndex: number;
  date?: string;
  merchant: string;
  amount: number;
  currency: string;
  merchantCategory?: string; // 가맹점업종명 (MCC name)
  isForeign?: boolean;
  canceled?: boolean;
  raw?: Record<string, unknown>;
}

export type ClassificationSource = "learned" | "mcc" | "rule" | "ai" | "none";

export interface ClassifiedTransaction extends Transaction {
  id: number; // stable id for the UI (uses rowIndex)
  group: Group | "unclassified";
  category: Category | "UNCLASSIFIED";
  source: ClassificationSource;
  confidence?: number;
  needsReview?: boolean; // true -> ask the user in the review popup
}

// Shape posted back from the client to /api/generate after the user has
// reviewed/edited categories.
export interface FinalRow {
  date?: string;
  merchant: string;
  amount: number;
  currency?: string;
  category: string;
}
