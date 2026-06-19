// The canonical category list comes from the official form's "DataSource" sheet.
// Values written into column C MUST exactly match one of these strings, otherwise
// the company's import/validation will reject the file.

export const EXPENSE_CATEGORIES = [
  "KR-Office Expenses - Courier and Postage Fees",
  "KR-Office Expenses - Office Supplies",
  "KR-TELEPHONE EXPENSES",
  "KR-Business Entertainment Expenses",
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
  "KR-Domestic Business Travel - Car Rental/Fuel Costs",
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

// Sentinel used when neither rules nor AI could classify a row.
export const UNCLASSIFIED = "UNCLASSIFIED" as const;
