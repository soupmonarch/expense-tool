// ---------------------------------------------------------------------------
// RULE TABLES  (edit these to improve accuracy over time)
// ---------------------------------------------------------------------------
// Classification order in classify.ts:
//   1) MCC_RULES   - match the card's 가맹점업종명 (industry/MCC name). Most reliable
//                    because it is issuer-provided and consistent across cards.
//   2) RULES       - match merchant-name keywords.
//   3) AI fallback - only for whatever is still unmatched.
//
// Travel airfare / accommodation / transport are split into Domestic vs Overseas
// at runtime using the transaction's isForeign flag, so rules only declare a
// generic "subtype".
// Keep keywords lowercase. Korean + English aliases supported.
// ---------------------------------------------------------------------------

import type { Category } from "./categories";

export type TravelSubtype =
  | "airfare"
  | "accommodation"
  | "transport"
  | "toll" // domestic only
  | "carfuel" // domestic only
  | "allowance";

export type Outcome =
  | { group: "expense"; category: Category }
  | { group: "travel"; travelSubtype: TravelSubtype };

export type Rule = { keywords: string[] } & Outcome;

// --- 1) MCC / 가맹점업종명 mapping (substring match against the industry name) ---
export const MCC_RULES: Rule[] = [
  // Travel - transport
  {
    keywords: ["철도", "고속버스", "시외버스", "버스", "택시", "여객운송", "운송", "교통", "지하철", "철도운송"],
    group: "travel",
    travelSubtype: "transport",
  },
  // Travel - airfare
  { keywords: ["항공", "항공운송", "airline"], group: "travel", travelSubtype: "airfare" },
  // Travel - accommodation
  { keywords: ["호텔", "숙박", "콘도", "리조트", "모텔", "여관", "펜션"], group: "travel", travelSubtype: "accommodation" },
  // Travel - parking / toll
  { keywords: ["주차", "통행료", "고속도로"], group: "travel", travelSubtype: "toll" },
  // Travel - car rental / fuel
  { keywords: ["주유", "주유소", "렌터카", "렌트카", "자동차임대", "차량임대"], group: "travel", travelSubtype: "carfuel" },
  // Expense - business entertainment (meals / cafe)
  {
    keywords: ["한식", "양식", "일식", "중식", "음식", "식당", "요식업", "주점", "호프", "갈비", "고기", "횟집", "커피", "카페", "다방", "제과", "베이커리", "주택·이용음식"],
    group: "expense",
    category: "KR-Business Entertainment Expenses",
  },
  // Expense - telephone / communication
  { keywords: ["통신", "이동통신", "전기통신"], group: "expense", category: "KR-TELEPHONE EXPENSES" },
  // Expense - courier / postage
  { keywords: ["택배", "우편", "퀄논", "화물운송"], group: "expense", category: "KR-Office Expenses - Courier and Postage Fees" },
  // Expense - office supplies
  { keywords: ["문구", "사무용품", "서점"], group: "expense", category: "KR-Office Expenses - Office Supplies" },
];

// --- 2) Merchant-name keyword rules ---
export const RULES: Rule[] = [
  // Telephone
  {
    keywords: ["skt", "sk텔레콤", "sk telecom", "kt", "케이티", "lg u+", "lg유플러스", "uplus", "u+", "알뜰폰", "헬로비전", "hellovision", "telecom"],
    group: "expense",
    category: "KR-TELEPHONE EXPENSES",
  },
  // Courier / postage
  {
    keywords: ["cj대한통운", "대한통운", "우체국", "한진택배", "로젠택배", "롯데택배", "택배", "등기", "퀄", "dhl", "fedex", "ups"],
    group: "expense",
    category: "KR-Office Expenses - Courier and Postage Fees",
  },
  // Office supplies
  {
    keywords: ["다이소", "daiso", "오피스디포", "office depot", "알파문구", "모닝글로리", "교보문고", "영풍문고", "호미오피스", "오피스디포"],
    group: "expense",
    category: "KR-Office Expenses - Office Supplies",
  },
  // Business entertainment (meals, cafe)
  {
    keywords: ["식당", "음식점", "고기", "갈비", "차돌집", "횟집", "카페", "cafe", "커피", "coffee", "스타벅스", "starbucks", "투썸", "이디야", "빡다방", "메가커피", "주점", "호프", "bakery", "파리바게뜨", "뚜레쥬르"],
    group: "expense",
    category: "KR-Business Entertainment Expenses",
  },
  // Airfare
  {
    keywords: ["대한항공", "korean air", "아시아나", "asiana", "제주항공", "jeju air", "진에어", "jin air", "티웨이", "tway", "에어부산", "air busan", "에어서울", "이스타", "항공권", "airline", "airways", "airfare"],
    group: "travel",
    travelSubtype: "airfare",
  },
  // Accommodation
  {
    keywords: ["호텔", "hotel", "모텔", "야놀자", "yanolja", "여기어때", "goodchoice", "agoda", "아고다", "booking.com", "booking", "hotels.com", "expedia", "익스피디아", "airbnb", "리조트", "resort", "inn", "관광호텔"],
    group: "travel",
    travelSubtype: "accommodation",
  },
  // Parking / toll
  {
    keywords: ["하이패스", "hipass", "한국도로공사", "도로공사", "통행료", "toll", "주차", "parking", "파킹클라우드", "아이파킹", "iparking", "아마노", "amano"],
    group: "travel",
    travelSubtype: "toll",
  },
  // Car rental / fuel  (쏘카/그린카 = car sharing)
  {
    keywords: ["쏘카", "socar", "그린카", "greencar", "롯데렌터카", "sk렌터카", "렌터카", "rent a car", "car rental", "gs칼텍스", "칼텍스", "caltex", "s-oil", "에쓰오일", "현대오일뱅크", "oilbank", "sk에너지", "주유", "gas station", "충전"],
    group: "travel",
    travelSubtype: "carfuel",
  },
  // Other transportation (train, taxi, transit)
  {
    keywords: ["ktx", "코레일", "korail", "srt", "철도승차권", "기차", "열차", "택시", "taxi", "카카오t", "kakao t", "우티", "uber", "지하철", "subway", "고속버스", "시외버스", "티머니", "grab"],
    group: "travel",
    travelSubtype: "transport",
  },
  // Travel allowance
  { keywords: ["여비", "일비", "출장비", "travel allowance", "per diem"], group: "travel", travelSubtype: "allowance" },
];
