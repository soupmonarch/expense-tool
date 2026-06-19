import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { fillForm, type FormRow } from "@/lib/fillTemplate";
import { ALL_CATEGORIES, UNCLASSIFIED, groupOf, type Category } from "@/lib/categories";

export const runtime = "nodejs";
export const maxDuration = 60;

interface IncomingRow {
  date?: string;
  merchant: string;
  amount: number;
  currency?: string;
  category: string;
}

// Step 2: build the two filled forms from the user-finalized rows.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { rows?: IncomingRow[] };
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) {
      return NextResponse.json({ error: "No rows provided" }, { status: 400 });
    }

    const valid = new Set<string>(ALL_CATEGORIES);
    const expenseRows: FormRow[] = [];
    const travelRows: FormRow[] = [];

    for (const r of rows) {
      const form: FormRow = {
        date: r.date,
        merchant: r.merchant,
        amount: Number(r.amount) || 0,
        currency: r.currency || "KRW",
        category: r.category,
      };
      if (r.category && valid.has(r.category)) {
        if (groupOf(r.category as Category) === "travel") travelRows.push(form);
        else expenseRows.push(form);
      } else {
        // Unclassified -> keep in the Expense file, flagged for manual fixing.
        form.category = UNCLASSIFIED;
        expenseRows.push(form);
      }
    }

    const [expenseBuf, travelBuf] = await Promise.all([
      fillForm(expenseRows),
      fillForm(travelRows),
    ]);

    const zip = new JSZip();
    zip.file("Expense.xlsx", expenseBuf);
    zip.file("Travel.xlsx", travelBuf);

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
    return NextResponse.json({ error: err?.message || "Generation failed" }, { status: 500 });
  }
}
