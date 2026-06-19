import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";

// The official form: sheet "Expense Reimbursement Type", header on row 4,
// data starts on row 5. We write the yellow columns plus Description (O):
//   C = Expense category, H = Total amount, I = Currency, O = Description.
const SHEET_NAME = "Expense Reimbursement Type";
const HEADER_ROW = 4;
const FIRST_DATA_ROW = 5;
const COL_CATEGORY = 3; // C
const COL_AMOUNT = 8; // H
const COL_CURRENCY = 9; // I
const COL_DESCRIPTION = 15; // O
const FIRST_COL = 1; // A
const LAST_COL = 17; // Q

export interface FormRow {
  date?: string;
  merchant: string;
  amount: number;
  currency?: string;
  category: string;
}

function templatePath(): string {
  return path.join(process.cwd(), "templates", "form_template.xlsx");
}

// "2026-03-04T.." / "2026/03/04" / "2026.03.04" -> "2026.03.04"
function formatDate(d?: string): string {
  if (!d) return "";
  const datePart = String(d).split("T")[0].split(" ")[0];
  return datePart.replace(/[-/.]/g, ".").replace(/\.+/g, ".").replace(/\.$/, "");
}

function descriptionOf(row: FormRow): string {
  const date = formatDate(row.date);
  const name = (row.merchant || "").trim();
  if (date && name) return `${date} / ${name}`;
  return date || name;
}

// Malgun Gothic 11pt, centered, thin border on every cell of the table region.
function styleCell(cell: ExcelJS.Cell) {
  cell.font = { name: "Malgun Gothic", size: 11 };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cell.border = {
    top: { style: "thin" },
    left: { style: "thin" },
    bottom: { style: "thin" },
    right: { style: "thin" },
  };
}

export async function fillForm(rows: FormRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const buf = fs.readFileSync(templatePath());
  await wb.xlsx.load(buf);

  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) throw new Error(`Template sheet "${SHEET_NAME}" not found`);

  // Clear any sample rows the template ships with.
  const lastExisting = Math.max(ws.rowCount, FIRST_DATA_ROW + rows.length + 5);
  for (let r = FIRST_DATA_ROW; r <= lastExisting; r++) {
    ws.getCell(r, COL_CATEGORY).value = null;
    ws.getCell(r, COL_AMOUNT).value = null;
    ws.getCell(r, COL_CURRENCY).value = null;
    ws.getCell(r, COL_DESCRIPTION).value = null;
  }

  rows.forEach((row, i) => {
    const r = FIRST_DATA_ROW + i;
    ws.getCell(r, COL_CATEGORY).value = row.category;
    ws.getCell(r, COL_AMOUNT).value = row.amount;
    ws.getCell(r, COL_CURRENCY).value = row.currency || "KRW";
    ws.getCell(r, COL_DESCRIPTION).value = descriptionOf(row);
  });

  // Apply consistent formatting (font + center + borders) to the whole table
  // region: header row through the last data row, all columns A..Q.
  const lastRow = FIRST_DATA_ROW + rows.length - 1;
  for (let r = HEADER_ROW; r <= Math.max(lastRow, HEADER_ROW); r++) {
    for (let c = FIRST_COL; c <= LAST_COL; c++) {
      styleCell(ws.getCell(r, c));
    }
  }

  const outArrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(outArrayBuffer);
}
