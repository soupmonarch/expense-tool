"use client";

import { T } from "@/lib/theme";
import { version as APP_VERSION } from "../package.json";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from "react";
import {
  ALL_CATEGORIES,
  EXPENSE_CATEGORIES,
  TRAVEL_CATEGORIES,
  UNCLASSIFIED,
  groupOf,
  type Category,
} from "@/lib/categories";
import {
  attachReceiptsToZip,
  mergePdfFiles,
  parseReceiptsRemote,
  readJsonSafe,
  receiptStats,
} from "@/lib/receiptsClient";
import type { ParsedReceipts } from "@/lib/parseReceipts";
import { matchReceipts, type Half, type RowMeta } from "@/lib/buildReceiptPdf";
import { normalizeMerchant } from "@/lib/normalize";
import CategoryPicker from "@/components/CategoryPicker";
import Logo from "@/components/Logo";
import { getDeviceId } from "@/lib/clientId";

interface Row {
  id: number;
  date: string;
  time: string;
  merchant: string;
  amount: number;
  currency: string;
  approval: string;
  merchantCategory: string;
  isForeign: boolean;
  group: string;
  category: string;
  source: string;
  confidence: number | null;
  cancelAmount: number | null;
  needsReview: boolean;
  needsManual: boolean;
  noLearn: boolean;
  suspectGateway: boolean;
  // AI가 높은 확신도로 자동 분류해 팝업 없이 지나갔을 항목. 검토 팝업의
  // 'AI 자동 분류 확인' 칸에 보여 주고, 확인되면 false 로 바꾼다(클라이언트 전용).
  aiCheck?: boolean;
}

interface CancelQuestion {
  id: number;
  kind: "heuristic" | "orphan";
  merchant: string;
  cancelAmount: number;
  cancelDate?: string;
  cancelTime?: string;
  paymentId?: number;
  paymentAmount?: number;
  paymentDate?: string;
}

interface Stats {
  total: number;
  expense: number;
  travel: number;
  needsReview: number;
  autoVoided: number;
  voidedAmount: number;
  cancelQuestions: number;
  duplicatesRemoved?: number;
  filesProcessed?: number;
  rawCount?: number;
  mode?: string;
}

interface AiDiagnostic {
  status: "ok" | "disabled_no_key" | "empty_result" | "error";
  model?: string;
  attempted: number;
  classified: number;
  message?: string;
}

// heuristic: "full"(전액취소 제외) | "separate"(별개 건 유지)
// orphan:    "exclude"(제외) | "include"(음수로 포함)
type CancelChoice = "full" | "separate" | "exclude" | "include";

interface Payload {
  date: string;
  merchant: string;
  amount: number;
  currency: string;
  category: string;
  approval: string;
  cancel?: { amount: number };
  id?: number; // 원본 행 id (최종 검토에서 분류 수정용, 고아 환불 행은 없음)
  source?: string; // 분류 방식 (사용 통계용)
}

const VALID_CATEGORIES = new Set<string>(ALL_CATEGORIES);

// /api/generate 와 같은 규칙: 유효한 Travel 분류만 Travel 파일, 나머지(미분류 포함)는 Expense.
function isTravelCategory(category: string): boolean {
  return (
    VALID_CATEGORIES.has(category) &&
    groupOf(category as Category) === "travel"
  );
}

// 버그·오류 제보 연락처 (메인 화면 하단에 표시)
const BUG_REPORT_NAME = "Hyeongju Han";
const BUG_REPORT_WECHAT = "wxid_04j0cuchr1j122";

function fmt(n: number): string {
  return (n || 0).toLocaleString("ko-KR");
}

export default function Home() {
  const [mode, setMode] = useState<"excel" | "pdf" | "both">("both");
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const [receiptDragOver, setReceiptDragOver] = useState(false);
  // 영수증 읽는 방법: 기본은 AI, "더보기"에서 OCR 로 바꿀 수 있다. 브라우저에 기억한다.
  // (예전 'AI 토글' 저장값과 섞이지 않도록 새 키를 쓴다 → 모두 AI 기본으로 시작)
  const [aiReceipt, setAiReceipt] = useState(true);
  // 서버의 AI 모델 이름·사용 가능 여부 (키가 없으면 자동으로 OCR)
  const [aiInfo, setAiInfo] = useState<{ model: string; available: boolean } | null>(null);
  useEffect(() => {
    try {
      setAiReceipt(localStorage.getItem("expense_tool_receipt_reader") !== "ocr");
    } catch {
      /* ignore */
    }
    fetch("/api/ai-info")
      .then((r) => r.json())
      .then((d) => setAiInfo({ model: String(d.model || ""), available: !!d.available }))
      .catch(() => setAiInfo(null));
  }, []);
  function setReader(ai: boolean) {
    setAiReceipt(ai);
    try {
      localStorage.setItem("expense_tool_receipt_reader", ai ? "ai" : "ocr");
    } catch {
      /* ignore */
    }
    resetResults();
  }
  // 실제로 AI 를 쓰는지: 사용자가 OCR 을 고르지 않았고 서버에 AI 키가 있을 때
  const useAiReader = aiReceipt && aiInfo?.available !== false;
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // 진행 상황 메시지 (분류·다운로드 중 단계 표시)
  const [progress, setProgress] = useState<string | null>(null);
  // 버그 제보 위챗 ID 복사 완료 표시
  const [wechatCopied, setWechatCopied] = useState(false);

  // 이전 작업 이어하기용 저장 형식
  type SavedWork = {
    savedAt: number;
    mode: "excel" | "pdf" | "both";
    rows: Row[];
    stats: Stats | null;
    cancelQuestions: CancelQuestion[];
    cancelChoice: Record<number, CancelChoice>;
    learnChoice: Record<number, boolean>;
    gatewayChoice: Record<number, boolean>;
    aiDiag: AiDiagnostic | null;
    persistent: boolean;
    batchId?: string;
  };
  const [resume, setResume] = useState<SavedWork | null>(null);
  const [aiDiag, setAiDiag] = useState<AiDiagnostic | null>(null);

  const [rows, setRows] = useState<Row[] | null>(null);
  // 분류 작업 1회를 구분하는 id. 같은 작업을 여러 번 다운로드해도 통계가 한 번만 잡힌다.
  const [batchId, setBatchId] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [persistent, setPersistent] = useState(false);
  const [userName, setUserName] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("expense_tool_user_name");
      if (saved) setUserName(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const [cancelQuestions, setCancelQuestions] = useState<CancelQuestion[]>([]);
  const [cancelChoice, setCancelChoice] = useState<
    Record<number, CancelChoice>
  >({});
  const [learnChoice, setLearnChoice] = useState<Record<number, boolean>>({});
  const [gatewayChoice, setGatewayChoice] = useState<Record<number, boolean>>(
    {},
  );

  const [finalOpen, setFinalOpen] = useState(false);
  // 최종 검토에서 영수증 매칭 결과를 보여 주기 위한 영수증 파싱 결과
  const [receiptParsed, setReceiptParsed] = useState<ParsedReceipts | null>(
    null,
  );
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptErr, setReceiptErr] = useState<string | null>(null);
  // 검토 화면에서 선택한 행(id)과 그 영수증 미리보기
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [previewImgs, setPreviewImgs] = useState<string[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const reviewRows = useMemo(
    () => (rows || []).filter((r) => r.needsReview),
    [rows],
  );
  // AI가 확신을 갖고 분류한 항목(확인 대기). needsReview 항목과 겹치지 않는다.
  const aiRows = useMemo(
    () => (rows || []).filter((r) => r.aiCheck && !r.needsReview),
    [rows],
  );

  const totalUsed = useMemo(
    () => (rows || []).reduce((s, r) => s + (r.amount > 0 ? r.amount : 0), 0),
    [rows],
  );

  const canClassify =
    mode === "excel"
      ? files.length > 0
      : mode === "pdf"
        ? receiptFiles.length > 0
        : files.length > 0 && receiptFiles.length > 0;

  function resetResults() {
    setRows(null);
    setStats(null);
    setError(null);
    setDone(false);
    setAiDiag(null);
    setCancelQuestions([]);
    setCancelChoice({});
    setLearnChoice({});
    setGatewayChoice({});
    setFinalOpen(false);
    setReceiptParsed(null);
    setReceiptErr(null);
  }

  // 영수증 PDF 병합/파싱 결과 캐시 (분류하기 → 다운로드에서 재사용).
  // 원본 PDF는 서버로 올리지 않는다(Vercel 4.5MB 요청 한도).
  const receiptCache = useRef<{
    key: string;
    bytes: Uint8Array;
    parsed: ParsedReceipts;
  } | null>(null);

  // ── 이전 작업 이어하기 (브라우저 로컬 저장) ──────────────────────────
  const WORK_KEY = "expense_tool_last_work";

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WORK_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as SavedWork;
      if (saved && Array.isArray(saved.rows) && saved.rows.length > 0)
        setResume(saved);
    } catch {
      /* 손상된 저장본은 무시 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!rows || rows.length === 0) return;
    try {
      const saved: SavedWork = {
        savedAt: Date.now(),
        mode,
        rows,
        stats,
        cancelQuestions,
        cancelChoice,
        learnChoice,
        gatewayChoice,
        aiDiag,
        persistent,
        batchId,
      };
      localStorage.setItem(WORK_KEY, JSON.stringify(saved));
    } catch {
      /* 저장 실패(용량 초과 등)는 무시 */
    }
  }, [
    rows,
    stats,
    mode,
    cancelQuestions,
    cancelChoice,
    learnChoice,
    gatewayChoice,
    aiDiag,
    persistent,
    batchId,
  ]);

  function restoreWork() {
    if (!resume) return;
    setMode(resume.mode);
    setRows(resume.rows);
    setStats(resume.stats);
    setCancelQuestions(resume.cancelQuestions || []);
    setCancelChoice(resume.cancelChoice || {});
    setLearnChoice(resume.learnChoice || {});
    setGatewayChoice(resume.gatewayChoice || {});
    setAiDiag(resume.aiDiag ?? null);
    setPersistent(!!resume.persistent);
    setBatchId(
      resume.batchId ||
        Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    );
    setError(null);
    setDone(false);
    setResume(null);
  }

  function discardWork() {
    try {
      localStorage.removeItem(WORK_KEY);
    } catch {
      /* 무시 */
    }
    setResume(null);
  }

  // 위챗 ID를 클립보드에 복사한다. clipboard API가 막힌 환경(http 등)에서는
  // 임시 textarea + execCommand 로 대신 복사한다.
  async function copyWechatId() {
    try {
      await navigator.clipboard.writeText(BUG_REPORT_WECHAT);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = BUG_REPORT_WECHAT;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setWechatCopied(true);
    setTimeout(() => setWechatCopied(false), 2000);
  }

  // AI 오류 메시지를 사용자 친화적인 한국어로 바꾼다 (크레딧 소진 등)
  function friendlyAiMessage(msg?: string): string {
    if (msg && /429|quota|credit|billing/i.test(msg))
      return "AI 분류 크레딧이 소진되어 이번에는 규칙·학습 데이터로만 분류했습니다. 관리자에게 크레딧 충전을 요청해 주세요.";
    return `AI 오류 — ${msg || "알 수 없는 오류"}`;
  }

  async function ensureReceiptsParsed() {
    const key =
      (useAiReader ? "ai|" : "ocr|") +
      receiptFiles.map((f) => `${f.name}:${f.size}:${f.lastModified}`).join("|");
    if (receiptCache.current && receiptCache.current.key === key)
      return receiptCache.current;
    setProgress(
      receiptFiles.length > 1 ? "영수증 PDF 병합 중…" : "영수증 PDF 준비 중…",
    );
    const bytes = await mergePdfFiles(receiptFiles);
    const parsed = await parseReceiptsRemote(bytes, setProgress, {
      useAi: useAiReader,
    });
    const entry = { key, bytes, parsed };
    receiptCache.current = entry;
    return entry;
  }

  // 최종 검토를 열면 영수증 PDF를 미리 분석해 둔다(매칭 결과 표시용).
  // 결과는 receiptCache 에 남아 다운로드할 때 그대로 재사용된다.
  useEffect(() => {
    if (!finalOpen || mode === "excel" || receiptFiles.length === 0) return;
    if (receiptParsed || receiptLoading) return;
    let cancelled = false;
    setReceiptLoading(true);
    setReceiptErr(null);
    ensureReceiptsParsed()
      .then((rc) => {
        if (!cancelled) setReceiptParsed(rc.parsed);
      })
      .catch((e: any) => {
        if (!cancelled) setReceiptErr(e?.message || "영수증 분석 실패");
      })
      .finally(() => {
        setReceiptLoading(false);
        setProgress(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalOpen, mode, receiptFiles]);

  function addExcelFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
    resetResults();
  }
  function addReceiptFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setReceiptFiles((prev) => [...prev, ...Array.from(list)]);
    resetResults();
  }
  function removeExcelFile(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
    resetResults();
  }
  function removeReceiptFile(i: number) {
    setReceiptFiles((prev) => prev.filter((_, idx) => idx !== i));
    resetResults();
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragOver(false);
    addExcelFiles(e.dataTransfer.files);
  }

  async function classify() {
    if (!canClassify) return;
    setLoading(true);
    setError(null);
    setDone(false);
    setAiDiag(null);
    setRows(null);
    setStats(null);
    try {
      const fd = new FormData();
      fd.append("mode", mode);
      if (mode !== "pdf") for (const f of files) fd.append("file", f);
      // 영수증 PDF는 서버로 통째로 올리지 않는다(4.5MB 한도 →
      // "Request Entity Too Large" 오류 방지). PDF만 모드에서는
      // 브라우저에서 조각 파싱한 결과(JSON)만 전달한다.
      if (mode === "pdf") {
        const rc = await ensureReceiptsParsed();
        fd.append(
          "receiptData",
          JSON.stringify({
            receipts: rc.parsed.receipts,
            pageCount: rc.parsed.pageCount,
            errors: rc.parsed.error ? [rc.parsed.error] : [],
          }),
        );
      }
      setProgress(
        mode === "pdf"
          ? "분류 결과 정리 중…"
          : "카드 내역 업로드 및 AI 분류 중… (내역이 많으면 1분 이상 걸릴 수 있어요)",
      );
      const res = await fetch("/api/classify", { method: "POST", body: fd });
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);

      // AI가 확신도 높게 분류한 행도 검토 팝업에서 한 번 확인하도록 표시한다.
      const newRows = (data.rows as Row[]).map((r) => ({
        ...r,
        aiCheck: r.source === "ai" && !r.needsReview,
      }));
      const questions = (data.cancelQuestions || []) as CancelQuestion[];
      setBatchId(
        Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      );
      setRows(newRows);
      setStats(data.stats);
      setPersistent(!!data.persistent);
      setAiDiag(data.aiDiagnostic || null);
      setCancelQuestions(questions);

      // 기본값: 휴리스틱 추정은 전액취소(제외), 고아 환불은 제외.
      const cc: Record<number, CancelChoice> = {};
      for (const q of questions)
        cc[q.id] = q.kind === "orphan" ? "exclude" : "full";
      setCancelChoice(cc);

      // Default: learn every reviewed row (AI 자동 분류 확인 포함) except
      // gateway (no-learn) rows.
      const lc: Record<number, boolean> = {};
      for (const r of newRows)
        if (r.needsReview || r.aiCheck) lc[r.id] = !r.noLearn;
      setLearnChoice(lc);

      // PSP로 보이는 항목은 '결제대행사' 체크박스를 자동으로 제안(미리 체크)한다.
      const gc: Record<number, boolean> = {};
      for (const r of newRows)
        if (r.needsReview && !r.noLearn) gc[r.id] = !!r.suspectGateway;
      setGatewayChoice(gc);

      // 분류가 끝나면 바로 검토 화면(확인 필요 + 전체 목록 + 영수증)으로 간다.
      setFinalOpen(true);
    } catch (err: any) {
      setError(err?.message || "Something went wrong");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  function setRowCategory(id: number, category: string) {
    setRowsCategory([id], category);
  }

  // 검토 팝업: 같은 가맹점이 여러 건이면 한 번에 같은 분류로 바꾼다.
  // (결제대행사 행은 건마다 산 물건이 달라서 묶지 않는다)
  function setReviewCategory(r: Row, category: string) {
    if (r.source === "gateway") return setRowsCategory([r.id], category);
    const key = normalizeMerchant(r.merchant);
    const ids = [...reviewRows, ...aiRows]
      .filter((x) => x.source !== "gateway" && normalizeMerchant(x.merchant) === key)
      .map((x) => x.id);
    setRowsCategory(ids.length ? ids : [r.id], category);
  }

  function setRowsCategory(ids: number[], category: string) {
    const set = new Set(ids);
    setRows((prev) =>
      (prev || []).map((r) =>
        set.has(r.id)
          ? {
              ...r,
              category,
              group: VALID_CATEGORIES.has(category)
                ? groupOf(category as Category)
                : "unclassified",
            }
          : r,
      ),
    );
  }

  function setRowField(
    id: number,
    field: "merchant" | "amount" | "date" | "time",
    value: string,
  ) {
    setRows((prev) =>
      (prev || []).map((r) =>
        r.id === id
          ? { ...r, [field]: field === "amount" ? Number(value) || 0 : value }
          : r,
      ),
    );
  }
  function setCancel(id: number, choice: CancelChoice) {
    setCancelChoice((p) => ({ ...p, [id]: choice }));
  }
  function setLearn(id: number, on: boolean) {
    setLearnChoice((p) => ({ ...p, [id]: on }));
  }
  function setGateway(id: number, on: boolean) {
    setGatewayChoice((p) => ({ ...p, [id]: on }));
  }
  // 칸(분류 확인 / AI 자동 분류 확인)별로 학습 체크를 일괄 켜고 끈다.
  function setAllLearn(list: Row[], on: boolean) {
    setLearnChoice((prev) => {
      const next = { ...prev };
      for (const r of list) if (!r.noLearn) next[r.id] = on;
      return next;
    });
  }

  // 이용 기록에 남길 이름. 비어 있으면 한 번 물어보고 브라우저에 기억한다.
  function ensureUserName(): string {
    let name = userName.trim();
    if (!name) {
      name = (window.prompt("이용 기록에 남길 이름을 입력해 주세요.") || "").trim().slice(0, 40);
      if (name) setUserName(name);
    }
    if (name) {
      try {
        localStorage.setItem("expense_tool_user_name", name);
      } catch {
        /* ignore */
      }
    }
    return name;
  }

  // 검토 화면에서 "다운로드"를 누를 때 학습할 항목을 공유 저장소에 저장한다.
  async function saveLearning(by: string = userName.trim()) {
    // Save only the rows the user chose to learn (per-item), excluding gateways
    // and unclassified. AI 자동 분류 확인 칸의 항목도 같은 규칙으로 저장한다.
    const candidates = [...reviewRows, ...aiRows];
    // PSP로 표시한 가맹점은 결제대행사로 학습(카테고리 학습 제외).
    const gateways = candidates
      .filter((r) => !r.noLearn && gatewayChoice[r.id])
      .map((r) => r.merchant)
      .filter((m, i, a) => a.findIndex((x) => normalizeMerchant(x) === normalizeMerchant(m)) === i);
    // 카테고리 학습은 PSP로 표시하지 않은 행에만 적용한다.
    const items = candidates
      .filter(
        (r) =>
          !r.noLearn &&
          !gatewayChoice[r.id] &&
          learnChoice[r.id] &&
          r.category &&
          r.category !== UNCLASSIFIED,
      )
      .map((r) => ({ merchant: r.merchant, category: r.category }))
      // 같은 가맹점이 여러 건이면 한 번만 저장한다 (기록이 중복으로 쌓이지 않게)
      .filter((it, i, a) => a.findIndex((x) => normalizeMerchant(x.merchant) === normalizeMerchant(it.merchant)) === i);
    if (items.length > 0 || gateways.length > 0) {
      try {
        localStorage.setItem("expense_tool_user_name", by);
      } catch {
        /* ignore */
      }
      try {
        await fetch("/api/learn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items, gateways, by, device: getDeviceId() }),
        });
      } catch {
        /* non-fatal: still let the user download */
      }
    }
    // Category rows are now resolved; cancel choices stay in state for download.
    setRows((prev) =>
      (prev || []).map((r) => ({ ...r, needsReview: false, aiCheck: false })),
    );
  }

  // Apply confirmed cancellation choices to produce the final payload rows.
  function finalizeRows(): Payload[] {
    // 휴리스틱 질문: 추정 매칭된 원결제(paymentId)에 대한 결정.
    const heuristicByPayment = new Map<number, CancelQuestion>();
    const orphans: CancelQuestion[] = [];
    for (const q of cancelQuestions) {
      if (q.kind === "heuristic" && q.paymentId !== undefined)
        heuristicByPayment.set(q.paymentId, q);
      else if (q.kind === "orphan") orphans.push(q);
    }

    const out: Payload[] = [];
    for (const r of rows || []) {
      const base: Payload = {
        id: r.id,
        source: r.source,
        date: r.date,
        merchant: r.merchant,
        amount: r.amount,
        currency: r.currency,
        category: r.category,
        approval: r.approval,
      };

      // 자동 부분취소가 반영된 결제: 금액은 이미 순액, 구매+취소 영수증을 함께 붙인다.
      if (r.cancelAmount && r.cancelAmount > 0) {
        out.push({ ...base, cancel: { amount: r.cancelAmount } });
        continue;
      }

      // 휴리스틱 추정으로 취소가 의심되는 결제
      const hq = heuristicByPayment.get(r.id);
      if (hq) {
        const choice = cancelChoice[hq.id] || "full";
        if (choice === "full") continue; // 전액취소로 보고 제외
        // "separate" -> 원래 금액 그대로 유지
      }

      out.push(base);
    }

    // 고아 환불: 사용자가 '음수로 포함'을 선택한 건만 음수 금액 행으로 추가
    for (const q of orphans) {
      if ((cancelChoice[q.id] || "exclude") === "include") {
        out.push({
          date: q.cancelDate || "",
          merchant: q.merchant,
          amount: -Math.abs(q.cancelAmount),
          currency: "KRW",
          category: UNCLASSIFIED,
          approval: "",
        });
      }
    }

    return out;
  }

  async function download(by: string = userName.trim()) {
    if (!rows) return;
    setDownloading(true);
    setError(null);
    setDone(false);
    try {
      const payload = finalizeRows();
      // 영수증이 있으면 먼저 분석해(대개 최종 검토에서 이미 끝나 있음) 인식 결과를
      // 사용 통계에 함께 남긴다. 숫자만 보내고 영수증 내용은 보내지 않는다.
      const hasReceiptFiles = mode !== "excel" && receiptFiles.length > 0;
      const rc = hasReceiptFiles ? await ensureReceiptsParsed() : null;
      const receipt = rc ? receiptStats(payload, rc.parsed) : undefined;
      setProgress("엑셀 양식 생성 중…");
      // 영수증 PDF는 서버로 올리지 않고(4.5MB 한도) 브라우저에서 직접
      // 잘라 정렬한 뒤, 서버가 만든 엑셀 ZIP 에 합친다.
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: payload, batchId, receipt, by, mode, device: getDeviceId() }),
      });
      if (!res.ok) {
        let msg = `Failed (${res.status})`;
        try {
          const data = await readJsonSafe(res);
          msg = data?.error || msg;
        } catch (e: any) {
          msg = e?.message || msg;
        }
        throw new Error(msg);
      }
      let blob = await res.blob();
      if (rc) {
        setProgress("영수증 PDF 자르기·정렬 중…");
        blob = await attachReceiptsToZip(blob, payload, rc.bytes, rc.parsed);
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "expense_claims.zip";
      a.click();
      URL.revokeObjectURL(url);
      setDone(true);
    } catch (err: any) {
      setError(err?.message || "Download failed");
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  }

  const remainingReview = (rows || []).filter((r) => r.needsReview).length;
  const remainingAi = aiRows.length;
  // 검토 화면 "확인 필요" 칸에 보여 줄 항목 수 (취소 확인 + 분류 확인 + AI 확인)
  const needCount = cancelQuestions.length + reviewRows.length + aiRows.length;

  // 최종 검토: 실제로 엑셀에 들어갈 행(취소 선택 반영)을 Expense / Travel 로 나눈다.
  const finalPayload = finalOpen ? finalizeRows() : [];
  const finalExpense = finalPayload.filter((p) => !isTravelCategory(p.category));
  const finalTravel = finalPayload.filter((p) => isTravelCategory(p.category));
  const finalExcluded =
    (rows || []).length - finalPayload.filter((p) => p.id !== undefined).length;
  const finalUnclassified = finalPayload.filter(
    (p) => !VALID_CATEGORIES.has(p.category),
  ).length;
  const sumAmount = (list: Payload[]) =>
    list.reduce((s, p) => s + (p.amount || 0), 0);

  // 영수증 매칭 미리보기: 다운로드 때(attachReceiptsToZip)와 같은 순서·규칙으로 매칭한다.
  const hasReceipts = mode !== "excel" && receiptFiles.length > 0;
  const toMeta = (list: Payload[]): RowMeta[] =>
    list.map((p) => ({
      approval: p.approval || "",
      merchant: p.merchant,
      cancel: p.cancel,
    }));
  const receiptMatch =
    finalOpen && hasReceipts && receiptParsed && receiptParsed.receipts.length > 0
      ? matchReceipts(
          toMeta(finalExpense),
          toMeta(finalTravel),
          receiptParsed.receipts,
        )
      : null;
  const receiptMissing = receiptMatch
    ? receiptMatch.expense.missingRows + receiptMatch.travel.missingRows
    : 0;

  // 행 id → 엑셀 위치(Expense/Travel 몇 번째)와 붙을 영수증 조각
  const placeById = new Map<number, { group: "expense" | "travel"; index: number }>();
  finalExpense.forEach((p, i) => p.id !== undefined && placeById.set(p.id, { group: "expense", index: i }));
  finalTravel.forEach((p, i) => p.id !== undefined && placeById.set(p.id, { group: "travel", index: i }));
  const halvesOf = (id: number): Half[] | null => {
    const at = placeById.get(id);
    return at && receiptMatch ? receiptMatch[at.group].rowHalves[at.index] ?? null : null;
  };

  // 선택한 행에 붙을 영수증 조각들 (미리보기용)
  const previewHalves: Half[] | null = previewId !== null ? halvesOf(previewId) : null;
  const previewHalvesKey = previewHalves ? JSON.stringify(previewHalves) : "";

  // 검토 화면이 열리고 영수증이 있으면 첫 '확인 필요' 행(없으면 첫 행)을 미리보기한다.
  useEffect(() => {
    if (!finalOpen) {
      setPreviewId(null);
      return;
    }
    if (previewId === null && receiptMatch) {
      const first = [...reviewRows, ...aiRows][0]?.id ?? finalExpense[0]?.id ?? finalTravel[0]?.id;
      setPreviewId(first ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalOpen, !!receiptMatch]);

  useEffect(() => {
    const bytes = receiptCache.current?.bytes;
    if (!previewHalves || !bytes) {
      setPreviewImgs(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    (async () => {
      try {
        const { renderReceiptPiece } = await import("@/lib/receiptPreview");
        const imgs: string[] = [];
        for (const h of previewHalves) imgs.push(await renderReceiptPiece(bytes, h));
        if (!cancelled) setPreviewImgs(imgs);
      } catch {
        if (!cancelled) setPreviewImgs(null);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewHalvesKey]);

  // 좁은 화면(휴대폰)에서는 최종 검토를 한 줄로 쌓는다.
  const [narrow, setNarrow] = useState(false);
  const [tiny, setTiny] = useState(false); // 휴대폰 폭: 단계 표시줄은 현재 단계 이름만
  useEffect(() => {
    const onResize = () => {
      setNarrow(window.innerWidth < 860);
      setTiny(window.innerWidth < 520);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 최종 검토 오른쪽(좁은 화면에서는 위쪽)의 영수증 미리보기 칸
  function renderPreviewPanel(compact: boolean) {
    const row = previewId !== null ? finalPayload.find((p) => p.id === previewId) : undefined;
    const at = previewId !== null ? placeById.get(previewId) : undefined;
    return (
      <div style={compact ? previewPanelCompact : previewPanel}>
        <div style={previewHead}>
          {row ? (
            <>
              {at && (
                <b style={{ color: at.group === "travel" ? T.travel : T.expense }}>
                  {at.group === "travel" ? "Travel" : "Expense"} {at.index + 1}
                </b>
              )}{" "}
              · {row.merchant || "(가맹점명 없음)"} · {fmt(row.amount)}원
            </>
          ) : (
            "왼쪽 목록에서 행을 누르면 영수증이 보여요"
          )}
        </div>
        <div style={compact ? previewBodyCompact : previewBody}>
          {row && !previewHalves && (
            <div style={previewEmpty}>이 항목에 맞는 영수증을 찾지 못했어요</div>
          )}
          {previewHalves && previewLoading && !previewImgs && (
            <div style={previewEmpty}>영수증 불러오는 중…</div>
          )}
          {previewHalves && previewImgs && (
            <div style={previewImgs.length > 1 ? previewPair : undefined}>
              {previewImgs.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={src}
                  alt={i === 0 ? "영수증" : "취소 영수증"}
                  style={previewImg}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 검토 팝업에서 같은 가맹점(결제대행사 제외)이 몇 건인지 — "함께 적용" 안내용
  const sameMerchantCount = new Map<string, number>();
  for (const x of [...reviewRows, ...aiRows]) {
    if (x.source === "gateway") continue;
    const k = normalizeMerchant(x.merchant);
    sameMerchantCount.set(k, (sameMerchantCount.get(k) || 0) + 1);
  }

  function renderFinalSection(
    label: string,
    list: Payload[],
    matched?: boolean[],
    group?: "expense" | "travel",
  ) {
    return (
      <div style={finalSection}>
        <div style={finalHeader}>
          <span style={{ color: group === "travel" ? T.travel : T.expense }}>{label}</span>
          <span>
            {fmt(list.length)}건 · <b>{fmt(sumAmount(list))}원</b>
          </span>
        </div>
        {list.length === 0 && <div style={mutedText}>해당 항목 없음</div>}
        {list.map((p, i) => {
          const unclassified = !VALID_CATEGORIES.has(p.category);
          const selected = p.id !== undefined && previewId === p.id;
          const clickable = !!group && !!receiptMatch && p.id !== undefined;
          return (
            <div
              key={p.id !== undefined ? "r" + p.id : "o" + i}
              style={{
                ...(unclassified ? finalRowWarn : finalRow),
                ...(clickable ? { cursor: "pointer" } : null),
                ...(selected ? finalRowSelected : null),
              }}
              onClick={clickable ? () => setPreviewId(p.id as number) : undefined}
            >
              <div style={finalRowTop}>
                <span style={finalIdx}>{i + 1}</span>
                <span style={listDate}>{p.date || "날짜?"}</span>
                <span style={listMerchant}>
                  {p.merchant || "(가맹점명 없음)"}
                  {p.cancel ? " (부분취소 반영)" : ""}
                </span>
                <span style={listAmount}>{fmt(p.amount)}원</span>
              </div>
              {matched && (
                <div style={matched[i] ? receiptOk : receiptMissingText}>
                  {matched[i]
                    ? "🧾 영수증 매칭됨"
                    : "⚠️ 영수증 없음 — 영수증 PDF에서 이 항목은 빠져요"}
                </div>
              )}
              {p.id !== undefined ? (
                <div onClick={(e) => e.stopPropagation()}>
                  <CategoryPicker
                    size="sm"
                    value={p.category}
                    onChange={(v) => setRowCategory(p.id as number, v)}
                  />
                </div>
              ) : (
                <div style={mutedText}>환불(음수) 행 · {p.category}</div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // 검토 팝업의 분류 항목 한 줄(분류 확인 / AI 자동 분류 확인 공용).
  function renderCategoryItem(r: Row) {
    const isGateway = r.source === "gateway";
    const selected = !!receiptMatch && previewId === r.id;
    return (
      <div
        key={r.id}
        style={{
          ...reviewItem,
          ...(receiptMatch ? { cursor: "pointer" } : null),
          ...(selected ? reviewItemSelected : null),
        }}
        onClick={receiptMatch ? () => setPreviewId(r.id) : undefined}
      >
        <div style={reviewInfo}>
          <div style={reviewMerchant}>{r.merchant || "(가맹점명 없음)"}</div>
          <div style={reviewMeta}>
            {r.date ? r.date + " " : ""}
            {r.time ? r.time + " · " : r.date ? "· " : ""}
            {fmt(r.amount)} {r.currency}
            {r.merchantCategory ? " · " + r.merchantCategory : ""}
            {r.isForeign ? " · 해외" : ""}
          </div>
          {r.aiCheck && (
            <div style={aiNote}>
              🤖 AI가 자동 분류했어요
              {r.confidence !== null
                ? ` (확신도 ${Math.round(r.confidence * 100)}%)`
                : ""}
              . 틀렸다면 아래에서 분류를 바꿔 주세요.
            </div>
          )}
          {isGateway && (
            <div style={gatewayNote}>
              🔍 {r.date || ""}
              {r.time ? " " + r.time : ""}에 결제한 내역입니다. 결제대행사(
              {r.merchant})만 표시되어 무엇을 결제했는지 알 수 없으니 직접
              분류해 주세요.
            </div>
          )}
          {!isGateway && r.suspectGateway && (
            <div style={gatewayNote}>
              💡 결제대행사(PG)일 수 있는 이름입니다. 맞다면 아래 '결제대행사'
              체크를 유지하세요.
            </div>
          )}
        </div>
        {r.needsManual && (
          <div style={manualBox}>
            <div style={manualLabel}>
              ✏️ 영수증에서 자동으로 읽지 못한 정보입니다. 직접 입력해 주세요.
            </div>
            <input
              style={manualInput}
              placeholder="가맹점명"
              defaultValue={r.merchant}
              onChange={(e) => setRowField(r.id, "merchant", e.target.value)}
            />
            <input
              style={manualInput}
              type="number"
              placeholder="금액"
              defaultValue={r.amount || ""}
              onChange={(e) => setRowField(r.id, "amount", e.target.value)}
            />
            <input
              style={manualInput}
              placeholder="날짜 (예: 2026.03.27)"
              defaultValue={r.date}
              onChange={(e) => setRowField(r.id, "date", e.target.value)}
            />
            <input
              style={manualInput}
              placeholder="시간 (예: 17:27)"
              defaultValue={r.time}
              onChange={(e) => setRowField(r.id, "time", e.target.value)}
            />
          </div>
        )}
        <CategoryPicker
          value={r.category}
          onChange={(v) => setReviewCategory(r, v)}
        />
        {!isGateway && (sameMerchantCount.get(normalizeMerchant(r.merchant)) || 0) > 1 && (
          <div style={sameHint}>
            같은 가맹점{" "}
            {sameMerchantCount.get(normalizeMerchant(r.merchant))}건 — 분류를 고르면
            함께 바뀌어요
          </div>
        )}
        {isGateway ? (
          <label style={learnRow}>
            <input type="checkbox" checked={false} disabled />
            <span style={learnTextOff}>결제대행 — 학습 불가 (매번 확인)</span>
          </label>
        ) : (
          <>
            <label style={learnRow}>
              <input
                type="checkbox"
                checked={!!gatewayChoice[r.id]}
                onChange={(e) => setGateway(r.id, e.target.checked)}
              />
              <span>
                이 가맹점은 결제대행사입니다 (다음부터 자동 인식·항상 확인)
              </span>
            </label>
            <label style={learnRow}>
              <input
                type="checkbox"
                checked={!gatewayChoice[r.id] && !!learnChoice[r.id]}
                disabled={!!gatewayChoice[r.id]}
                onChange={(e) => setLearn(r.id, e.target.checked)}
              />
              <span style={gatewayChoice[r.id] ? learnTextOff : undefined}>
                이 분류를 모두에게 저장 (다음부터 자동)
              </span>
            </label>
          </>
        )}
      </div>
    );
  }

  // 지금 단계: ① 파일 올리기 → ② 확인 → ③ 최종 검토 → ④ 다운로드
  const currentStep = done ? 3 : rows ? 2 : 1;
  const STEPS = ["파일 올리기", "검토", "다운로드"];

  return (
    <main style={wrap}>
      <div style={tiny ? { ...card, padding: 20 } : card}>
        <header style={headerRow}>
          <h1 style={{ margin: 0 }} aria-label="Expense Tool">
            <Logo />
          </h1>
          <nav style={topNav}>
            <a href="/learned" style={topNavLink}>학습 데이터</a>
            <a href="/stats" style={topNavLink}>통계</a>
            <a href="/guide" style={topNavLink}>사용 설명서</a>
            <a href="/changelog" style={topNavLink}>업데이트</a>
          </nav>
        </header>

        <ol style={stepper}>
          {STEPS.map((label, i) => {
            const n = i + 1;
            const state = n < currentStep ? "done" : n === currentStep ? "now" : "next";
            return (
              <li
                key={label}
                style={{ ...stepItem, ...(tiny && state === "now" ? { flex: "0 0 auto" } : null) }}
              >
                <span
                  style={{
                    ...stepDot,
                    ...(state === "done" ? stepDotDone : state === "now" ? stepDotNow : null),
                  }}
                >
                  {state === "done" ? "✓" : n}
                </span>
                {(!tiny || state === "now") && (
                  <span style={state === "next" ? stepLabelNext : stepLabel}>{label}</span>
                )}
                {n < STEPS.length && (
                  <span style={{ ...stepLine, ...(n < currentStep ? stepLineDone : null) }} />
                )}
              </li>
            );
          })}
        </ol>

        {resume && !rows && !loading && (
          <div style={resumeBox}>
            <div>
              🕘 이전 작업이 있습니다 —{" "}
              {new Date(resume.savedAt).toLocaleString("ko-KR", {
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              · {fmt(resume.rows.length)}건 분류됨
              <br />
              <span style={mutedText}>
                영수증 PDF는 브라우저에 저장되지 않으므로, 영수증을 포함해
                다운로드하려면 같은 PDF를 다시 첨부해 주세요.
              </span>
            </div>
            <div style={resumeBtnRow}>
              <button type="button" style={resumeBtn} onClick={restoreWork}>
                이어하기
              </button>
              <button
                type="button"
                style={resumeGhostBtn}
                onClick={discardWork}
              >
                지우기
              </button>
            </div>
          </div>
        )}

        <div style={modeRow}>
          {(
            [
              ["both", "엑셀 + 영수증"],
              ["pdf", "영수증 PDF만"],
              ["excel", "엑셀만"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              style={mode === m ? modeBtnActive : modeBtn}
              onClick={() => {
                setMode(m);
                resetResults();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <p style={modeHint}>
          {mode === "excel"
            ? "카드 승인내역 엑셀만으로 작성합니다(기존 방식). 영수증 없이 양식만 생성."
            : mode === "pdf"
              ? "영수증 PDF만으로 작성합니다. 영수증의 거래일시·가맹점·금액·승인번호를 자동으로 읽어 분류합니다."
              : "엑셀로 작성하고, 영수증 PDF를 엑셀 순번에 맞추어 함께 정리합니다(기존 방식)."}
        </p>

        {mode !== "pdf" && (
          <>
            <label
              style={dragOver ? dropActive : drop}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".xls,.xlsx,.csv"
                multiple
                onChange={(e) => addExcelFiles(e.target.files)}
                style={hiddenInput}
              />
              <span style={mutedText}>
                카드 승인내역 엑셀을 끌어다 놓거나 클릭해서 선택 (여러 개 가능)
              </span>
            </label>
            {files.length > 0 && (
              <div style={fileList}>
                {files.map((f, i) => (
                  <div key={i} style={fileChip}>
                    <span>📎 {f.name}</span>
                    <button
                      type="button"
                      style={removeBtn}
                      onClick={() => removeExcelFile(i)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {mode !== "excel" && (
          <>
            <label
              style={receiptDragOver ? dropActive : drop}
              onDragOver={(e) => {
                e.preventDefault();
                setReceiptDragOver(true);
              }}
              onDragLeave={() => setReceiptDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setReceiptDragOver(false);
                addReceiptFiles(e.dataTransfer.files);
              }}
            >
              <input
                type="file"
                accept=".pdf"
                multiple
                onChange={(e) => addReceiptFiles(e.target.files)}
                style={hiddenInput}
              />
              <span style={mutedText}>
                {mode === "pdf"
                  ? "영수증 PDF를 끌어다 놓거나 클릭해서 첨부 (여러 개 가능)"
                  : "영수증 PDF를 끌어다 놓거나 클릭해서 첨부 — 엑셀 순번에 맞춰 정리 (여러 개 가능)"}
              </span>
            </label>
            {receiptFiles.length > 0 && (
              <div style={fileList}>
                {receiptFiles.map((f, i) => (
                  <div key={i} style={fileChip}>
                    <span>🧾 {f.name}</span>
                    <button
                      type="button"
                      style={removeBtn}
                      onClick={() => removeReceiptFile(i)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={readModeBox}>
              {useAiReader ? (
                <div style={readerCardAi}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/openai.png" alt="OpenAI" width={22} height={22} style={{ flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={readerTitle}>
                      AI가 영수증을 읽어요
                      {aiInfo?.model && <span style={modelBadge}>{aiInfo.model}</span>}
                    </div>
                    <div style={readerSub}>
                      스캔·인쇄 PDF와 처음 보는 양식도 읽어요. 영수증 그림은 OpenAI로
                      전송되고, 같은 파일을 다시 올리면 저장된 결과를 써요.
                    </div>
                  </div>
                </div>
              ) : (
                <div style={readerCardOcr}>
                  <span style={ocrMark}>OCR</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={readerTitle}>글자 인식(OCR)으로 읽어요</div>
                    <div style={readerSub}>
                      {aiInfo && !aiInfo.available
                        ? "지금은 AI를 쓸 수 없어 OCR로 읽어요 (서버에 AI 키가 없어요)."
                        : "내 컴퓨터 안에서 처리해서 영수증이 밖으로 나가지 않아요. 결과가 이상하면 AI로 바꿔 보세요."}
                    </div>
                  </div>
                </div>
              )}
              <details style={moreBox}>
                <summary style={moreSummary}>더보기</summary>
                <label style={moreOption}>
                  <input
                    type="checkbox"
                    checked={!aiReceipt}
                    onChange={(e) => setReader(!e.target.checked)}
                  />
                  <span>
                    <b>OCR로 인식하기</b> — AI 대신 내 컴퓨터에서 글자 인식으로 읽어요
                    (무료, 영수증이 밖으로 나가지 않음, 대신 가맹점명이 가끔 틀려요)
                  </span>
                </label>
              </details>
            </div>
          </>
        )}

        <button
          type="button"
          onClick={classify}
          disabled={!canClassify || loading}
          style={button(!canClassify || loading)}
        >
          {loading ? "분류 중…" : "분류하기"}
        </button>

        {(loading || downloading) && progress && (
          <div style={progressBox}>⏳ {progress}</div>
        )}

        {error && <div style={errBox}>{error}</div>}

        {stats && (
          <div style={statBox}>
            <div>✅ 총 {fmt(stats.total)}건 분류 완료</div>
            {!!stats.filesProcessed && stats.filesProcessed > 1 && (
              <div style={mutedText}>
                📎 파일 {fmt(stats.filesProcessed)}개에서 원본{" "}
                {fmt(stats.rawCount ?? stats.total)}건 읽음
                {stats.duplicatesRemoved && stats.duplicatesRemoved > 0
                  ? ` · 중복 ${fmt(stats.duplicatesRemoved)}건 제거`
                  : " · 중복 없음"}
              </div>
            )}
            {(!stats.filesProcessed || stats.filesProcessed <= 1) &&
              !!stats.duplicatesRemoved &&
              stats.duplicatesRemoved > 0 && (
                <div style={mutedText}>
                  🧹 중복 {fmt(stats.duplicatesRemoved)}건 자동 제거
                </div>
              )}
            <div>
              💳 총 <b>{fmt(totalUsed)}원</b> 사용 · 결제 {fmt(stats.total)}건
              {stats.voidedAmount > 0
                ? ` (취소·환불 ${fmt(stats.voidedAmount)}원 제외)`
                : ""}
            </div>
            <div>
              🧾 Expense: {fmt(stats.expense)}건 · ✈️ Travel:{" "}
              {fmt(stats.travel)}건
            </div>
            {aiDiag && aiDiag.attempted > 0 && aiDiag.status === "ok" && (
              <div style={mutedText}>
                🤖 AI 분류 {fmt(aiDiag.classified)}/{fmt(aiDiag.attempted)}건
                {aiDiag.model ? ` (${aiDiag.model})` : ""}
              </div>
            )}
            {aiDiag && aiDiag.status === "disabled_no_key" && (
              <div style={warnText}>
                ⚠️ AI 미작동 — 서버에 OPENAI_API_KEY가 설정되지 않았습니다.
              </div>
            )}
            {aiDiag && aiDiag.status === "error" && (
              <div style={warnText}>⚠️ {friendlyAiMessage(aiDiag.message)}</div>
            )}
            {aiDiag && aiDiag.status === "empty_result" && (
              <div style={warnText}>
                ⚠️ AI가 호출됐지만 분류 결과를 반환하지 않았습니다.
              </div>
            )}
            {stats.autoVoided > 0 && (
              <div style={mutedText}>
                ↩️ 취소·환불 {fmt(stats.autoVoided)}건
                {stats.voidedAmount > 0
                  ? ` · ${fmt(stats.voidedAmount)}원`
                  : ""}{" "}
                자동 반영(제외)
              </div>
            )}
            {remainingReview > 0 ||
            remainingAi > 0 ||
            cancelQuestions.length > 0 ? (
              <div style={warnText}>
                ⚠️ 확인 필요
                {cancelQuestions.length > 0
                  ? ` · 취소확인 ${fmt(cancelQuestions.length)}건`
                  : ""}
                {remainingReview > 0
                  ? ` · 분류확인 ${fmt(remainingReview)}건`
                  : ""}
                {remainingAi > 0 ? ` · AI확인 ${fmt(remainingAi)}건` : ""}
                <button
                  type="button"
                  style={linkBtn}
                  onClick={() => setFinalOpen(true)}
                >
                  검토하기
                </button>
              </div>
            ) : (
              <div style={okText}>✅ 모든 항목 확인 완료</div>
            )}
          </div>
        )}

        {rows && rows.length > 0 && (
          <details style={listDetails}>
            <summary style={listSummary}>
              📋 전체 내역 보기 ({fmt(rows.length)}건) · 날짜·시간·가맹점·금액
            </summary>
            <div style={listWrap}>
              {rows.map((r) => (
                <div key={r.id} style={listRow}>
                  <span style={listDate}>
                    {r.date || "날짜?"}
                    {r.time ? " " + r.time : ""}
                  </span>
                  <span style={listMerchant}>
                    {r.merchant || "(가맹점명 없음)"}
                  </span>
                  <span style={listAmount}>
                    {fmt(r.amount)} {r.currency}
                  </span>
                  <span style={listCat}>{r.category}</span>
                </div>
              ))}
            </div>
          </details>
        )}

        {rows && (
          <button
            type="button"
            onClick={() => setFinalOpen(true)}
            disabled={downloading}
            style={button(downloading)}
          >
            {downloading ? "생성 중…" : "검토 후 다운로드"}
          </button>
        )}

        {done && (
          <div style={doneBox}>
            다운로드가 완료됐어요. 제출 전에 Expense·Travel 양식을 한 번씩 확인해 주세요.
          </div>
        )}

        <footer style={footer}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wechat.png" alt="WeChat" width={18} height={18} style={wechatIcon} />
          <span>
            버그·오류 제보 · {BUG_REPORT_NAME} · WeChat{" "}
            <span style={bugId}>{BUG_REPORT_WECHAT}</span>
          </span>
          <button
            type="button"
            style={wechatCopied ? bugCopyBtnDone : bugCopyBtn}
            onClick={copyWechatId}
          >
            {wechatCopied ? "복사됨 ✓" : "ID 복사"}
          </button>
          <span
            style={versionInline}
            onDoubleClick={() => (window.location.href = "/admin")}
            title=""
          >
            v{APP_VERSION}
          </span>
          <span style={privacyNote}>
            이용 기록(이름·IP·처리 내역)은 관리 목적으로 저장돼요.
          </span>
        </footer>
      </div>

      {finalOpen && rows && (
        <div style={overlay} onClick={() => setFinalOpen(false)}>
          <div
            style={{
              ...modal,
              maxWidth: receiptMatch && !narrow ? 1080 : 640,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={modalStep}>2단계</div>
            <h2 style={modalTitle}>검토</h2>
            <p style={modalSub}>
              확인 필요 항목을 정리하고 전체 목록을 확인해 주세요. 아래 내용 그대로 엑셀이 만들어져요.
              {receiptMatch ? " 행을 누르면 붙을 영수증이 보여요." : ""}
            </p>

            <div
              style={
                receiptMatch && !narrow
                  ? finalBodyTwoCol
                  : { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }
              }
            >
            {receiptMatch && narrow && renderPreviewPanel(true)}
            <div style={reviewList}>
              <div style={finalSummary}>
                <div>
                  🧾 Expense {fmt(finalExpense.length)}건 ·{" "}
                  {fmt(sumAmount(finalExpense))}원
                </div>
                <div>
                  ✈️ Travel {fmt(finalTravel.length)}건 ·{" "}
                  {fmt(sumAmount(finalTravel))}원
                </div>
                <div>
                  💳 합계 <b>{fmt(sumAmount(finalPayload))}원</b>
                  {finalExcluded > 0
                    ? ` · 취소·환불로 제외 ${fmt(finalExcluded)}건`
                    : ""}
                </div>
                {hasReceipts && receiptLoading && (
                  <div style={mutedText}>
                    🧾 {progress || "영수증 PDF 분석 중… 잠시만요"}
                  </div>
                )}
                {hasReceipts && receiptMatch && (
                  <div>
                    🧾 영수증 매칭 · Expense{" "}
                    {fmt(receiptMatch.expense.matchedRows)}/
                    {fmt(finalExpense.length)} · Travel{" "}
                    {fmt(receiptMatch.travel.matchedRows)}/
                    {fmt(finalTravel.length)}
                    {receiptMissing === 0 ? " ✅" : ""}
                  </div>
                )}
              </div>
              {hasReceipts && receiptErr && (
                <div style={finalWarnBox}>
                  ⚠️ 영수증 분석 실패 — {receiptErr}
                </div>
              )}
              {hasReceipts &&
                receiptParsed &&
                receiptParsed.receipts.length === 0 && (
                  <div style={finalWarnBox}>
                    ⚠️ 영수증 PDF에서 영수증을 인식하지 못했어요. 이대로
                    다운로드하면 영수증 PDF는 만들어지지 않아요.
                  </div>
                )}
              {receiptMatch && receiptMissing > 0 && (
                <div style={finalWarnBox}>
                  ⚠️ 영수증을 찾지 못한 항목 {fmt(receiptMissing)}건 — 아래
                  &apos;영수증 없음&apos; 표시를 확인하고, 빠진 영수증을 추가로
                  첨부해 주세요.
                </div>
              )}
              {receiptMatch && receiptMatch.leftover.length > 0 && (
                <details style={leftoverBox}>
                  <summary style={leftoverSummary}>
                    🧾 어느 항목에도 맞지 않은 영수증{" "}
                    {fmt(receiptMatch.leftover.length)}장 (영수증 PDF에서
                    빠져요)
                  </summary>
                  {receiptMatch.leftover.map((lo, i) => (
                    <div key={i} style={leftoverRow}>
                      {lo.page + 1}페이지 · {lo.merchant || "(가맹점명 없음)"}
                      {lo.amount ? ` · ${fmt(lo.amount)}원` : ""}
                      {lo.date ? ` · ${lo.date}` : ""}
                      {lo.canceled ? " · 취소 영수증" : ""}
                    </div>
                  ))}
                </details>
              )}
              {finalUnclassified > 0 && (
                <div style={finalWarnBox}>
                  ⚠️ 미분류 {fmt(finalUnclassified)}건 — 이대로 다운로드하면
                  Expense 파일에 UNCLASSIFIED로 들어가요. 빨간 항목의 분류를
                  골라 주세요.
                </div>
              )}
              {needCount > 0 && (
                <div style={needBox}>
                  <div style={needHead}>
                    <span>확인 필요 {fmt(needCount)}건</span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: T.textMuted }}>
                      고른 분류는 다운로드할 때 저장돼요
                    </span>
                  </div>
              {cancelQuestions.length > 0 && (
                <div style={sectionLabel}>↩️ 취소·환불 확인</div>
              )}
              {cancelQuestions.map((q) =>
                q.kind === "heuristic" ? (
                  <div key={"c" + q.id} style={reviewItem}>
                    <div style={reviewInfo}>
                      <div style={reviewMerchant}>
                        {q.merchant || "(가맹점명 없음)"}
                      </div>
                      <div style={reviewMeta}>
                        결제 {fmt(q.paymentAmount || 0)}원
                        {q.paymentDate ? " (" + q.paymentDate + ")" : ""} · 취소{" "}
                        {fmt(q.cancelAmount)}원
                        {q.cancelDate ? " (" + q.cancelDate + ")" : ""}
                      </div>
                      <div style={reviewQuestion}>
                        승인번호가 달라 추정한 매칭입니다. 같은 가맹점·같은
                        금액의 취소로 보이는데, 이 결제의 취소가 맞나요?
                      </div>
                    </div>
                    <select
                      style={select}
                      value={cancelChoice[q.id] || "full"}
                      onChange={(e) =>
                        setCancel(q.id, e.target.value as CancelChoice)
                      }
                    >
                      <option value="full">전액취소가 맞음 — 제외</option>
                      <option value="separate">
                        별개 건임 — 결제 {fmt(q.paymentAmount || 0)}원 그대로
                      </option>
                    </select>
                  </div>
                ) : (
                  <div key={"c" + q.id} style={reviewItem}>
                    <div style={reviewInfo}>
                      <div style={reviewMerchant}>
                        {q.merchant || "(가맹점명 없음)"}
                      </div>
                      <div style={reviewMeta}>
                        환불·취소 {fmt(q.cancelAmount)}원
                        {q.cancelDate ? " (" + q.cancelDate + ")" : ""}
                      </div>
                      <div style={reviewQuestion}>
                        원결제가 이번 명세서에 없는 환불입니다. 어떻게 할까요?
                      </div>
                    </div>
                    <select
                      style={select}
                      value={cancelChoice[q.id] || "exclude"}
                      onChange={(e) =>
                        setCancel(q.id, e.target.value as CancelChoice)
                      }
                    >
                      <option value="exclude">제외 (청구하지 않음)</option>
                      <option value="include">
                        음수로 포함 (−{fmt(q.cancelAmount)}원)
                      </option>
                    </select>
                  </div>
                ),
              )}

              {reviewRows.length > 0 && (
                <div style={sectionRow}>
                  <div style={sectionLabel}>🏷️ 분류 확인</div>
                  <div style={sectionTools}>
                    학습
                    <button
                      type="button"
                      style={miniBtn}
                      onClick={() => setAllLearn(reviewRows, true)}
                    >
                      모두
                    </button>
                    <button
                      type="button"
                      style={miniBtn}
                      onClick={() => setAllLearn(reviewRows, false)}
                    >
                      해제
                    </button>
                  </div>
                </div>
              )}
              {reviewRows.map((r) => renderCategoryItem(r))}

              {aiRows.length > 0 && (
                <div style={sectionRow}>
                  <div style={sectionLabel}>
                    🤖 AI 자동 분류 확인 ({fmt(aiRows.length)}건)
                  </div>
                  <div style={sectionTools}>
                    학습
                    <button
                      type="button"
                      style={miniBtn}
                      onClick={() => setAllLearn(aiRows, true)}
                    >
                      모두
                    </button>
                    <button
                      type="button"
                      style={miniBtn}
                      onClick={() => setAllLearn(aiRows, false)}
                    >
                      해제
                    </button>
                  </div>
                </div>
              )}
              {aiRows.length > 0 && (
                <div style={aiSectionHint}>
                  AI가 확신을 갖고 분류한 항목이에요. 맞으면 그대로 두고, 틀린
                  항목만 분류를 바꿔 주세요. 체크된 항목은 저장되어 다음부터 AI
                  없이 바로 분류돼요.
                </div>
              )}
              {aiRows.map((r) => renderCategoryItem(r))}
                </div>
              )}
              {renderFinalSection(
                "Expense",
                finalExpense,
                receiptMatch?.expense.rowMatched,
                "expense",
              )}
              {renderFinalSection(
                "Travel",
                finalTravel,
                receiptMatch?.travel.rowMatched,
                "travel",
              )}
            </div>
            {receiptMatch && !narrow && renderPreviewPanel(false)}
            </div>

            <div style={{ ...modalActions, flexWrap: "wrap", alignItems: "center" }}>
              <label style={nameInline}>
                이름
                <input
                  style={nameInputInline}
                  placeholder="이용 기록에 남을 이름"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                />
              </label>
              <button
                type="button"
                style={ghostBtn}
                onClick={() => setFinalOpen(false)}
              >
                닫기
              </button>
              <button
                type="button"
                style={downloading || receiptLoading ? primaryBtnDisabled : primaryBtn}
                disabled={downloading || receiptLoading}
                onClick={async () => {
                  const by = ensureUserName(); // 이용 기록에 남을 이름 (비어 있으면 한 번 물어봄)
                  await saveLearning(by); // 체크된 분류를 모두에게 저장
                  setFinalOpen(false);
                  download(by);
                }}
              >
                {mode !== "excel" && receiptFiles.length > 0
                  ? "확인 완료 · 다운로드 (엑셀 2 + 영수증 PDF 2)"
                  : "확인 완료 · 엑셀 다운로드"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

const wrap: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
};
const card: CSSProperties = {
  width: "100%",
  maxWidth: 620,
  background: T.surface,
  borderRadius: 16,
  padding: 32,
  boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
};
const title: CSSProperties = { fontSize: 22, margin: 0, letterSpacing: -0.2 };
const subtitle: CSSProperties = {
  fontSize: 14,
  color: T.textMuted,
  lineHeight: 1.6,
  marginBottom: 24,
};
const navRow: CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  marginBottom: 20,
};
const navBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 14px",
  fontSize: 13.5,
  color: T.primary,
  background: T.primaryBg,
  border: `1px solid ${T.primaryBorder}`,
  borderRadius: 8,
  textDecoration: "none",
  fontWeight: 600,
};
const drop: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: `2px dashed ${T.borderStrong}`,
  borderRadius: 12,
  padding: "36px 16px",
  cursor: "pointer",
  marginBottom: 16,
  fontSize: 14,
  textAlign: "center",
  transition: "all 0.15s",
};
const dropActive: CSSProperties = {
  ...drop,
  border: `2px dashed ${T.primary}`,
  background: T.primaryBg,
};
function button(disabled: boolean): CSSProperties {
  return {
    width: "100%",
    padding: "12px 16px",
    borderRadius: 10,
    border: "none",
    background: disabled ? T.borderStrong : T.primary,
    color: T.surface,
    fontSize: 15,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    marginBottom: 12,
  };
}
const nameRow: CSSProperties = { marginBottom: 12 };
const nameLabel: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 12,
  fontWeight: 600,
  color: T.textMuted,
};
const nameInput: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  fontSize: 13,
  fontWeight: 400,
};
const errBox: CSSProperties = {
  marginTop: 4,
  marginBottom: 12,
  padding: 12,
  borderRadius: 8,
  background: T.dangerBg,
  color: T.danger,
  fontSize: 13,
};
const progressBox: CSSProperties = {
  marginTop: 4,
  marginBottom: 12,
  padding: "10px 12px",
  borderRadius: 8,
  background: T.primaryBg,
  color: T.primary,
  fontSize: 13,
};
const resumeBox: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 16,
  padding: "12px 14px",
  borderRadius: 8,
  background: T.warningBg,
  border: `1px solid ${T.warningBorder}`,
  fontSize: 13.5,
};
const resumeBtnRow: CSSProperties = { display: "flex", gap: 8 };
const resumeBtn: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "none",
  background: T.primary,
  color: T.surface,
  fontWeight: 600,
  fontSize: 13.5,
  cursor: "pointer",
};
const resumeGhostBtn: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.surface,
  color: T.textMuted,
  fontWeight: 600,
  fontSize: 13.5,
  cursor: "pointer",
};
const navBtnGhost: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "8px 10px",
  fontSize: 13,
  color: T.textMuted,
  textDecoration: "none",
  fontWeight: 600,
};
const footerNav: CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  justifyContent: "center",
  marginTop: 28,
};
const bugBox: CSSProperties = {
  marginTop: 20,
  padding: "10px 14px",
  borderRadius: 8,
  background: T.surfaceAlt,
  border: `1px solid ${T.divider}`,
  fontSize: 13,
  color: T.textSub,
};
const bugTitle: CSSProperties = {
  fontWeight: 600,
  marginBottom: 6,
};
const bugRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  flexWrap: "wrap",
};
const bugId: CSSProperties = {
  fontFamily: "monospace",
  color: T.text,
};
const bugCopyBtn: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: `1px solid ${T.primaryBorder}`,
  background: T.primaryBg,
  color: T.primary,
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const bugCopyBtnDone: CSSProperties = {
  ...bugCopyBtn,
  border: `1px solid ${T.successBorder}`,
  background: T.successBg,
  color: T.success,
};
const versionText: CSSProperties = {
  marginTop: 12,
  marginBottom: 0,
  textAlign: "center",
  fontSize: 12,
  color: T.textFaint,
};
const statBox: CSSProperties = {
  marginBottom: 12,
  padding: 14,
  borderRadius: 8,
  background: T.surfaceAlt,
  fontSize: 13,
  lineHeight: 1.9,
};
const doneBox: CSSProperties = {
  marginTop: 4,
  marginBottom: 12,
  padding: 14,
  borderRadius: 8,
  background: T.successBg,
  color: T.success,
  fontSize: 13,
  lineHeight: 1.6,
  border: `1px solid ${T.successBorder}`,
};
const hint: CSSProperties = {
  marginTop: 8,
  fontSize: 12,
  color: T.textFaint,
  lineHeight: 1.6,
};
const hiddenInput: CSSProperties = { display: "none" };
const mutedText: CSSProperties = { color: T.textFaint };
const warnText: CSSProperties = { color: T.warning };
const okText: CSSProperties = { color: T.success };
const linkBtn: CSSProperties = {
  border: "none",
  background: "none",
  color: T.primary,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
  textDecoration: "underline",
  padding: "0 4px",
};

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 50,
};
const modal: CSSProperties = {
  width: "100%",
  maxWidth: 640,
  maxHeight: "85vh",
  display: "flex",
  flexDirection: "column",
  background: T.surface,
  borderRadius: 16,
  padding: 24,
  boxShadow: "0 12px 48px rgba(0,0,0,0.25)",
};
const modalTitle: CSSProperties = { fontSize: 18, margin: "0 0 6px" };
const modalSub: CSSProperties = {
  fontSize: 13,
  color: T.textMuted,
  marginBottom: 16,
};
const reviewList: CSSProperties = {
  overflowY: "auto",
  flex: 1,
  marginBottom: 16,
};
const sectionLabel: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: T.text,
  margin: "12px 0 4px",
};
const sectionRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  margin: "16px 0 4px",
};
const sectionTools: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
  color: T.textFaint,
};
const miniBtn: CSSProperties = {
  border: `1px solid ${T.borderStrong}`,
  background: T.surface,
  borderRadius: 6,
  fontSize: 12,
  padding: "2px 8px",
  cursor: "pointer",
  color: T.textMuted,
};
const reviewItem: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: "12px 0",
  borderBottom: `1px solid ${T.divider}`,
};
const reviewInfo: CSSProperties = { display: "flex", flexDirection: "column" };
const reviewMerchant: CSSProperties = { fontSize: 14, fontWeight: 600 };
const reviewMeta: CSSProperties = {
  fontSize: 12,
  color: T.textFaint,
  marginTop: 2,
};
const reviewQuestion: CSSProperties = {
  fontSize: 13,
  color: T.text,
  marginTop: 4,
};
const gatewayNote: CSSProperties = {
  fontSize: 12,
  color: T.warning,
  marginTop: 4,
  lineHeight: 1.5,
};
const aiNote: CSSProperties = {
  fontSize: 12,
  color: T.primary,
  marginTop: 4,
  lineHeight: 1.5,
};
const aiSectionHint: CSSProperties = {
  fontSize: 12,
  color: T.textMuted,
  lineHeight: 1.5,
  marginBottom: 4,
};
const finalSummary: CSSProperties = {
  padding: 12,
  borderRadius: 8,
  background: T.surfaceAlt,
  fontSize: 13,
  lineHeight: 1.8,
  marginBottom: 8,
};
const finalWarnBox: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  background: T.dangerBg,
  color: T.danger,
  fontSize: 12.5,
  lineHeight: 1.5,
  marginBottom: 8,
};
const finalSection: CSSProperties = { marginTop: 12 };
const receiptOk: CSSProperties = { fontSize: 11.5, color: T.success };
const receiptMissingText: CSSProperties = {
  fontSize: 11.5,
  color: T.danger,
  fontWeight: 600,
};
const leftoverBox: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  background: T.warningBg,
  border: `1px solid ${T.warningBorder}`,
  fontSize: 12.5,
  marginBottom: 8,
};
const leftoverSummary: CSSProperties = {
  cursor: "pointer",
  fontWeight: 600,
  color: T.warningText,
};
const leftoverRow: CSSProperties = {
  padding: "4px 0",
  borderTop: `1px solid ${T.warningBorder}`,
  color: T.warningText,
};
const finalHeader: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 13.5,
  fontWeight: 700,
  color: T.text,
  padding: "6px 0",
  borderBottom: `2px solid ${T.divider}`,
};
const finalRow: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "8px 0",
  borderBottom: `1px solid ${T.divider}`,
};
const finalRowWarn: CSSProperties = {
  ...finalRow,
  background: T.dangerBgSoft,
  borderLeft: `3px solid ${T.dangerStrong}`,
  paddingLeft: 6,
};
const finalRowTop: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "baseline",
  fontSize: 12.5,
};
const finalIdx: CSSProperties = {
  color: T.textFaint,
  minWidth: 18,
  fontVariantNumeric: "tabular-nums",
};
const finalSelect: CSSProperties = {
  width: "100%",
  padding: "5px 8px",
  borderRadius: 6,
  border: `1px solid ${T.border}`,
  fontSize: 12,
};
const select: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: `1px solid ${T.borderStrong}`,
  fontSize: 13,
};
const learnRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12,
  color: T.text,
  cursor: "pointer",
};
const learnTextOff: CSSProperties = { color: T.warning };
const modalActions: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
};
const ghostBtn: CSSProperties = {
  padding: "10px 18px",
  whiteSpace: "nowrap",
  flexShrink: 0,
  borderRadius: 10,
  border: `1px solid ${T.borderStrong}`,
  background: T.surface,
  color: T.textMuted,
  fontSize: 14,
  cursor: "pointer",
};
const primaryBtn: CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "none",
  background: T.primary,
  color: T.surface,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const headerRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  rowGap: 10,
  paddingBottom: 16,
  marginBottom: 18,
  borderBottom: `1px solid ${T.divider}`,
};
const topNav: CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap" };
const topNavLink: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  color: T.textMuted,
  textDecoration: "none",
  padding: "6px 11px",
  borderRadius: 999,
  border: `1px solid ${T.divider}`,
  background: T.surface,
};
const stepper: CSSProperties = {
  display: "flex",
  listStyle: "none",
  padding: "12px 14px",
  margin: "0 0 22px",
  gap: 0,
  background: T.surfaceAlt,
  borderRadius: T.radius,
};
const stepItem: CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  gap: 6,
  minWidth: 0,
};
const stepDot: CSSProperties = {
  flexShrink: 0,
  width: 22,
  height: 22,
  borderRadius: "50%",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 11.5,
  fontWeight: 700,
  background: T.divider,
  color: T.textFaint,
};
const stepDotNow: CSSProperties = { background: T.primary, color: T.surface };
const stepDotDone: CSSProperties = { background: T.success, color: T.surface };
const stepLabel: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  color: T.text,
  whiteSpace: "nowrap",
};
const stepLabelNext: CSSProperties = { ...stepLabel, color: T.textFaint, fontWeight: 500 };
const stepLine: CSSProperties = {
  flex: 1,
  height: 2,
  minWidth: 8,
  margin: "0 6px",
  background: T.divider,
  borderRadius: 1,
};
const stepLineDone: CSSProperties = { background: T.success };
const footer: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  marginTop: 24,
  paddingTop: 14,
  borderTop: `1px solid ${T.divider}`,
  fontSize: 12,
  color: T.textFaint,
};
const wechatIcon: CSSProperties = { borderRadius: 4, flexShrink: 0 };
const versionInline: CSSProperties = {
  marginLeft: "auto",
  color: T.textFaint,
  userSelect: "none",
};
const privacyNote: CSSProperties = { width: "100%", fontSize: 11, color: T.textFaint };
const readModeBox: CSSProperties = { margin: "10px 0 14px" };
const readerCardBase: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  padding: "10px 12px",
  borderRadius: T.radius,
  border: "1px solid",
};
const readerCardAi: CSSProperties = { ...readerCardBase, borderColor: T.aiBorder, background: T.aiBg };
const readerCardOcr: CSSProperties = { ...readerCardBase, borderColor: T.ocrBorder, background: T.ocrBg };
const readerTitle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 6,
  fontSize: 13.5,
  fontWeight: 700,
  color: T.text,
};
const readerSub: CSSProperties = { fontSize: 12, color: T.textMuted, lineHeight: 1.5, marginTop: 2 };
const modelBadge: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: T.ai,
  background: T.surface,
  border: `1px solid ${T.aiBorder}`,
  borderRadius: 999,
  padding: "1px 8px",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};
const ocrMark: CSSProperties = {
  flexShrink: 0,
  fontSize: 10.5,
  fontWeight: 800,
  color: T.surface,
  background: T.ocr,
  borderRadius: 6,
  padding: "4px 5px",
  letterSpacing: 0.5,
};
const moreBox: CSSProperties = { marginTop: 6 };
const moreSummary: CSSProperties = {
  cursor: "pointer",
  fontSize: 12,
  color: T.textFaint,
  fontWeight: 600,
  padding: "2px 0",
};
const moreOption: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  marginTop: 6,
  padding: "8px 10px",
  borderRadius: T.radiusSm,
  background: T.surfaceAlt,
  fontSize: 12.5,
  color: T.textSub,
  lineHeight: 1.5,
  cursor: "pointer",
};
const readModeLabel: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: T.textMuted,
  marginBottom: 6,
};
const readModeSeg: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 6,
};
const segBase: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 2,
  padding: "9px 12px",
  borderRadius: T.radiusSm,
  fontSize: 13.5,
  fontWeight: 700,
  cursor: "pointer",
  textAlign: "left",
};
const segOff: CSSProperties = {
  ...segBase,
  border: `1px solid ${T.border}`,
  background: T.surface,
  color: T.textMuted,
};
const segOcrOn: CSSProperties = {
  ...segBase,
  border: `2px solid ${T.ocr}`,
  background: T.ocrBg,
  color: T.ocr,
};
const segAiOn: CSSProperties = {
  ...segBase,
  border: `2px solid ${T.ai}`,
  background: T.aiBg,
  color: T.ai,
};
const segSub: CSSProperties = { fontSize: 11.5, fontWeight: 500, opacity: 0.85 };
const readModeHintBase: CSSProperties = {
  marginTop: 6,
  padding: "7px 10px",
  borderRadius: T.radiusSm,
  fontSize: 12,
  lineHeight: 1.5,
};
const readModeHintOcr: CSSProperties = {
  ...readModeHintBase,
  background: T.ocrBg,
  color: T.ocr,
  border: `1px solid ${T.ocrBorder}`,
};
const readModeHintAi: CSSProperties = {
  ...readModeHintBase,
  background: T.aiBg,
  color: T.ai,
  border: `1px solid ${T.aiBorder}`,
};
const nameInline: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginRight: "auto",
  fontSize: 12.5,
  fontWeight: 600,
  color: T.textMuted,
};
const nameInputInline: CSSProperties = {
  padding: "8px 10px",
  borderRadius: T.radiusSm,
  border: `1px solid ${T.border}`,
  fontSize: 13,
  width: 190,
};
const reviewItemSelected: CSSProperties = {
  background: T.primaryBg,
  boxShadow: `inset 3px 0 0 ${T.primary}`,
  paddingLeft: 10,
  paddingRight: 6,
  borderRadius: 6,
};
const needBox: CSSProperties = {
  border: `1px solid ${T.warningBorder}`,
  background: T.surface,
  borderRadius: T.radius,
  padding: "4px 12px 8px",
  marginBottom: 12,
};
const needHead: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "8px 0 4px",
  fontSize: 14,
  fontWeight: 700,
  color: T.warningText,
};
const modalStep: CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  color: T.primary,
  marginBottom: 2,
};
const sameHint: CSSProperties = {
  fontSize: 12,
  color: T.primary,
  background: T.primaryBg,
  borderRadius: 6,
  padding: "3px 8px",
  alignSelf: "flex-start",
};
const finalRowSelected: CSSProperties = {
  background: T.primaryBg,
  boxShadow: `inset 3px 0 0 ${T.primary}`,
  paddingLeft: 8,
};
const finalBodyTwoCol: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 0.85fr)",
  gap: 16,
  flex: 1,
  minHeight: 0,
};
const previewPanel: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  marginBottom: 16,
  border: `1px solid ${T.divider}`,
  borderRadius: T.radius,
  background: T.surfaceAlt,
  overflow: "hidden",
};
const previewPanelCompact: CSSProperties = {
  ...previewPanel,
  marginBottom: 10,
  flexShrink: 0,
};
const previewHead: CSSProperties = {
  padding: "8px 12px",
  fontSize: 12.5,
  color: T.textSub,
  borderBottom: `1px solid ${T.divider}`,
  background: T.surface,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const previewBody: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  padding: 12,
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
};
const previewBodyCompact: CSSProperties = {
  ...previewBody,
  maxHeight: 220,
};
const previewEmpty: CSSProperties = {
  margin: "auto",
  fontSize: 12.5,
  color: T.textFaint,
  textAlign: "center",
  padding: 20,
};
const previewPair: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 8,
  width: "100%",
};
const previewImg: CSSProperties = {
  display: "block",
  width: "100%",
  height: "auto",
  background: T.surface,
  borderRadius: 6,
  boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
};
const aiToggleRow: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  margin: "10px 0 14px",
  padding: "10px 12px",
  borderRadius: 8,
  background: T.surfaceAlt,
  border: `1px solid ${T.divider}`,
  fontSize: 13,
  color: T.textSub,
  cursor: "pointer",
  lineHeight: 1.5,
};
const aiToggleBadge: CSSProperties = {
  fontSize: 11.5,
  color: T.textMuted,
  background: T.divider,
  borderRadius: 6,
  padding: "1px 6px",
};
const aiToggleHint: CSSProperties = { fontSize: 12, color: T.textFaint };
const primaryBtnDisabled: CSSProperties = {
  ...primaryBtn,
  background: T.borderStrong,
  cursor: "not-allowed",
};

const modeRow: CSSProperties = {
  display: "flex",
  gap: 8,
  marginBottom: 8,
  flexWrap: "wrap",
};
const modeBtn: CSSProperties = {
  flex: "1 1 0",
  minWidth: 120,
  padding: "10px 12px",
  borderRadius: 10,
  border: `1px solid ${T.border}`,
  background: T.surface,
  color: T.textSub,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const modeBtnActive: CSSProperties = {
  ...modeBtn,
  border: `1px solid ${T.primary}`,
  background: T.primaryBg,
  color: T.primary,
};
const modeHint: CSSProperties = {
  margin: "0 0 12px",
  fontSize: 12.5,
  color: T.textFaint,
  lineHeight: 1.5,
};
const fileList: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  marginTop: 8,
};
const fileChip: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "8px 10px",
  borderRadius: 8,
  background: T.surfaceAlt,
  fontSize: 13,
  color: T.textSub,
};
const removeBtn: CSSProperties = {
  border: "none",
  background: "transparent",
  color: T.textFaint,
  fontSize: 15,
  lineHeight: 1,
  cursor: "pointer",
  padding: 2,
};
const manualBox: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: "8px 10px",
  marginTop: 6,
  borderRadius: 8,
  background: T.warningBg,
  border: `1px solid ${T.warningBorder}`,
};
const manualLabel: CSSProperties = {
  fontSize: 12,
  color: T.warning,
  fontWeight: 600,
};
const manualInput: CSSProperties = {
  padding: "7px 9px",
  borderRadius: 7,
  border: `1px solid ${T.border}`,
  fontSize: 13,
};
const listDetails: CSSProperties = {
  border: `1px solid ${T.divider}`,
  borderRadius: 10,
  background: T.surface,
  padding: "4px 8px",
};
const listSummary: CSSProperties = {
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
  color: T.text,
  padding: "6px 2px",
};
const listWrap: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  marginTop: 4,
  maxHeight: 280,
  overflowY: "auto",
};
const listRow: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "baseline",
  fontSize: 12.5,
  padding: "4px 2px",
  borderTop: `1px solid ${T.divider}`,
};
const listDate: CSSProperties = {
  color: T.textFaint,
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
  minWidth: 116,
};
const listMerchant: CSSProperties = {
  flex: 1,
  color: T.text,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const listAmount: CSSProperties = {
  color: T.text,
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
};
const listCat: CSSProperties = {
  color: T.textFaint,
  whiteSpace: "nowrap",
  maxWidth: 120,
  overflow: "hidden",
  textOverflow: "ellipsis",
};
