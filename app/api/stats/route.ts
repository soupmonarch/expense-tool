import { NextResponse } from "next/server";
import {
  getAllPayments,
  getAllUsage,
  kvEnabled,
  type ReceiptStat,
  type UsageSummary,
} from "@/lib/store";

export const runtime = "nodejs";
// 요청 때마다 최신 통계를 읽는다(빌드 시점 결과로 고정되지 않도록).
export const dynamic = "force-dynamic";

interface MonthStats {
  month: string; // YYYY-MM (금액: 결제월 기준 / 작업 수: 다운로드 월 기준)
  batches: number; // 다운로드한 작업 수
  rows: number;
  amount: number;
  byCategory: Record<string, { n: number; amount: number }>;
  bySource: Record<string, number>;
}

interface ReceiptJob extends ReceiptStat {
  at: string;
  rows: number;
}

// 한국 시각(KST, UTC+9) 기준 연-월
function monthKey(iso: string): string {
  const t = Date.parse(iso);
  if (isNaN(t)) return "unknown";
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 7);
}

// v2.4.0 이전 형식은 같은 카드 내역을 다시 분류해 다운로드하면 별도 작업으로
// 두 번 저장됐다. 내용(건수·금액·분류별 합계)이 똑같고 30분 이내인 것은 한 번만 센다.
function dedupeLegacy(list: UsageSummary[]): UsageSummary[] {
  const sorted = [...list].sort((a, b) => a.at.localeCompare(b.at));
  const kept: UsageSummary[] = [];
  const lastSeen = new Map<string, number>();
  for (const u of sorted) {
    const sig = `${u.rows}|${Math.round(u.amount)}|${JSON.stringify(
      Object.entries(u.byCategory || {}).sort(),
    )}`;
    const t = Date.parse(u.at) || 0;
    const prev = lastSeen.get(sig);
    lastSeen.set(sig, t);
    if (prev !== undefined && t - prev <= 30 * 60 * 1000) continue;
    kept.push(u);
  }
  return kept;
}

// GET: 사용 통계를 월별로 합쳐서 돌려준다. 결제 1건 단위의 원본은 내보내지 않는다.
export async function GET() {
  try {
    const [batches, payments] = await Promise.all([
      getAllUsage(),
      getAllPayments(),
    ]);
    const months = new Map<string, MonthStats>();
    const get = (key: string) => {
      let m = months.get(key);
      if (!m) {
        m = {
          month: key,
          batches: 0,
          rows: 0,
          amount: 0,
          byCategory: {},
          bySource: {},
        };
        months.set(key, m);
      }
      return m;
    };
    const addPayment = (
      m: MonthStats,
      cat: string,
      src: string,
      n: number,
      amount: number,
    ) => {
      m.rows += n;
      m.amount += amount;
      const c = (m.byCategory[cat] = m.byCategory[cat] || { n: 0, amount: 0 });
      c.n += n;
      c.amount += amount;
      m.bySource[src] = (m.bySource[src] || 0) + n;
    };

    // 1) v2.4.0 이후: 결제 1건씩 (결제월 기준, 같은 결제는 한 번)
    for (const p of payments) addPayment(get(p.m), p.c, p.s, 1, p.a || 0);

    // 2) 작업 수 + v2.4.0 이전 형식(다운로드 월 기준 합계)
    const legacy: UsageSummary[] = [];
    const receiptJobs: ReceiptJob[] = [];
    for (const u of batches) {
      get(monthKey(u.at)).batches++;
      if (!u.v) legacy.push(u);
      if (u.receipt) receiptJobs.push({ at: u.at, rows: u.rows, ...u.receipt });
    }
    for (const u of dedupeLegacy(legacy)) {
      const m = get(monthKey(u.at));
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
    }

    const list = [...months.values()].sort((a, b) =>
      b.month.localeCompare(a.month),
    );
    receiptJobs.sort((a, b) => b.at.localeCompare(a.at));
    return NextResponse.json({
      months: list,
      receiptJobs: receiptJobs.slice(0, 200),
      persistent: kvEnabled(),
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message || "통계를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
