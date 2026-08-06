import { NextRequest, NextResponse } from "next/server";
import { parseStatement, type ColumnMapping } from "@/lib/parseStatement";
import { classifyAll } from "@/lib/classify";
import { reconcileCancellations } from "@/lib/reconcile";
import {
  parseReceiptPdf,
  receiptsToTransactions,
  type ReceiptInfo,
} from "@/lib/parseReceipts";
import { dedupeTransactions } from "@/lib/dedupe";
import { kvEnabled } from "@/lib/store";
import type { Transaction } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type Mode = "excel" | "pdf" | "both";

// Step 1: parse + reconcile cancellations + classify. Returns JSON so the UI
// can show a review popup before generating the final files.
//
// 입력 모드(mode):
//   - excel : 카드 내역 엑셀에서 거래를 읽는다(영수증은 다운로드 단계에서 첨부).
//   - both  : excel 과 동일하게 거래는 엑셀에서 읽는다(영수증은 다운로드 단계).
//   - pdf   : 엑셀 없이 영수증 PDF에서 직접 거래(시각/가맹점/금액/승인번호)를 읽는다.
// 엑셀/영수증 모두 여러 파일을 받을 수 있고, 승인번호 기준으로 중복을 제거한다.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const mode = (String(form.get("mode") || "excel") as Mode) || "excel";

    // 열 매핑 override (엑셀 전용)
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
    const useOverride = Object.keys(override).length ? override : undefined;

    const excelFiles = form
      .getAll("file")
      .filter((f): f is File => f instanceof File && f.size > 0);
    const pdfFiles = form
      .getAll("receipts")
      .filter((f): f is File => f instanceof File && f.size > 0);

    let transactions: Transaction[] = [];
    let detectedMapping: ColumnMapping = {};
    const receiptInfo = { pageCount: 0, receipts: 0, errors: [] as string[] };

    if (mode === "pdf") {
      // 브라우저가 /api/parse-receipts 로 조각 파싱한 결과(JSON)를 우선 받는다.
      // (Vercel 요청 본문 4.5MB 한도 때문에 큰 PDF는 통째로 못 올린다)
      const receiptDataRaw = form.get("receiptData");
      if (typeof receiptDataRaw === "string" && receiptDataRaw.length > 0) {
        const pre = JSON.parse(receiptDataRaw) as {
          receipts?: ReceiptInfo[];
          pageCount?: number;
          errors?: string[];
        };
        const list = Array.isArray(pre.receipts) ? pre.receipts : [];
        receiptInfo.pageCount += pre.pageCount || 0;
        receiptInfo.receipts += list.length;
        if (Array.isArray(pre.errors)) receiptInfo.errors.push(...pre.errors);
        transactions.push(...receiptsToTransactions(list));
      } else if (pdfFiles.length === 0) {
        return NextResponse.json(
          { error: "영수증 PDF 파일을 첨부해 주세요." },
          { status: 400 },
        );
      } else {
        for (const f of pdfFiles) {
          const bytes = new Uint8Array(await f.arrayBuffer());
          const parsed = await parseReceiptPdf(bytes);
          if (parsed.error)
            receiptInfo.errors.push(`${f.name}: ${parsed.error}`);
          receiptInfo.pageCount += parsed.pageCount;
          receiptInfo.receipts += parsed.receipts.length;
          transactions.push(...receiptsToTransactions(parsed.receipts));
        }
      }
    } else {
      if (excelFiles.length === 0)
        return NextResponse.json(
          { error: "카드 내역(엑셀) 파일을 첨부해 주세요." },
          { status: 400 },
        );
      for (const f of excelFiles) {
        const buffer = Buffer.from(await f.arrayBuffer());
        const res = parseStatement(buffer, useOverride);
        if (Object.keys(detectedMapping).length === 0)
          detectedMapping = res.detectedMapping;
        transactions.push(...res.transactions);
      }
    }

    // 여러 파일을 합쳤으므로 rowIndex 를 전역 고유로 재부여한 뒤 중복 제거한다.
    transactions = transactions.map((t, i) => ({ ...t, rowIndex: i }));
    const rawCount = transactions.length;
    const { unique, removed } = dedupeTransactions(transactions);
    unique.forEach((t, i) => {
      t.rowIndex = i;
    });
    transactions = unique;

    if (transactions.length === 0) {
      return NextResponse.json(
        {
          error:
            mode === "pdf"
              ? "영수증에서 거래를 인식하지 못했습니다. 카드사에서 발행한 영수증(매출전표) PDF인지 확인해 주세요."
              : "거래 내역을 찾지 못했습니다. 가맹점명/금액 열이 있는 카드 내역 파일인지 확인해 주세요.",
          detectedMapping,
          receiptInfo: mode === "pdf" ? receiptInfo : undefined,
        },
        { status: 422 },
      );
    }

    // 취소/환불을 원결제와 정산(차감)한 뒤 분류한다.
    const { payments, questions, autoVoided, voidedAmount } =
      reconcileCancellations(transactions);

    const { results: classified, ai: aiDiagnostic } =
      await classifyAll(payments);

    const rows = classified.map((t) => {
      // PDF만 모드에서 금액/가맹점을 못 읽은 영수증 → 수동 입력 대상으로 표시.
      const needsManual =
        mode === "pdf" && (!(t.amount > 0) || !t.merchant.trim());
      return {
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
        needsReview: !!t.needsReview || needsManual,
        needsManual,
        noLearn: !!t.noLearn,
        suspectGateway: !!t.suspectGateway,
      };
    });

    const stats = {
      total: rows.length,
      expense: classified.filter((t) => t.group === "expense").length,
      travel: classified.filter((t) => t.group === "travel").length,
      needsReview: rows.filter((r) => r.needsReview).length,
      autoVoided,
      voidedAmount,
      cancelQuestions: questions.length,
      duplicatesRemoved: removed,
      filesProcessed: mode === "pdf" ? pdfFiles.length : excelFiles.length,
      rawCount,
      mode,
    };

    return NextResponse.json({
      rows,
      stats,
      cancelQuestions: questions,
      detectedMapping,
      persistent: kvEnabled(),
      aiDiagnostic,
      receiptInfo: mode === "pdf" ? receiptInfo : undefined,
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message || "Classification failed" },
      { status: 500 },
    );
  }
}
