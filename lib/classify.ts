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
import { getLearnedMap, getLearnedGateways, normalizeMerchant } from "./store";
import { isPaymentGateway, looksLikeGateway } from "./gateways";

// Confidence below this -> we still apply the AI guess but flag it so the user
// is asked to confirm in the review popup.
const REVIEW_THRESHOLD = 0.7;

// AI 진단 정보 — 분류 화면에서 AI가 실제로 동작했는지/실패 원인을 보여주기 위함.
export interface AiDiagnostic {
  status: "ok" | "disabled_no_key" | "empty_result" | "error";
  model?: string;
  attempted: number; // AI에 보낸 미분류 건수
  classified: number; // AI가 실제로 분류해준 건수
  message?: string;
}

// AI sometimes returns a category whose casing/spacing/punctuation differs from
// the exact canonical string (e.g. "KR-Telephone Expenses" vs the canonical
// "KR-TELEPHONE EXPENSES"), which previously caused valid guesses to be silently
// dropped to UNCLASSIFIED. Match tolerantly against the allowed list.
function normalizeCategoryKey(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/^\s*kr[\s\-:]*/, "")
    .replace(/[\s\-_/]+/g, " ")
    .trim();
}

const CATEGORY_BY_NORM: Map<string, Category> = new Map(
  ALL_CATEGORIES.map((c) => [normalizeCategoryKey(c), c] as [string, Category]),
);

function resolveAICategory(raw: string | undefined | null): Category | null {
  if (!raw) return null;
  if ((ALL_CATEGORIES as string[]).includes(raw)) return raw as Category;
  return CATEGORY_BY_NORM.get(normalizeCategoryKey(raw)) ?? null;
}

// AI 프롬프트용 few-shot 예시 생성. 사람이 확정한 학습 매핑(회사 고유 관례)을
// unknown 가맹점명과 토큰이 겹치는 것 위주로 최대 MAX_FEWSHOT개 골라 AI에게 제시한다.
// 관련 사례가 적으면 점수 0인 사례로 채워 전반적인 회사 분류 성향도 반영한다.
const MAX_FEWSHOT = 40;

function tokenize(s: string): string[] {
  return String(s || "")
    .toLowerCase()
    .split(/[^a-z0-9\uac00-\ud7a3]+/)
    .filter((t) => t.length >= 2);
}

function buildFewShotExamples(
  unknowns: Transaction[],
  learned: Record<string, string>,
): string {
  const entries = Object.entries(learned).filter(
    ([, cat]) => cat && (ALL_CATEGORIES as string[]).includes(cat),
  );
  if (entries.length === 0) return "";

  const unknownTokens = new Set<string>();
  for (const u of unknowns)
    for (const t of tokenize(u.merchant)) unknownTokens.add(t);

  const scored = entries.map(([merchant, category]) => {
    let score = 0;
    for (const t of tokenize(merchant)) if (unknownTokens.has(t)) score++;
    return { merchant, category, score };
  });

  // 관련도 높은 순 → 최대 MAX_FEWSHOT개.
  scored.sort((a, b) => b.score - a.score);
  return scored
    .slice(0, MAX_FEWSHOT)
    .map((p) => `- "${p.merchant}" => ${p.category}`)
    .join("\n");
}

function resolveTravel(subtype: TravelSubtype, foreign: boolean): Category {
  switch (subtype) {
    case "airfare":
      return foreign
        ? "KR-Overseas Business Travel - Airfare"
        : "KR-Domestic Business Travel - Airfare";
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

function outcomeToCategory(
  o: Outcome,
  foreign: boolean,
): { group: Group; category: Category } {
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

// AI fallback. Instructed to ALWAYS pick the single best category and avoid
// UNCLASSIFIED unless the merchant text is truly meaningless. Returns a
// confidence so low-confidence guesses can be sent to the review popup.
async function classifyByAI(
  unknowns: Transaction[],
  learned: Record<string, string>,
): Promise<{
  out: Map<number, { category: Category | "UNCLASSIFIED"; confidence: number }>;
  diag: AiDiagnostic;
}> {
  const out = new Map<
    number,
    { category: Category | "UNCLASSIFIED"; confidence: number }
  >();
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const diag: AiDiagnostic = {
    status: "ok",
    model,
    attempted: unknowns.length,
    classified: 0,
  };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    diag.status = "disabled_no_key";
    diag.message = "OPENAI_API_KEY 환경변수가 설정되지 않았습니다.";
    return { out, diag };
  }
  if (unknowns.length === 0) return { out, diag };

  const client = new OpenAI({ apiKey });

  const fewShot = buildFewShotExamples(unknowns, learned);

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
    'Only return "' +
      UNCLASSIFIED +
      '" if the merchant text is empty or pure gibberish.',
    "Set confidence honestly: 0.9+ when obvious, 0.4-0.6 when it is an educated guess.",
    fewShot
      ? "Company-confirmed examples \u2014 mimic these conventions when a merchant looks similar:\n" +
        fewShot
      : "",
    "Allowed categories:\n" + ALL_CATEGORIES.map((c) => "- " + c).join("\n"),
  ]
    .filter(Boolean)
    .join("\n");
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
    for (const r of parsed.results || []) {
      const resolved = resolveAICategory(r.category);
      if (resolved) {
        out.set(r.id, {
          category: resolved,
          confidence: r.confidence ?? 0.5,
        });
        diag.classified++;
      } else if (normalizeCategoryKey(r.category) === "unclassified") {
        out.set(r.id, { category: UNCLASSIFIED, confidence: 0 });
      }
    }
    if (out.size === 0) {
      diag.status = "empty_result";
      diag.message =
        "AI가 호출됐지만 사용할 수 있는 분류 결과를 반환하지 않았습니다.";
    }
  } catch (err: any) {
    console.error("AI classification failed:", err);
    diag.status = "error";
    diag.message = String(err?.message || err) || "알 수 없는 오류";
  }
  return { out, diag };
}

export async function classifyAll(transactions: Transaction[]): Promise<{
  results: ClassifiedTransaction[];
  ai: AiDiagnostic;
}> {
  const results: ClassifiedTransaction[] = [];
  const unknowns: Transaction[] = [];
  let ai: AiDiagnostic = { status: "ok", attempted: 0, classified: 0 };

  // Shared learned mappings take top priority (human-confirmed truth).
  const [learned, learnedGateways] = await Promise.all([
    getLearnedMap(),
    getLearnedGateways(),
  ]);
  const validCats = new Set<string>(ALL_CATEGORIES);

  for (const tx of transactions) {
    const base: ClassifiedTransaction = {
      ...tx,
      id: tx.rowIndex,
      group: "unclassified",
      category: UNCLASSIFIED,
      source: "none",
      needsReview: true,
      noLearn: false,
    };

    // Payment-gateway-only rows: we never know the real purchase, so ALWAYS ask
    // and NEVER learn (skip learned/rule/AI entirely). 고정 키워드 목록 + 사용자가
    // 학습시킨 PSP 둘 다 적용한다.
    if (
      isPaymentGateway(tx.merchant) ||
      learnedGateways.has(normalizeMerchant(tx.merchant))
    ) {
      base.source = "gateway";
      base.noLearn = true;
      base.needsReview = true;
      base.confidence = 0;
      results.push(base);
      continue;
    }

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

  // PSP 의심 표시: 고정 목록·학습 PSP는 아니지만 이름이 결제/페이류로 보이는 행은
  // 검토 팝업에 'PSP인가요?' 체크박스를 띄우도록 표시한다. AI 추측 행은 잘못 학습될
  // 위험이 크므로 확신도와 무관하게 검토 대상으로 끌어올린다(규칙/학습 확정 행은 신뢰).
  for (const res of results) {
    if (res.source === "gateway") continue;
    if (looksLikeGateway(res.merchant)) {
      res.suspectGateway = true;
      if (res.source === "ai") res.needsReview = true;
    }
  }

  if (unknowns.length > 0) {
    const { out: aiMap, diag } = await classifyByAI(unknowns, learned);
    ai = diag;
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

  return { results, ai };
}
