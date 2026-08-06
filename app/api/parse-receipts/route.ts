import { NextRequest, NextResponse } from "next/server";
import { parseReceiptPdf } from "@/lib/parseReceipts";

export const runtime = "nodejs";
export const maxDuration = 60;

// 영수증 PDF 조각(클라이언트가 ≤3MB로 분할)을 받아 파싱 결과(JSON)만 돌려준다.
// Vercel 요청 본문 한도(4.5MB) 때문에 큰 PDF는 통째로 받지 않고 조각으로 받는다.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (!(f instanceof File) || f.size === 0) {
      return NextResponse.json(
        { error: "영수증 PDF 파일이 없습니다." },
        { status: 400 },
      );
    }
    const parsed = await parseReceiptPdf(new Uint8Array(await f.arrayBuffer()));
    return NextResponse.json(parsed);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message || "영수증 분석에 실패했습니다." },
      { status: 500 },
    );
  }
}
