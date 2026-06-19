import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import type { ClassifiedTransaction } from "./types";

// The official form: sheet "Expense Reimbursement Type", header on row 4,
// data starts on row 5. We only write the yellow columns:
//   C = Expense category, H = Total amount, I = Total amount currency.
const SHEET_NAME = "Expense Reimbursement Type";
const FIRST_DATA_ROW = 5;
const COL_CATEGORY = 3; // C
const COL_AMOUNT = 8; // H
const COL_CURRENCY = 9; // I

function templatePath(): string {
  // templates/ is bundled with the app. Resolve relative to project root.
  return path.join(process.cwd(), "templates", "form_template.xlsx");
}

export async function fillForm(
  rows: ClassifiedTransaction[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const buf = fs.readFileSync(templatePath());
  await wb.xlsx.load(buf);

  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) throw new Error(`Template sheet "${SHEET_NAME}" not found`);

  // Clear any sample rows the template ships with (C/H/I from row 5 down).
  const lastExisting = Math.max(ws.rowCount, FIRST_DATA_ROW + rows.length + 5);
  for (let r = FIRST_DATA_ROW; r <= lastExisting; r++) {
    ws.getCell(r, COL_CATEGORY).value = null;
    ws.getCell(r, COL_AMOUNT).value = null;
    ws.getCell(r, COL_CURRENCY).value = null;
  }

  rows.forEach((tx, i) => {
    const r = FIRST_DATA_ROW + i;
    ws.getCell(r, COL_CATEGORY).value = tx.category;
    ws.getCell(r, COL_AMOUNT).value = tx.amount;
    ws.getCell(r, COL_CURRENCY).value = tx.currency || "KRW";
  });

  const outArrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(outArrayBuffer);
}
