import { NextResponse } from "next/server";
import { getAllUsage, kvEnabled } from "@/lib/store";

export const runtime = "nodejs";
// 요청 때마다 최신 기록을 읽는다(빌드 시점 결과로 고정되지 않도록).
export const dynamic = "force-dynamic";

// GET: 이용 기록 — 누가 언제 어떤 방식으로 몇 건을 다운로드했는지 (최신순 최대 500건).
// 직원별 사용 금액은 동료에게 보이지 않도록 내보내지 않는다.
export async function GET() {
  try {
    const all = await getAllUsage();
    const entries = all
      .map((u) => ({
        at: u.at,
        by: u.by || "",
        mode: u.mode || "",
        rows: u.rows || 0,
        receipt: u.receipt
          ? {
              pages: u.receipt.pages,
              recognized: u.receipt.recognized,
              matched: u.receipt.matched,
              missing: u.receipt.missing,
              method: u.receipt.aiPages || u.receipt.aiCachedPages
                ? "ai"
                : u.receipt.ocrPages
                  ? "ocr"
                  : "text",
            }
          : null,
      }))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 500);
    return NextResponse.json({ entries, persistent: kvEnabled() });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message || "이용 기록을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
