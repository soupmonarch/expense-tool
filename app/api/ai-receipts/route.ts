import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { DEFAULT_AI_MODEL, isReasoningModel } from "@/lib/aiModel";

export const runtime = "nodejs";
export const maxDuration = 60;

// AI 영수증 인식: 브라우저가 그린 영수증 PDF 한 페이지 그림(JPEG)을 받아
// AI(이미지 입력 모델)에게 그 페이지의 영수증을 모두 읽게 한다.
// 양식이 정해져 있지 않으므로 처음 보는 카드사·가게 영수증도 읽을 수 있다.
// 그림은 저장하지 않고 OpenAI 호출에만 쓴다.

const MAX_IMAGE_CHARS = 4_000_000; // data URL 길이 상한 (Vercel 요청 4.5MB 한도 안쪽)

const SYSTEM_PROMPT = [
  "You read Korean credit-card sales slips (매출전표, 카드 영수증) from an image of ONE PDF page.",
  "A page may contain zero or more receipts in ANY layout (1, 2, 4 per page, rotated, store receipts, etc.).",
  "For EACH receipt on the page, in reading order (top-to-bottom, left-to-right), return:",
  '- approval: the card approval number (승인번호) digits only, or "" if none is printed',
  "- merchant: the merchant name (가맹점명/상호) exactly as printed; join it if wrapped onto two lines",
  "- amount: the total charged in KRW (거래금액/합계/결제금액) as a positive integer. For foreign transactions use the KRW amount, never the USD/foreign amount",
  "- canceled: true if it is a cancellation/refund (취소, 환불, 매입취소) or the amount is printed negative",
  '- date: transaction date as "YYYY.MM.DD", time: "HH:mm" (24h), or "" if missing',
  "- box: [x0, y0, x1, y1] the area covering the whole receipt as fractions 0..1 of the page width/height, origin top-left",
  "Do not invent values. Ignore card numbers and personal data other than the fields above.",
  'Respond with JSON only: {"receipts":[...]} (empty list if the page has no receipt).',
].join("\n");

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "서버에 OPENAI_API_KEY가 설정되지 않아 AI 인식을 쓸 수 없습니다." },
        { status: 503 },
      );
    }
    const body = (await req.json().catch(() => ({}))) as { image?: string };
    const image = typeof body.image === "string" ? body.image : "";
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) {
      return NextResponse.json({ error: "영수증 그림이 없습니다." }, { status: 400 });
    }
    if (image.length > MAX_IMAGE_CHARS) {
      return NextResponse.json({ error: "영수증 그림이 너무 큽니다." }, { status: 413 });
    }

    const model =
      process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || DEFAULT_AI_MODEL;
    const client = new OpenAI({ apiKey });
    const resp = await client.chat.completions.create({
      model,
      ...(isReasoningModel(model) ? { reasoning_effort: "low" } : { temperature: 0 }),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "이 페이지에 있는 영수증을 모두 읽어 주세요." },
            { type: "image_url", image_url: { url: image, detail: "high" } },
          ],
        },
      ],
    } as any);

    const parsed = JSON.parse(resp.choices[0]?.message?.content || "{}") as {
      receipts?: unknown[];
    };
    const receipts = (Array.isArray(parsed.receipts) ? parsed.receipts : [])
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .map((r) => ({
        approval: String(r.approval ?? "").replace(/[^0-9]/g, ""),
        merchant: String(r.merchant ?? "").trim().slice(0, 120),
        amount: Math.abs(Math.round(Number(String(r.amount ?? "").replace(/[^0-9.\-]/g, "")) || 0)),
        canceled: r.canceled === true || String(r.amount ?? "").trim().startsWith("-"),
        date: String(r.date ?? "").trim().slice(0, 10),
        time: String(r.time ?? "").trim().slice(0, 5),
        box:
          Array.isArray(r.box) && r.box.length === 4 && r.box.every((v) => typeof v === "number")
            ? (r.box as number[])
            : null,
      }));

    return NextResponse.json({
      receipts,
      model,
      usage: {
        input: resp.usage?.prompt_tokens ?? 0,
        output: resp.usage?.completion_tokens ?? 0,
      },
    });
  } catch (err: any) {
    console.error("AI receipt read failed:", err);
    return NextResponse.json(
      { error: err?.message || "AI 영수증 인식에 실패했습니다." },
      { status: 500 },
    );
  }
}
