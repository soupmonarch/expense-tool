import { NextRequest, NextResponse } from "next/server";
import { parseStatement, type ColumnMapping } from "@/lib/parseStatement";
import { classifyAll } from "@/lib/classify";
import { reconcileCancellations } from "@/lib/reconcile";
import { kvEnabled } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

// Step 1: parse + reconcile cancellations + classify. Returns JSON so the UI
// can show a review popup (cancellation confirmations + low-confidence /
// gateway rows) before generating the final files.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const override: ColumnMapping = {};
    const keys: (keyof ColumnMapping)[] = [
      "merchant",
      "amount",
      "currency",
      "date",
    ];
    for (const k of keys) {
      const v = form.get(`col_${k}`);
      if (v !== null && v !== "") override[k] = Number(v);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { transactions, detectedMapping } = parseStatement(
      buffer,
      Object.keys(override).length ? override : undefined,
    );

    if (transactions.length === 0) {
      return NextResponse.json(
        {
          error:
            "거래 내역을 찾지 못했습니다. 가맹점명/금액 열이 있는 카드 내역 파일인지 확인해 주세요.",
          detectedMapping,
        },
        { status: 422 },
      );
    }

    // Net out cancellations against original payments before classifying.
    const { payments, questions, autoVoided } =
      reconcileCancellations(transactions);

    const classified = await classifyAll(payments);

    const rows = classified.map((t) => ({
      id: t.id,
      date: t.date ?? "",
      time: t.time ?? "",
      merchant: t.merchant,
      amount: t.amount,
      currency: t.currency || "KRW",
      approval: t.approval ?? "",
      merchantCategory: t.merchantCategory ?? "",
      isForeign: !!t.isForeign,
      group: t.group,
      category: t.category,
      source: t.source,
      confidence: t.confidence ?? null,
      cancelAmount: t.cancelAmount ?? null,
      needsReview: !!t.needsReview,
      noLearn: !!t.noLearn,
      suspectGateway: !!t.suspectGateway,
    }));

    const stats = {
      total: classified.length,
      expense: classified.filter((t) => t.group === "expense").length,
      travel: classified.filter((t) => t.group === "travel").length,
      needsReview: classified.filter((t) => t.needsReview).length,
      autoVoided,
      cancelQuestions: questions.length,
    };

    return NextResponse.json({
      rows,
      stats,
      cancelQuestions: questions,
      detectedMapping,
      persistent: kvEnabled(),
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message || "Classification failed" },
      { status: 500 },
    );
  }
}
