// AI 모델 공통 설정 (분류용 · 영수증 인식용).
// gpt-5-mini 는 2026-12-11 종료 예정이라 기본값을 gpt-5.6-luna 로 바꿨다.
// luna: 5.6 세대의 가장 가벼운 모델, 이미지 입력 지원, gpt-5-mini 보다 저렴.
// Vercel 환경변수 OPENAI_MODEL(분류) / OPENAI_VISION_MODEL(영수증)로 바꿀 수 있다.
export const DEFAULT_AI_MODEL = "gpt-5.6-luna";

// GPT-5·o 계열(추론 모델)은 temperature 를 보내면 400 오류가 나므로
// reasoning_effort 를 대신 보낸다.
export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model);
}
