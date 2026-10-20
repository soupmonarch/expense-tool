import { NextResponse } from "next/server";
import { getAllUsage, getHistory, kvEnabled, type HistoryEntry } from "@/lib/store";

export const runtime = "nodejs";
// 요청 때마다 최신 기록을 읽는다(빌드 시점 결과로 고정되지 않도록).
export const dynamic = "force-dynamic";

// GET: 합친 이용 기록 (최신순).
//  - download: 다운로드 1번 + 그 작업에서 저장한 분류(학습)들
//  - edit:     학습 데이터 관리 화면에서 직접 추가·수정·삭제한 기록 묶음
// 공개 화면용이라 금액·IP·기기 정보는 내보내지 않는다(관리자 메뉴에서만 보임).

const ATTACH_WINDOW_MS = 30 * 60 * 1000; // 다운로드 전 30분 안의 분류 저장을 그 작업에 묶는다
const EDIT_GAP_MS = 30 * 60 * 1000; // 같은 사람의 연속 수정은 30분 단위로 묶는다

interface SaveItem {
  merchant: string;
  category: string;
  source?: string;
  at: string;
}

const t = (iso: string) => Date.parse(iso) || 0;
const sameActor = (a: { by?: string; device?: string }, b: { by?: string; device?: string }) =>
  a.device && b.device ? a.device === b.device : (a.by || "") === (b.by || "");

export async function GET() {
  try {
    const [usage, history] = await Promise.all([getAllUsage(), getHistory(1000)]);
    const downloads = usage
      .map((u) => ({
        type: "download" as const,
        at: u.at,
        by: u.by || "",
        device: u.device || "",
        mode: u.mode || "",
        rows: u.rows || 0,
        receipt: u.receipt
          ? {
              pages: u.receipt.pages,
              recognized: u.receipt.recognized,
              matched: u.receipt.matched,
              method: u.receipt.aiPages || u.receipt.aiCachedPages ? "ai" : u.receipt.ocrPages ? "ocr" : "text",
            }
          : null,
        saves: [] as SaveItem[],
      }))
      .sort((a, b) => t(a.at) - t(b.at));

    // 분류 저장(검토 화면에서 저장)을 직후 다운로드에 붙인다. 못 붙인 것과 직접 수정은 따로 묶는다.
    const loose: HistoryEntry[] = [];
    for (const h of [...history].sort((a, b) => t(a.at) - t(b.at))) {
      const fromReview = h.source === "review" || h.source === "gateway";
      const target = fromReview
        ? downloads.find(
            (d) => t(d.at) >= t(h.at) && t(d.at) - t(h.at) <= ATTACH_WINDOW_MS && sameActor(d, h),
          )
        : undefined;
      if (target) target.saves.push({ merchant: h.merchant, category: h.category, source: h.source, at: h.at });
      else loose.push(h);
    }

    const edits: { type: "edit"; at: string; by: string; items: SaveItem[] }[] = [];
    for (const h of loose) {
      const last = edits[edits.length - 1];
      if (last && sameActor(last, h) && t(h.at) - t(last.at) <= EDIT_GAP_MS) {
        last.items.push({ merchant: h.merchant, category: h.category, source: h.source, at: h.at });
        last.at = h.at;
      } else {
        edits.push({
          type: "edit",
          at: h.at,
          by: h.by || "",
          items: [{ merchant: h.merchant, category: h.category, source: h.source, at: h.at }],
        });
      }
    }

    const entries = [
      ...downloads.map(({ device: _device, ...d }) => d),
      ...edits,
    ]
      .sort((a, b) => t(b.at) - t(a.at))
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
