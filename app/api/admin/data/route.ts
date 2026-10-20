import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminAuth";
import { getAllUsage, getHistory, kvEnabled, type UsageItem } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 관리자용 사용자별 이용 내역.
// 사람 구분: 기기 ID(브라우저) → 없으면 IP → 없으면 이름. (사무실은 여러 명이 같은 IP 일 수 있다)
interface AdminDownload {
  at: string;
  by: string;
  mode: string;
  rows: number;
  amount: number;
  ip: string;
  ua: string;
  receipt: unknown;
  items: UsageItem[] | null;
}
interface AdminSave {
  at: string;
  by: string;
  merchant: string;
  category: string;
  source?: string;
  ip: string;
}
interface AdminUser {
  key: string;
  kind: "device" | "ip" | "name" | "unknown";
  names: string[];
  ips: string[];
  uas: string[];
  downloads: AdminDownload[];
  saves: AdminSave[];
  amount: number;
  rows: number;
  first: string;
  last: string;
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "관리자 로그인이 필요해요." }, { status: 401 });
  }
  try {
    const [usage, history] = await Promise.all([getAllUsage(), getHistory(1000)]);
    const users = new Map<string, AdminUser>();
    const keyOf = (o: { device?: string; ip?: string; by?: string }) =>
      o.device
        ? { key: "d:" + o.device, kind: "device" as const }
        : o.ip
          ? { key: "i:" + o.ip, kind: "ip" as const }
          : o.by
            ? { key: "n:" + o.by, kind: "name" as const }
            : { key: "unknown", kind: "unknown" as const };
    const get = (o: { device?: string; ip?: string; by?: string }, at: string) => {
      const { key, kind } = keyOf(o);
      let u = users.get(key);
      if (!u) {
        u = { key, kind, names: [], ips: [], uas: [], downloads: [], saves: [], amount: 0, rows: 0, first: at, last: at };
        users.set(key, u);
      }
      if (o.by && !u.names.includes(o.by)) u.names.push(o.by);
      if (o.ip && !u.ips.includes(o.ip)) u.ips.push(o.ip);
      if (at < u.first) u.first = at;
      if (at > u.last) u.last = at;
      return u;
    };

    for (const b of usage) {
      const u = get(b, b.at);
      if (b.ua && !u.uas.includes(b.ua)) u.uas.push(b.ua);
      u.downloads.push({
        at: b.at,
        by: b.by || "",
        mode: b.mode || "",
        rows: b.rows || 0,
        amount: b.amount || 0,
        ip: b.ip || "",
        ua: b.ua || "",
        receipt: b.receipt || null,
        items: b.items || null,
      });
      u.rows += b.rows || 0;
    }

    // 금액 합계: 같은 카드 내역을 다시 받아도 두 번 세지 않도록 결제(결제일·가맹점·금액)
    // 기준으로 중복을 뺀다. 항목 정보가 없는 이전 기록은 다운로드 금액을 그대로 더한다.
    const itemKey = (it: UsageItem) => `${it.d}|${it.m}|${Math.round(it.a)}`;
    const sumUnique = (dls: AdminDownload[]) => {
      const seen = new Set<string>();
      let s = 0;
      for (const d of dls) {
        if (!d.items) {
          s += d.amount;
          continue;
        }
        for (const it of d.items) {
          const k = itemKey(it);
          if (seen.has(k)) continue;
          seen.add(k);
          s += it.a || 0;
        }
      }
      return s;
    };
    for (const u of users.values()) u.amount = sumUnique(u.downloads);
    for (const h of history) {
      const u = get(h, h.at);
      u.saves.push({
        at: h.at,
        by: h.by || "",
        merchant: h.merchant,
        category: h.category,
        source: h.source,
        ip: h.ip || "",
      });
    }

    const list = [...users.values()]
      .map((u) => ({
        ...u,
        downloads: u.downloads.sort((a, b) => b.at.localeCompare(a.at)),
        saves: u.saves.sort((a, b) => b.at.localeCompare(a.at)),
      }))
      .sort((a, b) => b.last.localeCompare(a.last));
    return NextResponse.json({
      users: list,
      totals: {
        users: list.filter((u) => u.downloads.length > 0).length,
        downloads: usage.length,
        amount: sumUnique([...users.values()].flatMap((u) => u.downloads)),
      },
      persistent: kvEnabled(),
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err?.message || "불러오지 못했어요." }, { status: 500 });
  }
}
