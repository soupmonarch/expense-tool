import { NextRequest, NextResponse } from "next/server";
import {
  saveLearned,
  deleteLearned,
  getLearnedMap,
  getLearnedGatewayMap,
  saveLearnedGateway,
  deleteLearnedGateway,
  normalizeMerchant,
  kvEnabled,
  appendHistory,
  getHistory,
} from "@/lib/store";
import { ALL_CATEGORIES, groupOf, type Category } from "@/lib/categories";
import { isPaymentGateway, PSP_MARK } from "@/lib/gateways";

export const runtime = "nodejs";

interface LearnItem {
  merchant: string;
  category: string;
}

// GET: 누적된 공유 학습 데이터(가맹점 -> 분류) 전체를 반환한다.
// 관리 페이지(/learned)에서 조회·검색·CSV 내보내기에 사용.
export async function GET() {
  const [map, gatewayMap, history] = await Promise.all([
    getLearnedMap(),
    getLearnedGatewayMap(),
    getHistory(300),
  ]);
  const valid = new Set<string>(ALL_CATEGORIES);
  const entries = Object.entries(map)
    .map(([merchant, category]) => ({
      merchant,
      category,
      group: valid.has(category) ? groupOf(category as Category) : "unknown",
    }))
    .sort((a, b) => a.merchant.localeCompare(b.merchant, "ko"));
  const gateways = Object.entries(gatewayMap)
    .map(([merchant, label]) => ({ merchant, label: label || merchant }))
    .sort((a, b) => a.merchant.localeCompare(b.merchant, "ko"));
  return NextResponse.json({
    entries,
    gateways,
    history,
    count: entries.length,
    gatewayCount: gateways.length,
    persistent: kvEnabled(),
  });
}

// POST: 사용자가 확정한 가맹점 -> 분류 매핑을 공유 저장소에 저장해서 이후 모든
// 업로드(누구의 것이든)가 그 가맹점을 자동 분류하도록 한다(팝업의 일괄 학습용).
// 결제대행사 가맹점명은 안전장치로 여기서도 거부한다(매번 다른 결제라 학습 금지).
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      items?: LearnItem[];
      gateways?: string[];
      by?: string;
    };
    const items = Array.isArray(body.items) ? body.items : [];
    const gateways = Array.isArray(body.gateways) ? body.gateways : [];
    const by = (body.by || "").trim();
    const valid = new Set<string>(ALL_CATEGORIES);

    let saved = 0;
    let skippedGateway = 0;
    for (const it of items) {
      if (!it || !it.merchant || !it.category || !valid.has(it.category))
        continue;
      if (isPaymentGateway(it.merchant)) {
        skippedGateway++;
        continue;
      }
      await saveLearned(it.merchant, it.category);
      await appendHistory({
        merchant: it.merchant,
        category: it.category,
        by,
        source: "review",
      });
      saved++;
    }

    // 사용자가 'PSP입니다' 체크한 가맹점 — 결제대행사로 학습(카테고리 학습은 제거).
    let savedGateways = 0;
    for (const g of gateways) {
      const name = typeof g === "string" ? g.trim() : "";
      if (!name) continue;
      await saveLearnedGateway(name);
      await appendHistory({
        merchant: name,
        category: PSP_MARK,
        by,
        source: "gateway",
      });
      savedGateways++;
    }

    return NextResponse.json({
      ok: true,
      saved,
      savedGateways,
      skippedGateway,
      persistent: kvEnabled(),
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message || "Learn failed" },
      { status: 500 },
    );
  }
}

// PUT: 관리 페이지에서 단건 추가 또는 수정. oldMerchant가 주어지고 정규화 키가
// 바뀌면(가맹점명 변경) 기존 키를 지우고 새 키로 저장한다(rename).
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      oldMerchant?: string;
      merchant?: string;
      category?: string;
      by?: string;
    };
    const merchant = (body.merchant || "").trim();
    const category = (body.category || "").trim();
    const by = (body.by || "").trim();
    const valid = new Set<string>(ALL_CATEGORIES);

    if (!merchant) {
      return NextResponse.json(
        { error: "가맹점명을 입력해 주세요." },
        { status: 400 },
      );
    }
    // PSP로 표시/변환: 기존 카테고리 학습을 지우고 결제대행사 목록으로 이동한다.
    if (category === PSP_MARK) {
      if (
        body.oldMerchant &&
        normalizeMerchant(body.oldMerchant) !== normalizeMerchant(merchant)
      ) {
        await deleteLearned(body.oldMerchant);
      }
      await saveLearnedGateway(merchant);
      await appendHistory({
        merchant,
        category: PSP_MARK,
        by,
        source: "manual",
      });
      return NextResponse.json({
        ok: true,
        gateway: true,
        persistent: kvEnabled(),
      });
    }
    if (!valid.has(category)) {
      return NextResponse.json(
        { error: "유효한 분류를 선택해 주세요." },
        { status: 400 },
      );
    }
    if (isPaymentGateway(merchant)) {
      return NextResponse.json(
        { error: "결제대행사 가맹점은 학습할 수 없습니다(매번 다른 결제)." },
        { status: 400 },
      );
    }

    // 가맹점명 변경(rename): 정규화 키가 달라졌으면 기존 항목 제거
    if (
      body.oldMerchant &&
      normalizeMerchant(body.oldMerchant) !== normalizeMerchant(merchant)
    ) {
      await deleteLearned(body.oldMerchant);
    }
    await saveLearned(merchant, category);
    await appendHistory({ merchant, category, by, source: "manual" });

    return NextResponse.json({ ok: true, persistent: kvEnabled() });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message || "Update failed" },
      { status: 500 },
    );
  }
}

// DELETE: 공유 저장소에서 매핑 하나를 제거한다(잘못 학습된 항목 수정용).
export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as { merchant?: string; kind?: string };
    if (!body?.merchant) {
      return NextResponse.json(
        { error: "merchant is required" },
        { status: 400 },
      );
    }
    if (body.kind === "gateway") {
      await deleteLearnedGateway(body.merchant);
    } else {
      await deleteLearned(body.merchant);
    }
    return NextResponse.json({ ok: true, persistent: kvEnabled() });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message || "Delete failed" },
      { status: 500 },
    );
  }
}
