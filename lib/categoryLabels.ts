// 분류(카테고리)의 한글 이름과 자주 쓰는 분류.
// 엑셀에는 항상 원래 영문 분류명이 들어가고, 한글 이름은 화면 표시·검색용이다.
import type { Category } from "./categories";

export const CATEGORY_KO: Record<Category, string> = {
  "KR-Tax and Surcharge - Other": "세금·공과금 (기타)",
  "KR-Employee Training - External Training": "외부 교육비",
  "KR-Employee Training - External Instructor": "외부 강사비",
  "KR-Personnel Costs - Team Building": "팀빌딩·회식",
  "KR-Personnel Costs - Medical Examination": "건강검진비",
  "KR-Personnel Costs - Other Benefits": "기타 복리후생 (선물·상품권 등)",
  "KR-Personnel Costs - Employee Welfare Expenses": "직원 복지비",
  "KR-Employee Supplemental Insurance": "직원 보충 보험",
  "KR-Social Security Expenses": "사회보험료",
  "KR-Insurance - Property Insurance": "재산 보험",
  "KR-Insurance - Product Insurance": "제품 보험",
  "KR-Insurance - Vehicle Insurance": "차량 보험",
  "KR-Lease Expenses - Warehouse rental": "창고 임차료",
  "KR-Lease Expenses - Vehicle Rental": "차량 임차료 (장기 렌트)",
  "KR-Lease Expenses -Building and land rental": "건물·토지 임차료",
  "KR-Office Expenses - Property Management Fees": "관리비",
  "KR-Freight": "운송비 (화물)",
  "KR-Office Expenses - Courier and Postage Fees": "택배·우편·퀵",
  "KR-ARTICLE OF CONSUMPTION-EXCIPIENT": "소모품",
  "KR-Fuel charge": "유류비",
  "KR-Office Expenses - Office Supplies": "사무용품",
  "KR-TELEPHONE EXPENSES": "통신비",
  "KR-Utilities - Electricity": "전기료",
  "KR-Agency Fees - Audit Fees": "감사 수수료",
  "KR-Agency Fees - Consultation Fees": "자문 수수료",
  "KR-Maintenance Costs - Maintenance Outsourcing Fees": "유지보수 외주비",
  "KR-Agency Fees - CERTIFICATION FEE": "인증 수수료",
  "KR-Advertising and Promotion Expenses": "광고·홍보비",
  "KR-EXHIBITION FEES": "전시회비",
  "KR-Business Entertainment Expenses": "접대비 (식대·카페·편의점)",
  "KR-Office Expenses - Software Costs": "소프트웨어·구독",
  "KR-Office Expenses - Printing Costs": "인쇄비",
  "KR-RECRUITING FEE": "채용 수수료",
  "KR-Fixed assets": "고정자산",
  "KR-Travel Costs - Travel Allowance": "출장 일비",
  "KR-Overseas Business Travel - Airfare": "해외출장 항공",
  "KR-Overseas Business Travel - Accommodation": "해외출장 숙박",
  "KR-Overseas Business Travel - Other Transportation": "해외출장 교통 (택시·기차 등)",
  "KR-Domestic Business Travel - Airfare": "국내출장 항공",
  "KR-Domestic Business Travel - Accommodation": "국내출장 숙박",
  "KR-Domestic Business Travel - Parking and Toll Charges": "주차·통행료",
  "KR-Domestic Business Travel - Other Transportation": "국내 교통 (택시·KTX 등)",
  "KR-Domestic Business Travel - Car Rental": "렌터카·차량 공유",
};

// 실제 학습 데이터에서 많이 쓰인 분류 (검토 화면 맨 위에 보여 준다)
export const FAVORITE_CATEGORIES: Category[] = [
  "KR-Business Entertainment Expenses",
  "KR-Domestic Business Travel - Other Transportation",
  "KR-Domestic Business Travel - Parking and Toll Charges",
  "KR-Office Expenses - Office Supplies",
  "KR-Office Expenses - Software Costs",
  "KR-Overseas Business Travel - Other Transportation",
];

// "KR-Business Entertainment Expenses" -> "Business Entertainment Expenses"
export function shortCategory(c: string): string {
  return c.replace(/^KR-/, "");
}

// 화면에 보여 줄 이름: "접대비 (식대·카페·편의점)"
export function categoryLabel(c: string): string {
  return (CATEGORY_KO as Record<string, string>)[c] || shortCategory(c);
}
