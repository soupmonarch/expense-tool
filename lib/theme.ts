// 화면 전체에서 같이 쓰는 색·모양 규칙(디자인 토큰).
// 색을 바꾸고 싶으면 여기 한 곳만 고치면 모든 화면에 반영된다.
export const T = {
  // 기본(파랑): 주요 버튼, 링크, 선택된 항목
  primary: "#2d6cdf",
  primaryHover: "#2457b8",
  primaryBg: "#eef3fd",
  primaryBorder: "#c9daf8",

  // 글자
  text: "#1f2329",
  textSub: "#3a4149",
  textMuted: "#5f6873",
  textFaint: "#8a9099",

  // 배경·테두리
  page: "#f5f6f8",
  surface: "#ffffff",
  surfaceAlt: "#f3f5f8",
  border: "#d7dbe0",
  borderStrong: "#c7ccd3",
  divider: "#e9ebee",

  // 상태
  success: "#1e874b",
  successBg: "#eaf7ee",
  successBorder: "#bfe6cb",
  warning: "#b9770e",
  warningText: "#8a6100",
  warningBg: "#fff8e6",
  warningBorder: "#f0dfae",
  danger: "#c0392b",
  dangerStrong: "#e74c3c",
  dangerBg: "#fdecea",
  dangerBgSoft: "#fff5f4",
  dangerBorder: "#f0c2bd",

  // 영수증 읽기 방식: OCR(청록) / AI(보라)
  ocr: "#0f766e",
  ocrBg: "#e8f6f4",
  ocrBorder: "#b6e2dc",
  ai: "#7c3aed",
  aiBg: "#f3eefe",
  aiBorder: "#d9c9fb",

  radius: 10,
  radiusSm: 8,
  shadow: "0 4px 24px rgba(0,0,0,0.06)",
  shadowModal: "0 12px 48px rgba(0,0,0,0.25)",
} as const;
