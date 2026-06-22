// 결제대행사(PSP) 키워드. 가맹점명이 이 목록 중 하나에만 해당하면(더 구체적인
// 정보가 없으면) 무엇을 결제했는지 알 수 없으므로 항상 사용자에게 수동 분류를
// 요청하고, 그 결과는 절대 학습하지 않는다.
export const PAYMENT_GATEWAY_KEYWORDS: string[] = [
  "alipay", "알리페이",
  "wechat", "위챗페이", "위챗",
  "paypal", "페이팔",
  "google pay", "googlepay", "구글페이",
  "apple pay", "applepay", "애플페이",
  "naver pay", "naverpay", "네이버페이", "네이버파이낸셜",
  "kakao pay", "kakaopay", "카카오페이",
  "payco", "페이코",
  "toss", "tosspayments", "토스페이", "토스페이먼츠",
  "smilepay", "스마일페이",
  "ssgpay", "ssg페이", "쓱페이",
  "coupay", "쿠페이",
  "11pay", "11페이",
  "lpay", "엘페이",
  "inicis", "이니시스",
  "kcp",
  "nicepay", "나이스페이",
  "danal", "다날",
  "settlebank", "세틀뱅크",
  "mobilians", "모빌리언스",
  "결제대행", "전자결제", "전자지급결제",
];

// 가맹점명(merchant name)만 검사한다. 업종명(MCC)까지 검사하면 일반 가맹점이
// 과도하게 게이트웨이로 분류될 수 있으므로 검사 대상에서 제외한다.
export function isPaymentGateway(merchant: string | undefined | null): boolean {
  if (!merchant) return false;
  const h = String(merchant).toLowerCase().replace(/\s+/g, " ").trim();
  if (!h) return false;
  return PAYMENT_GATEWAY_KEYWORDS.some((k) => h.includes(k.toLowerCase()));
}
