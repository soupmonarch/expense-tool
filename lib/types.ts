import type { Category, Group } from "./categories";

// A single normalized transaction parsed from the uploaded card statement.
export interface Transaction {
  rowIndex: number; // original row in the source file (for debugging)
  date?: string; // raw date string if available
  merchant: string; // merchant / description text used for classification
  amount: number; // total amount (positive)
  currency: string; // ISO-ish currency code, defaults to "KRW"
  raw?: Record<string, unknown>;
}

export type ClassificationSource = "rule" | "ai" | "none";

export interface ClassifiedTransaction extends Transaction {
  group: Group | "unclassified";
  category: Category | "UNCLASSIFIED";
  source: ClassificationSource;
  confidence?: number;
}
