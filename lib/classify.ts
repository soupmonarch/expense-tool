import OpenAI from "openai";
import { MCC_RULES, RULES, type Outcome, type TravelSubtype } from "./rules";
import {
  ALL_CATEGORIES,
  UNCLASSIFIED,
  groupOf,
  type Category,
  type Group,
} from "./categories";
import type { ClassifiedTransaction, Transaction } from "./types";

// Resolve a generic travel subtype into a concrete category using isForeign.
function resolveTravel(subtype: TravelSubtype, foreign: boolean): Category {
  switch (subtype) {
    case "airfare":
      return foreign ? "KR-Overseas Business Travel - Airfare" : "KR-Domestic Business Travel - Airfare";
    case "accommodation":
      return foreign
        ? "KR-Overseas Business Travel - Accommodation"
        : "KR-Domestic Business Travel - Accommodation";
    case "transport":
      return foreign
        ? "KR-Overseas Business Travel - Other Transportation"
        : "KR-Domestic Business Travel - Other Transportation";
    case "toll":
      return "KR-Domestic Business Travel - Parking and Toll Charges";
    case "carfuel":
      return "KR-Domestic Business Travel - Car Rental/Fuel Costs";
    case "allowance":
      return "KR-Travel Costs - Travel Allowance";
  }
}

function outcomeToCategory(o: Outcome, foreign: boolean): { group: Group; category: Category } {
  if (o.group === "expense") return { group: "expense", category: o.category };
  return { group: "travel", category: resolveTravel(o.travelSubtype, foreign) };
}

function matchRules(text: string, rules: typeof RULES): Outcome | null {
  const hay = text.toLowerCase();
  if (!hay) return null;
  for (const rule of rules) {
    if (rule.keywords.some((k) => hay.includes(k.toLowerCase()))) return rule;
  }
  return null;
}

// Step 1+2: deterministic. MCC (업종명) first, then merchant-name keywords.
export function classifyDeterministic(
  tx: Transaction,
): { group: Group; category: Category; source: "mcc" | "rule" } | null {
  const foreign = !!tx.isForeign;
  if (tx.merchantCategory) {
    const byMcc = matchRules(tx.merchantCategory, MCC_RULES);
    if (byMcc) return { ...outcomeToCategory(byMcc, foreign), source: "mcc" };
  }
  const byName = matchRules(tx.merchant, RULES);
  if (byName) return { ...outcomeToCategory(byName, foreign), source: "rule" };
  return null;
}

// Step 3: AI fallback for whatever is still unmatched. Batched into one call.
async function classifyByAI(
  unknowns: Transaction[],
): Promise<Map<number, { category: Category; confidence: number }>> {
  const out = new Map<number, { category: Category; confidence: number }>();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || unknowns.length === 0) return out;

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const items = unknowns.map((t) => ({
    id: t.rowIndex,
    merchant: t.merchant,
    industry: t.merchantCategory || "",
    amount: t.amount,
    overseas: !!t.isForeign,
  }));

  const system = [
    "You classify Korean corporate-card transactions into an EXACT expense category.",
    "Choose one value from the allowed list verbatim. Do not invent categories.",
    "Use the `overseas` flag for domestic vs overseas travel categories.",
    'If you genuinely cannot tell, use "' + UNCLASSIFIED + '".',
    "Allowed categories:\n" + ALL_CATEGORIES.map((c) => "- " + c).join("\n"),
  ].join("\n");
  const user =
    'Classify each transaction. Return JSON {"results":[{"id":number,"category":string,"confidence":0..1}]}.\n' +
    JSON.stringify(items);

  try {
    const resp = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const parsed = JSON.parse(resp.choices[0]?.message?.content || "{}") as {
      results?: { id: number; category: string; confidence?: number }[];
    };
    const valid = new Set<string>(ALL_CATEGORIES);
    for (const r of parsed.results || []) {
      if (valid.has(r.category)) {
        out.set(r.id, { category: r.category as Category, confidence: r.confidence ?? 0.5 });
      }
    }
  } catch (err) {
    console.error("AI classification failed:", err);
  }
  return out;
}

export async function classifyAll(transactions: Transaction[]): Promise<ClassifiedTransaction[]> {
  const results: ClassifiedTransaction[] = [];
  const unknowns: Transaction[] = [];

  for (const tx of transactions) {
    const det = classifyDeterministic(tx);
    if (det) {
      results.push({ ...tx, ...det, confidence: 1 });
    } else {
      unknowns.push(tx);
      results.push({ ...tx, group: "unclassified", category: UNCLASSIFIED, source: "none" });
    }
  }

  if (unknowns.length > 0) {
    const aiMap = await classifyByAI(unknowns);
    for (const res of results) {
      if (res.source === "none" && aiMap.has(res.rowIndex)) {
        const ai = aiMap.get(res.rowIndex)!;
        res.category = ai.category;
        res.group = groupOf(ai.category);
        res.source = "ai";
        res.confidence = ai.confidence;
      }
    }
  }

  return results;
}
