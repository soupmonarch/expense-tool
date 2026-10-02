import { NextResponse } from "next/server";
import { getAllUsage, kvEnabled } from "@/lib/store";

export const runtime = "nodejs";
// 요청 때마다 최신 통계를 읽는다(빌드 시점 결과로 고정되지 않도록).
export const dynamic = "force-dynamic";

interface MonthStats {
  month: string; // YYYY-MM (한국 시각 기준)
  batches: number; // 다운로드한 작업 수
  rows: number;
  amount: number;
  byCategory: Record<string, { n: number; amount: number }>;
  bySource: Record<string, number>;
}

// 한국 시각(KST, UTC+9) 기준 연-월
function monthKey(iso: string): string {
  const t = Date.parse(iso);
  if (isNaN(t)) return "unknown";
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 7);
}

// GET: 사용 통계를 월별로 합쳐서 돌려준다. 작업(개인)별 원본은 내보내지 않는다.
export async function GET() {
  try {
    const all = await getAllUsage();
    const months = new Map<string, MonthStats>();
    for (const u of all) {
      const key = monthKey(u.at);
      const m = months.get(key) || {
        month: key,
        batches: 0,
        rows: 0,
        amount: 0,
        byCategory: {},
        bySource: {},
      };
      m.batches++;
      m.rows += u.rows || 0;
      m.amount += u.amount || 0;
      for (const [cat, v] of Object.entries(u.byCategory || {})) {
        const c = (m.byCategory[cat] = m.byCategory[cat] || { n: 0, amount: 0 });
        c.n += v.n || 0;
        c.amount += v.amount || 0;
      }
      for (const [src, n] of Object.entries(u.bySource || {})) {
        m.bySource[src] = (m.bySource[src] || 0) + (n || 0);
      }
      months.set(key, m);
    }
    const list = [...months.values()].sort((a, b) =>
      b.month.localeCompare(a.month),
    );
    return NextResponse.json({ months: list, persistent: kvEnabled() });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message || "통계를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
