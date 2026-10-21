import { NextResponse } from "next/server";
import { DEFAULT_AI_MODEL } from "@/lib/aiModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 영수증 AI 인식에 쓰는 모델 이름과 사용 가능 여부 (화면 표시용, 키 값은 내보내지 않음)
export async function GET() {
  return NextResponse.json({
    model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || DEFAULT_AI_MODEL,
    available: !!process.env.OPENAI_API_KEY,
  });
}
