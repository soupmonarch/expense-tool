"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

interface MonthStats {
  month: string;
  batches: number;
  rows: number;
  amount: number;
  byCategory: Record<string, { n: number; amount: number }>;
  bySource: Record<string, number>;
}

interface HistoryItem {
  key: string;
  by: string;
  at: string;
  source?: string;
}

const SOURCE_LABELS: [string, string][] = [
  ["learned", "학습 데이터"],
  ["rule", "규칙 (업종·키워드)"],
  ["ai", "AI"],
  ["manual", "직접 분류"],
];

const MAX_CATEGORY_ROWS = 8;

function fmt(n: number): string {
  return Math.round(n || 0).toLocaleString("ko-KR");
}

// "KR-Business Entertainment Expenses" -> "Business Entertainment Expenses"
function shortCat(c: string): string {
  return c.replace(/^KR-/, "");
}

// ISO -> 한국 시각 기준 YYYY-MM
function monthOf(iso: string): string {
  const t = Date.parse(iso);
  if (isNaN(t)) return "";
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 7);
}

function monthLabel(m: string): string {
  const [y, mm] = m.split("-");
  return y && mm ? `${y}년 ${Number(mm)}월` : m;
}

// 한 줄짜리 가로 막대: 이름 · 막대 · 값. 막대에 마우스를 올리면 자세한 값이 보인다.
function BarRow(props: {
  label: string;
  value: number;
  max: number;
  valueText: string;
  tooltip: string;
  highlight?: boolean;
}) {
  const pct = props.max > 0 ? Math.max(0, (props.value / props.max) * 100) : 0;
  return (
    <div style={barRow} title={props.tooltip}>
      <span style={props.highlight ? barLabelStrong : barLabel}>
        {props.label}
      </span>
      <span style={barTrack}>
        <span
          style={{
            ...barFill,
            width: `${pct}%`,
            opacity: props.highlight === false ? 0.45 : 1,
          }}
        />
      </span>
      <span style={barValue}>{props.valueText}</span>
    </div>
  );
}

export default function StatsPage() {
  const [months, setMonths] = useState<MonthStats[]>([]);
  const [learnedCount, setLearnedCount] = useState(0);
  const [gatewayCount, setGatewayCount] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [persistent, setPersistent] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState(""); // "" = 전체 기간, 아니면 YYYY-MM

  useEffect(() => {
    (async () => {
      try {
        const [sRes, lRes] = await Promise.all([
          fetch("/api/stats", { cache: "no-store" }),
          fetch("/api/learn", { cache: "no-store" }),
        ]);
        const s = await sRes.json();
        const l = await lRes.json();
        if (!sRes.ok) throw new Error(s?.error || "통계 불러오기 실패");
        setMonths(s.months || []);
        setPersistent(!!s.persistent);
        if (lRes.ok) {
          setLearnedCount(l.count || 0);
          setGatewayCount(l.gatewayCount || 0);
          setHistory(l.history || []);
        }
      } catch (e: any) {
        setError(e?.message || "통계 불러오기 실패");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 선택한 기간의 합계
  const sel = useMemo(() => {
    const list = period ? months.filter((m) => m.month === period) : months;
    const byCategory: Record<string, { n: number; amount: number }> = {};
    const bySource: Record<string, number> = {};
    let batches = 0;
    let rows = 0;
    let amount = 0;
    for (const m of list) {
      batches += m.batches;
      rows += m.rows;
      amount += m.amount;
      for (const [c, v] of Object.entries(m.byCategory)) {
        const t = (byCategory[c] = byCategory[c] || { n: 0, amount: 0 });
        t.n += v.n;
        t.amount += v.amount;
      }
      for (const [s, n] of Object.entries(m.bySource)) {
        bySource[s] = (bySource[s] || 0) + n;
      }
    }
    return { batches, rows, amount, byCategory, bySource };
  }, [months, period]);

  // 분류별 금액: 큰 순서 상위 N개 + 나머지는 '기타'
  const categoryRows = useMemo(() => {
    const sorted = Object.entries(sel.byCategory).sort(
      (a, b) => b[1].amount - a[1].amount,
    );
    const top = sorted.slice(0, MAX_CATEGORY_ROWS);
    const rest = sorted.slice(MAX_CATEGORY_ROWS);
    if (rest.length > 0) {
      top.push([
        `기타 (${rest.length}개 분류)`,
        rest.reduce(
          (t, [, v]) => ({ n: t.n + v.n, amount: t.amount + v.amount }),
          { n: 0, amount: 0 },
        ),
      ]);
    }
    return top;
  }, [sel]);

  // 분류 기록: 선택 기간의 저장 건수와 사람별 건수 (삭제 기록 제외)
  const historyStats = useMemo(() => {
    const list = history.filter(
      (h) => h.source !== "delete" && (!period || monthOf(h.at) === period),
    );
    const byPerson = new Map<string, number>();
    for (const h of list) {
      const by = h.by && h.by.trim() ? h.by.trim() : "익명";
      byPerson.set(by, (byPerson.get(by) || 0) + 1);
    }
    return {
      total: list.length,
      people: [...byPerson.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    };
  }, [history, period]);

  const recentMonths = months.slice(0, 12);
  const maxMonthAmount = Math.max(0, ...recentMonths.map((m) => m.amount));
  const maxCatAmount = Math.max(0, ...categoryRows.map(([, v]) => v.amount));
  const sourceTotal = SOURCE_LABELS.reduce(
    (t, [k]) => t + (sel.bySource[k] || 0),
    0,
  );
  const maxSource = Math.max(0, ...SOURCE_LABELS.map(([k]) => sel.bySource[k] || 0));
  const maxPerson = Math.max(0, ...historyStats.people.map(([, n]) => n));
  const aiPct = sel.rows > 0 ? ((sel.bySource.ai || 0) / sel.rows) * 100 : 0;

  return (
    <main style={wrap}>
      <div style={card}>
        <a href="/" style={back}>
          ← 메인으로
        </a>
        <h1 style={title}>📊 사용 통계</h1>
        <p style={subtitle}>
          엑셀을 다운로드한 작업을 기준으로 집계해요 (같은 작업을 여러 번
          받아도 한 번만 셉니다). 금액은 원화 기준이고, 개인별 내역은 따로
          저장하지 않아요.
        </p>

        {!persistent && (
          <div style={warnBox}>
            ⚠️ 공유 저장소(KV)가 연결되지 않아 통계가 임시로만 저장돼요.
          </div>
        )}

        {loading ? (
          <p style={muted}>불러오는 중…</p>
        ) : error ? (
          <div style={warnBox}>{error}</div>
        ) : (
          <>
            <div style={filterRow}>
              <label style={filterLabel}>기간</label>
              <select
                style={filterSelect}
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              >
                <option value="">전체 기간</option>
                {months.map((m) => (
                  <option key={m.month} value={m.month}>
                    {monthLabel(m.month)}
                  </option>
                ))}
              </select>
            </div>

            <div style={tiles}>
              <div style={tile}>
                <div style={tileN}>{fmt(sel.batches)}</div>
                <div style={tileL}>다운로드한 작업</div>
              </div>
              <div style={tile}>
                <div style={tileN}>{fmt(sel.rows)}</div>
                <div style={tileL}>처리한 결제 건수</div>
              </div>
              <div style={tile}>
                <div style={tileN}>{fmt(sel.amount)}</div>
                <div style={tileL}>총 금액 (원)</div>
              </div>
              <div style={tile}>
                <div style={tileN}>{aiPct.toFixed(0)}%</div>
                <div style={tileL}>AI가 분류한 비율</div>
              </div>
            </div>

            {months.length === 0 ? (
              <p style={muted}>
                아직 집계된 다운로드가 없어요. v2.3.0 업데이트 이후 엑셀을
                다운로드한 작업부터 집계돼요.
              </p>
            ) : (
              <>
                <section style={section}>
                  <h2 style={h2}>월별 사용액</h2>
                  <p style={hint}>최근 12개월 · 막대에 마우스를 올리면 자세히 보여요</p>
                  {recentMonths.map((m) => (
                    <BarRow
                      key={m.month}
                      label={monthLabel(m.month)}
                      value={m.amount}
                      max={maxMonthAmount}
                      valueText={`${fmt(m.amount)}원`}
                      tooltip={`${monthLabel(m.month)} · ${fmt(m.amount)}원 · 결제 ${fmt(m.rows)}건 · 작업 ${fmt(m.batches)}회`}
                      highlight={period ? m.month === period : undefined}
                    />
                  ))}
                </section>

                <section style={section}>
                  <h2 style={h2}>분류별 금액</h2>
                  <p style={hint}>
                    {period ? monthLabel(period) : "전체 기간"} · 금액이 큰 순서
                  </p>
                  {categoryRows.map(([cat, v]) => (
                    <BarRow
                      key={cat}
                      label={shortCat(cat)}
                      value={v.amount}
                      max={maxCatAmount}
                      valueText={`${fmt(v.amount)}원 · ${
                        sel.amount > 0
                          ? ((v.amount / sel.amount) * 100).toFixed(0)
                          : 0
                      }%`}
                      tooltip={`${cat} · ${fmt(v.amount)}원 · ${fmt(v.n)}건`}
                    />
                  ))}
                </section>

                <section style={section}>
                  <h2 style={h2}>분류 방식</h2>
                  <p style={hint}>
                    결제 건이 어떤 방법으로 분류됐는지 · 학습 데이터가 쌓일수록
                    &apos;학습 데이터&apos; 비율이 늘어나요
                  </p>
                  {SOURCE_LABELS.map(([k, label]) => {
                    const n = sel.bySource[k] || 0;
                    return (
                      <BarRow
                        key={k}
                        label={label}
                        value={n}
                        max={maxSource}
                        valueText={`${fmt(n)}건 · ${
                          sourceTotal > 0
                            ? ((n / sourceTotal) * 100).toFixed(0)
                            : 0
                        }%`}
                        tooltip={`${label} · ${fmt(n)}건`}
                      />
                    );
                  })}
                </section>
              </>
            )}

            <section style={section}>
              <h2 style={h2}>학습 데이터 현황</h2>
              <div style={tiles}>
                <div style={tile}>
                  <div style={tileN}>{fmt(learnedCount)}</div>
                  <div style={tileL}>학습된 가맹점</div>
                </div>
                <div style={tile}>
                  <div style={tileN}>{fmt(gatewayCount)}</div>
                  <div style={tileL}>결제대행사</div>
                </div>
                <div style={tile}>
                  <div style={tileN}>{fmt(historyStats.total)}</div>
                  <div style={tileL}>
                    분류 저장 ({period ? monthLabel(period) : "전체"})
                  </div>
                </div>
              </div>
              {historyStats.people.length > 0 && (
                <>
                  <p style={hint}>분류를 많이 저장한 사람 (최대 10명)</p>
                  {historyStats.people.map(([name, n]) => (
                    <BarRow
                      key={name}
                      label={name}
                      value={n}
                      max={maxPerson}
                      valueText={`${fmt(n)}건`}
                      tooltip={`${name} · ${fmt(n)}건`}
                    />
                  ))}
                </>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

const wrap: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  justifyContent: "center",
  padding: 24,
};
const card: CSSProperties = {
  width: "100%",
  maxWidth: 720,
  background: "#fff",
  borderRadius: 16,
  padding: 32,
  boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
  alignSelf: "flex-start",
};
const back: CSSProperties = {
  fontSize: 13,
  color: "#2d6cdf",
  textDecoration: "none",
  fontWeight: 600,
};
const title: CSSProperties = { fontSize: 22, margin: "12px 0 6px" };
const subtitle: CSSProperties = {
  fontSize: 13.5,
  color: "#5f6873",
  lineHeight: 1.6,
  marginBottom: 16,
};
const muted: CSSProperties = { fontSize: 13.5, color: "#8a9099" };
const warnBox: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  background: "#fff8e6",
  border: "1px solid #f0dfae",
  color: "#8a6100",
  fontSize: 13,
  marginBottom: 12,
};
const filterRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 16,
};
const filterLabel: CSSProperties = {
  fontSize: 13,
  color: "#5f6873",
  fontWeight: 600,
};
const filterSelect: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #d7dbe0",
  fontSize: 13,
  background: "#fff",
};
const tiles: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: 10,
  marginBottom: 12,
};
const tile: CSSProperties = {
  padding: "14px 12px",
  borderRadius: 10,
  background: "#f3f5f8",
};
const tileN: CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: "#1f2329",
  fontVariantNumeric: "tabular-nums",
};
const tileL: CSSProperties = { fontSize: 12, color: "#5f6873", marginTop: 2 };
const section: CSSProperties = { marginTop: 28 };
const h2: CSSProperties = { fontSize: 16, margin: "0 0 2px", color: "#1f2329" };
const hint: CSSProperties = {
  fontSize: 12,
  color: "#8a9099",
  margin: "0 0 10px",
};
const barRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(90px, 200px) 1fr auto",
  alignItems: "center",
  gap: 10,
  padding: "5px 0",
  fontSize: 12.5,
};
const barLabel: CSSProperties = {
  color: "#3a4149",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const barLabelStrong: CSSProperties = { ...barLabel, fontWeight: 700 };
const barTrack: CSSProperties = {
  display: "block",
  height: 10,
  background: "#eef0f3",
  borderRadius: 4,
  overflow: "hidden",
};
const barFill: CSSProperties = {
  display: "block",
  height: "100%",
  background: "#2d6cdf",
  borderRadius: "0 4px 4px 0",
};
const barValue: CSSProperties = {
  color: "#3a4149",
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
};
