import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { parseStatement, type ColumnMapping } from "@/lib/parseStatement";
import { classifyAll } from "@/lib/classify";
import { fillForm } from "@/lib/fillTemplate";

// Force Node.js runtime (exceljs / xlsx need Node APIs, not the Edge runtime).
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // Optional manual column overrides from the UI (0-based indexes).
    const override: ColumnMapping = {};
    const keys: (keyof ColumnMapping)[] = ["merchant", "amount", "currency", "date"];
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
            "No transactions detected. Check that the file has a merchant column and an amount column, or set the column mapping manually.",
          detectedMapping,
        },
        { status: 422 },
      );
    }

    const classified = await classifyAll(transactions);

    const expenseRows = classified.filter((t) => t.group === "expense");
    const travelRows = classified.filter((t) => t.group === "travel");
    const unclassified = classified.filter((t) => t.group === "unclassified");

    // Unclassified rows are appended to BOTH files' review is awkward; instead we
    // include them in the Expense file so nothing is silently dropped, marked
    // with the UNCLASSIFIED category for a human to fix.
    const expenseOut = [...expenseRows, ...unclassified];

    const [expenseBuf, travelBuf] = await Promise.all([
      fillForm(expenseOut),
      fillForm(travelRows),
    ]);

    const zip = new JSZip();
    zip.file("Expense.xlsx", expenseBuf);
    zip.file("Travel.xlsx", travelBuf);

    // A small classification report so users can audit AI/rule decisions.
    const report = classified.map((t) => ({
      date: t.date ?? "",
      merchant: t.merchant,
      amount: t.amount,
      currency: t.currency,
      group: t.group,
      category: t.category,
      source: t.source,
      confidence: t.confidence ?? "",
    }));
    zip.file("classification_report.json", JSON.stringify(report, null, 2));

    const zipBuf = await zip.generateAsync({ type: "nodebuffer" });

    return new NextResponse(zipBuf, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="expense_claims.zip"',
        "X-Stats": JSON.stringify({
          total: classified.length,
          expense: expenseRows.length,
          travel: travelRows.length,
          unclassified: unclassified.length,
        }),
      },
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message || "Conversion failed" },
      { status: 500 },
    );
  }
}
