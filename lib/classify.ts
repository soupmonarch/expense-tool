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
import { getLearnedMap, normalizeMerchant } from "./store";

// Confidence below this -> we still apply the AI guess but flag it so the user
// is asked to confirm in the review popup.
const REVIEW_THRESHOLD = 0.7;

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
  const hay = (text || "").toLowerCase();
  if (!hay) return null;
  for (const rule of rules) {
    if (rule.keywords.some((k) => hay.includes(k.toLowerCase()))) return rule;
  }
  return null;
}

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

// AI fallback. Now instructed to ALWAYS pick the single best category and avoid
// UNCLASSIFIED unless the merchant text is truly meaningless. Returns a
// confidence so low-confidence guesses can be sent to the review popup.
async function classifyByAI(
  unknowns: Transaction[],
): Promise<Map<number, { category: Category | "UNCLASSIFIED"; confidence: number }>> {
  const out = new Map<number, { category: Category | "UNCLASSIFIED"; confidence: number }>();
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
    "ALWAYS choose the single most likely category from the allowed list, verbatim.",
    "Reason from the merchant name and industry. Use general knowledge of well-known",
    "Korean and global brands (e.g. food delivery, ride hailing, online retail, telco).",
    "Use the `overseas` flag to pick Domestic vs Overseas travel categories.",
    'Only return "' + UNCLASSIFIED + '" if the merchant text is empty or pure gibberish.',
    "Set confidence honestly: 0.9+ when obvious, 0.4-0.6 when it is an educated guess.",
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
      } else if (r.category === UNCLASSIFIED) {
        out.set(r.id, { category: UNCLASSIFIED, confidence: 0 });
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

  // Shared learned mappings take top priority (human-confirmed truth).
  const learned = await getLearnedMap();
  const validCats = new Set<string>(ALL_CATEGORIES);

  for (const tx of transactions) {
    const base: ClassifiedTransaction = {
      ...tx,
      id: tx.rowIndex,
      group: "unclassified",
      category: UNCLASSIFIED,
      source: "none",
      needsReview: true,
    };

    const learnedCat = learned[normalizeMerchant(tx.merchant)];
    if (learnedCat && validCats.has(learnedCat)) {
      base.category = learnedCat as Category;
      base.group = groupOf(learnedCat as Category);
      base.source = "learned";
      base.confidence = 1;
      base.needsReview = false;
      results.push(base);
      continue;
    }

    const det = classifyDeterministic(tx);
    if (det) {
      base.category = det.category;
      base.group = det.group;
      base.source = det.source;
      base.confidence = 1;
      base.needsReview = false;
      results.push(base);
      continue;
    }

    unknowns.push(tx);
    results.push(base);
  }

  if (unknowns.length > 0) {
    const aiMap = await classifyByAI(unknowns);
    for (const res of results) {
      if (res.source !== "none") continue;
      const ai = aiMap.get(res.rowIndex);
      if (ai && ai.category !== UNCLASSIFIED) {
        res.category = ai.category;
        res.group = groupOf(ai.category as Category);
        res.source = "ai";
        res.confidence = ai.confidence;
        res.needsReview = ai.confidence < REVIEW_THRESHOLD;
      } else {
        // No key, or AI gave up -> stays UNCLASSIFIED and needs review.
        res.needsReview = true;
      }
    }
  }

  return results;
}
