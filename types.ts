import { NextRequest, NextResponse } from "next/server";
import { saveLearned, kvEnabled } from "@/lib/store";
import { ALL_CATEGORIES } from "@/lib/categories";

export const runtime = "nodejs";

interface LearnItem {
  merchant: string;
  category: string;
}

// Persist user-confirmed merchant -> category mappings to the SHARED store so
// every future upload (by anyone) classifies that merchant automatically.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { items?: LearnItem[] };
    const items = Array.isArray(body.items) ? body.items : [];
    const valid = new Set<string>(ALL_CATEGORIES);

    let saved = 0;
    for (const it of items) {
      if (it && it.merchant && it.category && valid.has(it.category)) {
        await saveLearned(it.merchant, it.category);
        saved++;
      }
    }

    return NextResponse.json({ ok: true, saved, persistent: kvEnabled() });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err?.message || "Learn failed" }, { status: 500 });
  }
}
