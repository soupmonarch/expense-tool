import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { fillForm, type FormRow } from "@/lib/fillTemplate";
import {
  ALL_CATEGORIES,
  UNCLASSIFIED,
  groupOf,
  type Category,
} from "@/lib/categories";
import { parseReceiptPdf } from "@/lib/parseReceipts";
import { createHash } from "crypto";
import {
  saveUsage,
  savePayments,
  type PaymentRecord,
  type ReceiptStat,
} from "@/lib/store";
import {
  matchReceipts,
  renderReceiptPdf,
  type RowMeta,
} from "@/lib/buildReceiptPdf";

export const runtime = "nodejs";
export const maxDuration = 120;

// 여러 개의 영수증 PDF를 페이지 순서대로 하나로 합친다(카드사 페이지 분할 대응).
async function mergePdfs(parts: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const p of parts) {
    const src = await PDFDocument.load(p);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const pg of pages) out.addPage(pg);
  }
  return await out.save();
}

interface IncomingRow {
  date?: string;
  merchant: string;
  amount: number;
  currency?: string;
  category: string;
  approval?: string;
  cancel?: { amount: number };
  source?: string; // 분류 방식 (learned / mcc / rule / ai / gateway / none ...)
}

// 분류 방식을 통계용 4가지로 묶는다.
function sourceBucket(source?: string): string {
  if (source === "learned") return "learned";
  if (source === "mcc" || source === "rule") return "rule";
  if (source === "ai") return "ai";
  return "manual";
}

// 한국 시각(KST) 기준 YYYY-MM
function kstMonth(d: Date): string {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 7);
}

// 결제일("2026.09.03", "2026-09-03 18:30" 등)에서 YYYY-MM. 못 읽으면 null.
function paymentMonth(date?: string): string | null {
  const m = String(date || "").match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})/);
  if (!m) return null;
  const mm = Number(m[2]);
  return mm >= 1 && mm <= 12 ? `${m[1]}-${String(mm).padStart(2, "0")}` : null;
}

// 같은 결제를 알아보는 지문. 승인번호가 있으면 승인번호+금액, 없으면
// 가맹점+결제일+금액(중복 제거 규칙과 동일). 원문 대신 해시만 저장한다.
function paymentKey(r: IncomingRow, batchId: string, index: number): string {
  const amt = Math.round(Number(r.amount) || 0);
  const appr = String(r.approval || "")
    .replace(/[^0-9]/g, "")
    .replace(/^0+/, "");
  const merchant = (r.merchant || "").trim();
  const basis = appr
    ? `a:${appr}|${amt}`
    : merchant && r.date
      ? `m:${merchant}|${r.date}|${amt}`
      : `b:${batchId}|${index}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 24);
}

// 영수증 인식 결과(브라우저가 보낸 값)를 숫자/짧은 문자열로만 정리한다.
function cleanReceiptStat(raw: unknown): ReceiptStat | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const n = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
  const stat: ReceiptStat = {
    pages: n(o.pages),
    recognized: n(o.recognized),
    matched: n(o.matched),
    missing: n(o.missing),
    leftover: n(o.leftover),
  };
  if (o.textItems !== undefined && o.textItems !== null)
    stat.textItems = n(o.textItems);
  if (typeof o.error === "string" && o.error) stat.error = o.error.slice(0, 160);
  return stat;
}

// 사용 통계 저장(실패해도 다운로드는 계속).
async function recordUsage(
  batchId: string,
  rows: IncomingRow[],
  receipt?: ReceiptStat,
) {
  try {
    const valid = new Set<string>(ALL_CATEGORIES);
    const now = new Date();
    const fallbackMonth = kstMonth(now);
    const payments: Record<string, PaymentRecord> = {};
    let amount = 0;
    rows.forEach((r, i) => {
      const a = Number(r.amount) || 0;
      amount += a;
      payments[paymentKey(r, batchId, i)] = {
        m: paymentMonth(r.date) || fallbackMonth,
        a,
        c: r.category && valid.has(r.category) ? r.category : UNCLASSIFIED,
        s: sourceBucket(r.source),
        t: now.toISOString(),
      };
    });
    await savePayments(payments);
    await saveUsage(batchId, {
      v: 2,
      at: now.toISOString(),
      rows: rows.length,
      amount,
      ...(receipt ? { receipt } : {}),
    });
  } catch (e) {
    console.error("usage record failed:", e);
  }
}

// Step 2: build the two filled forms from the user-finalized rows, and -- if a
// receipt PDF is attached -- two receipt PDFs whose page order matches the
// Expense / Travel excel row order.
export async function POST(req: NextRequest) {
  try {
    let rows: IncomingRow[] = [];
    let batchId = "";
    let receiptStat: ReceiptStat | undefined;
    let receiptBytes: Uint8Array | null = null;

    const ctype = req.headers.get("content-type") || "";
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const rowsRaw = form.get("rows");
      if (typeof rowsRaw === "string") rows = JSON.parse(rowsRaw);
      const rfs = form
        .getAll("receipts")
        .filter((f): f is File => f instanceof File && f.size > 0);
      if (rfs.length === 1) {
        receiptBytes = new Uint8Array(await rfs[0].arrayBuffer());
      } else if (rfs.length > 1) {
        const parts: Uint8Array[] = [];
        for (const f of rfs) parts.push(new Uint8Array(await f.arrayBuffer()));
        receiptBytes = await mergePdfs(parts);
      }
    } else {
      const body = (await req.json()) as {
        rows?: IncomingRow[];
        batchId?: string;
        receipt?: unknown;
      };
      rows = Array.isArray(body.rows) ? body.rows : [];
      batchId = typeof body.batchId === "string" ? body.batchId : "";
      receiptStat = cleanReceiptStat(body.receipt);
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "No rows provided" }, { status: 400 });
    }

    if (batchId) await recordUsage(batchId, rows, receiptStat);

    const valid = new Set<string>(ALL_CATEGORIES);
    const expenseRows: FormRow[] = [];
    const travelRows: FormRow[] = [];
    const expenseMeta: RowMeta[] = [];
    const travelMeta: RowMeta[] = [];

    for (const r of rows) {
      const form: FormRow = {
        date: r.date,
        merchant: r.merchant,
        amount: Number(r.amount) || 0,
        currency: r.currency || "KRW",
        category: r.category,
      };
      const meta: RowMeta = {
        approval: r.approval || "",
        merchant: r.merchant,
        cancel: r.cancel,
      };
      if (
        r.category &&
        valid.has(r.category) &&
        groupOf(r.category as Category) === "travel"
      ) {
        travelRows.push(form);
        travelMeta.push(meta);
      } else {
        // Expense 또는 미분류는 Expense 파일로 (미분류는 표시).
        if (!(r.category && valid.has(r.category)))
          form.category = UNCLASSIFIED;
        expenseRows.push(form);
        expenseMeta.push(meta);
      }
    }

    const [expenseBuf, travelBuf] = await Promise.all([
      fillForm(expenseRows),
      fillForm(travelRows),
    ]);

    const zip = new JSZip();
    zip.file("Expense.xlsx", expenseBuf);
    zip.file("Travel.xlsx", travelBuf);

    // 영수증 PDF가 첨부되면 — 잘라서 엑셀 순번과 맞춰 두 개의 PDF로.
    // 실패해도 엑셀 2개는 항상 나오도록 감싸서 처리한다.
    if (receiptBytes) {
      try {
        const parsed = await parseReceiptPdf(receiptBytes);
        const reportLines: string[] = [];
        reportLines.push("영수증 PDF 처리 리포트");
        reportLines.push("=====================");
        reportLines.push(
          "원본 페이지: " +
            parsed.pageCount +
            ", 인식된 영수증: " +
            parsed.receipts.length,
        );

        if (parsed.sample) reportLines.push("", parsed.sample);

        if (parsed.error) {
          reportLines.push("⚠️ " + parsed.error);
          zip.file("영수증_리포트.txt", reportLines.join("\n"));
        } else {
          const summary = matchReceipts(
            expenseMeta,
            travelMeta,
            parsed.receipts,
          );
          // 각 호출에 독립 복사본을 넘긴다(버퍼 detach/공유 문제 방지).
          const [expensePdf, travelPdf] = await Promise.all([
            renderReceiptPdf(new Uint8Array(receiptBytes), summary.expense),
            renderReceiptPdf(new Uint8Array(receiptBytes), summary.travel),
          ]);
          zip.file("Expense_Receipts.pdf", expensePdf);
          zip.file("Travel_Receipts.pdf", travelPdf);

          reportLines.push("");
          reportLines.push(
            "Expense: " +
              expenseMeta.length +
              "행 중 영수증 매칭 " +
              summary.expense.matchedRows +
              "건, 미매칭 " +
              summary.expense.missingRows +
              "건",
          );
          reportLines.push(
            "Travel: " +
              travelMeta.length +
              "행 중 영수증 매칭 " +
              summary.travel.matchedRows +
              "건, 미매칭 " +
              summary.travel.missingRows +
              "건",
          );
          if (summary.leftover.length > 0) {
            reportLines.push("");
            reportLines.push(
              "⚠️ 어느 행에도 매칭되지 않아 제외된 영수증 " +
                summary.leftover.length +
                "장:",
            );
            for (const lo of summary.leftover) {
              reportLines.push(
                "  - p" +
                  (lo.page + 1) +
                  "(" +
                  lo.side +
                  ") 승인번호:" +
                  (lo.approval || "없음") +
                  " " +
                  (lo.merchant || ""),
              );
            }
          }
          zip.file("영수증_리포트.txt", reportLines.join("\n"));
        }
      } catch (e: any) {
        zip.file(
          "영수증_리포트.txt",
          "영수증 PDF 처리 중 오류가 발생했습니다: " + (e?.message || e),
        );
      }
    }

    const zipBuf = await zip.generateAsync({ type: "nodebuffer" });

    return new NextResponse(zipBuf, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="expense_claims.zip"',
      },
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message || "Generation failed" },
      { status: 500 },
    );
  }
}
