// The canonical category list comes from the official form's "DataSource" sheet.
// Values written into column C MUST exactly match one of these strings, otherwise
// the company's import/validation will reject the file.

export const EXPENSE_CATEGORIES = [
  "KR-Tax and Surcharge - Other",
  "KR-Employee Training - External Training",
  "KR-Employee Training - External Instructor",
  "KR-Personnel Costs - Team Building",
  "KR-Personnel Costs - Medical Examination",
  "KR-Personnel Costs - Other Benefits",
  "KR-Personnel Costs - Employee Welfare Expenses",
  "KR-Employee Supplemental Insurance",
  "KR-Social Security Expenses",
  "KR-Insurance - Property Insurance",
  "KR-Insurance - Product Insurance",
  "KR-Insurance - Vehicle Insurance",
  "KR-Lease Expenses - Warehouse rental",
  "KR-Lease Expenses - Vehicle Rental",
  "KR-Lease Expenses -Building and land rental",
  "KR-Office Expenses - Property Management Fees",
  "KR-Freight",
  "KR-Office Expenses - Courier and Postage Fees",
  "KR-ARTICLE OF CONSUMPTION-EXCIPIENT",
  "KR-Fuel charge",
  "KR-Office Expenses - Office Supplies",
  "KR-TELEPHONE EXPENSES",
  "KR-Utilities - Electricity",
  "KR-Agency Fees - Audit Fees",
  "KR-Agency Fees - Consultation Fees",
  "KR-Maintenance Costs - Maintenance Outsourcing Fees",
  "KR-Agency Fees - CERTIFICATION FEE",
  "KR-Advertising and Promotion Expenses",
  "KR-EXHIBITION FEES",
  "KR-Business Entertainment Expenses",
  "KR-Office Expenses - Software Costs",
  "KR-Office Expenses - Printing Costs",
  "KR-RECRUITING FEE",
  "KR-Fixed assets",
] as const;

export const TRAVEL_CATEGORIES = [
  "KR-Travel Costs - Travel Allowance",
  "KR-Overseas Business Travel - Airfare",
  "KR-Overseas Business Travel - Accommodation",
  "KR-Overseas Business Travel - Other Transportation",
  "KR-Domestic Business Travel - Airfare",
  "KR-Domestic Business Travel - Accommodation",
  "KR-Domestic Business Travel - Parking and Toll Charges",
  "KR-Domestic Business Travel - Other Transportation",
  "KR-Domestic Business Travel - Car Rental",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type TravelCategory = (typeof TRAVEL_CATEGORIES)[number];
export type Category = ExpenseCategory | TravelCategory;

export type Group = "expense" | "travel";

export const ALL_CATEGORIES: Category[] = [
  ...EXPENSE_CATEGORIES,
  ...TRAVEL_CATEGORIES,
];

export function groupOf(category: Category): Group {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(category)
    ? "expense"
    : "travel";
}

// 회사 양식 개정으로 이름이 바뀐 카테고리(옛 이름 → 새 이름).
// 공유 저장소(KV)에 옛 이름으로 학습된 데이터도 읽을 때 자동으로 새 이름으로 변환된다.
export const LEGACY_CATEGORY_RENAMES: Record<string, string> = {
  "KR-Domestic Business Travel - Car Rental/Fuel Costs":
    "KR-Domestic Business Travel - Car Rental",
};

export function canonCategory(category: string): string {
  return LEGACY_CATEGORY_RENAMES[category] ?? category;
}

// Sentinel used when neither rules nor AI could classify a row.
export const UNCLASSIFIED = "UNCLASSIFIED" as const;
