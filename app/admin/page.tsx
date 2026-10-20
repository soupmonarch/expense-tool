"use client";

// 관리자 메뉴 (/admin) — 화면 어디에도 링크가 없다. 주소를 직접 입력하거나
// 메인 화면 맨 아래 버전 글자를 더블클릭해서 들어온다. 비밀번호는 서버의 ADMIN_PASSWORD.
// 사용자(기기)별로 이용 횟수·총 금액·IP를 보고, 한 사람의 이전 다운로드 내역과
// 각 다운로드의 결제 항목, 저장한 분류 기록까지 펼쳐 볼 수 있다.

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { T } from "@/lib/theme";
import { categoryLabel } from "@/lib/categoryLabels";
import { historyLabel } from "@/lib/gateways";

interface Item {
  d: string;
  m: string;
  a: number;
  c: string;
}
interface Download {
  at: string;
  by: string;
  mode: string;
  rows: number;
  amount: number;
  ip: string;
  ua: string;
  receipt: { matched?: number; recognized?: number; pages?: number } | null;
  items: Item[] | null;
}
interface Save {
  at: string;
  by: string;
  merchant: string;
  category: string;
  source?: string;
  ip: string;
}
interface User {
  key: string;
  kind: "device" | "ip" | "name" | "unknown";
  names: string[];
  ips: string[];
  uas: string[];
  downloads: Download[];
  saves: Save[];
  amount: number;
  rows: number;
  first: string;
  last: string;
}

const MODE_LABEL: Record<string, string> = {
  both: "엑셀 + 영수증",
  pdf: "영수증 PDF만",
  excel: "엑셀만",
};

const fmt = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");
function fmtAt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function userTitle(u: User): string {
  if (u.names.length) return u.names.join(", ");
  if (u.kind === "unknown") return "이전 기록 (식별 정보 없음)";
  return "이름 없음";
}
function userIdLabel(u: User): string {
  if (u.kind === "device") return "기기 " + u.key.slice(2, 8);
  if (u.kind === "ip") return "IP로 구분";
  if (u.kind === "name") return "이름으로 구분";
  return "—";
}

export default function AdminPage() {
  const [state, setState] = useState<"loading" | "login" | "ready">("loading");
  const [users, setUsers] = useState<User[]>([]);
  const [totals, setTotals] = useState({ users: 0, downloads: 0, amount: 0 });
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [openDl, setOpenDl] = useState<string | null>(null);
  const [q, setQ] = useState("");

  async function load() {
    setErr(null);
    const res = await fetch("/api/admin/data", { cache: "no-store" });
    if (res.status === 401) return setState("login");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(data?.error || "불러오지 못했어요.");
      return setState("login");
    }
    setUsers(data.users || []);
    setTotals(data.totals || { users: 0, downloads: 0, amount: 0 });
    setState("ready");
  }

  useEffect(() => {
    load();
  }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(data?.error || "로그인 실패");
    setPw("");
    await load();
  }

  async function logout() {
    await fetch("/api/admin/login", { method: "DELETE" });
    setUsers([]);
    setSelected(null);
    setState("login");
  }

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return users;
    return users.filter(
      (u) =>
        u.names.some((n) => n.toLowerCase().includes(k)) ||
        u.ips.some((ip) => ip.includes(k)) ||
        u.key.toLowerCase().includes(k),
    );
  }, [users, q]);
  const cur = users.find((u) => u.key === selected) || null;

  if (state === "loading") {
    return (
      <main style={wrap}>
        <div style={{ ...card, maxWidth: 420 }}>불러오는 중…</div>
      </main>
    );
  }

  if (state === "login") {
    return (
      <main style={wrap}>
        <form style={{ ...card, maxWidth: 380 }} onSubmit={login}>
          <a href="/" style={back}>← 메인으로</a>
          <h1 style={title}>관리자</h1>
          <p style={sub}>관리자 비밀번호를 입력해 주세요.</p>
          <input
            type="password"
            autoFocus
            style={input}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="비밀번호"
          />
          {err && <div style={errBox}>{err}</div>}
          <button type="submit" style={primaryBtn}>들어가기</button>
        </form>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <div style={{ ...card, maxWidth: 1180 }}>
        <div style={headRow}>
          <div>
            <a href="/" style={back}>← 메인으로</a>
            <h1 style={title}>관리자 · 사용자별 이용 내역</h1>
          </div>
          <button style={ghostBtn} onClick={logout}>로그아웃</button>
        </div>

        <div style={tiles}>
          <div style={tile}>
            <div style={tileN}>{fmt(totals.users)}</div>
            <div style={tileL}>다운로드한 사용자(기기)</div>
          </div>
          <div style={tile}>
            <div style={tileN}>{fmt(totals.downloads)}</div>
            <div style={tileL}>다운로드 횟수</div>
          </div>
          <div style={tile}>
            <div style={tileN}>{fmt(totals.amount)}원</div>
            <div style={tileL}>분류한 총 금액 (같은 결제 중복 제외)</div>
          </div>
        </div>

        <p style={note}>
          사람 구분은 <b>브라우저 기기 ID</b> 기준이에요. 같은 사람이 다른 PC·브라우저를
          쓰면 따로 보일 수 있고, 사무실에서는 여러 명이 같은 IP로 보일 수 있어요.
          v2.10.0 이전 기록에는 기기·IP·항목 정보가 없어요.
        </p>

        <div style={grid}>
          <div>
            <input
              style={{ ...input, marginBottom: 8 }}
              placeholder="이름 · IP 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div style={userList}>
              {filtered.map((u) => (
                <button
                  key={u.key}
                  style={u.key === selected ? userRowOn : userRow}
                  onClick={() => {
                    setSelected(u.key);
                    setOpenDl(null);
                  }}
                >
                  <div style={userRowTop}>
                    <b style={{ color: u.names.length ? T.text : T.textFaint }}>{userTitle(u)}</b>
                    <span style={amountTxt}>{fmt(u.amount)}원</span>
                  </div>
                  <div style={userRowMeta}>
                    {userIdLabel(u)}
                    {u.ips.length ? ` · ${u.ips.slice(0, 2).join(", ")}${u.ips.length > 2 ? " 외" : ""}` : ""}
                    {" · "}다운로드 {u.downloads.length}회 · 마지막 {fmtAt(u.last)}
                  </div>
                </button>
              ))}
              {filtered.length === 0 && <div style={sub}>해당하는 사용자가 없어요.</div>}
            </div>
          </div>

          <div style={detail}>
            {!cur ? (
              <div style={{ ...sub, padding: 20 }}>왼쪽에서 사용자를 고르면 이전 내역이 모두 보여요.</div>
            ) : (
              <>
                <h2 style={h2}>{userTitle(cur)}</h2>
                <div style={infoGrid}>
                  <span style={infoK}>구분</span>
                  <span>{userIdLabel(cur)}{cur.kind === "device" ? ` (${cur.key.slice(2)})` : ""}</span>
                  <span style={infoK}>IP</span>
                  <span>{cur.ips.join(", ") || "—"}</span>
                  <span style={infoK}>기기</span>
                  <span>{cur.uas.join(", ") || "—"}</span>
                  <span style={infoK}>기간</span>
                  <span>{fmtAt(cur.first)} ~ {fmtAt(cur.last)}</span>
                  <span style={infoK}>합계</span>
                  <span>
                    다운로드 {cur.downloads.length}회 · {fmt(cur.rows)}건 · <b>{fmt(cur.amount)}원</b>
                    <span style={{ color: T.textFaint }}> (같은 결제 중복 제외)</span>
                  </span>
                </div>

                <h3 style={h3}>다운로드 내역</h3>
                {cur.downloads.length === 0 && <div style={sub}>다운로드 기록이 없어요.</div>}
                {cur.downloads.map((d, i) => {
                  const id = d.at + i;
                  const open = openDl === id;
                  return (
                    <div key={id} style={dlCard}>
                      <button style={dlHead} onClick={() => setOpenDl(open ? null : id)}>
                        <span style={{ color: T.textFaint }}>{open ? "▼" : "▶"}</span>
                        <span style={{ minWidth: 118 }}>{fmtAt(d.at)}</span>
                        <span style={{ flex: 1, textAlign: "left", color: T.textSub }}>
                          {d.by || "이름 없음"} · {MODE_LABEL[d.mode] || "방식 기록 없음"} · {d.rows}건
                          {d.ip ? ` · ${d.ip}` : ""}
                        </span>
                        <b>{fmt(d.amount)}원</b>
                      </button>
                      {open && (
                        <div style={dlBody}>
                          {d.items && d.items.length ? (
                            <table style={table}>
                              <thead>
                                <tr>
                                  <th style={th}>결제일</th>
                                  <th style={th}>가맹점</th>
                                  <th style={th}>분류</th>
                                  <th style={thR}>금액</th>
                                </tr>
                              </thead>
                              <tbody>
                                {d.items.map((it, k) => (
                                  <tr key={k}>
                                    <td style={td}>{it.d}</td>
                                    <td style={td}>{it.m}</td>
                                    <td style={td}>{it.c === "UNCLASSIFIED" ? "미분류" : categoryLabel(it.c)}</td>
                                    <td style={tdR}>{fmt(it.a)}원</td>
                                  </tr>
                                ))}
                                <tr>
                                  <td style={{ ...td, fontWeight: 700 }} colSpan={3}>합계</td>
                                  <td style={{ ...tdR, fontWeight: 700 }}>{fmt(d.amount)}원</td>
                                </tr>
                              </tbody>
                            </table>
                          ) : (
                            <div style={sub}>이 다운로드는 항목 정보가 없는 이전 기록이에요.</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                <h3 style={h3}>분류 저장 기록 ({cur.saves.length}건)</h3>
                {cur.saves.length === 0 ? (
                  <div style={sub}>저장한 분류가 없어요.</div>
                ) : (
                  <table style={table}>
                    <thead>
                      <tr>
                        <th style={th}>일시</th>
                        <th style={th}>이름</th>
                        <th style={th}>가맹점</th>
                        <th style={th}>분류</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cur.saves.slice(0, 200).map((s, k) => (
                        <tr key={k}>
                          <td style={td}>{fmtAt(s.at)}</td>
                          <td style={td}>{s.by || "—"}</td>
                          <td style={td}>{s.merchant}</td>
                          <td style={td}>{historyLabel(s.category)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

const wrap: CSSProperties = { minHeight: "100vh", display: "flex", justifyContent: "center", padding: 24 };
const card: CSSProperties = {
  width: "100%",
  background: T.surface,
  borderRadius: 16,
  padding: 28,
  boxShadow: T.shadow,
  alignSelf: "flex-start",
  boxSizing: "border-box",
};
const back: CSSProperties = { fontSize: 13, color: T.primary, textDecoration: "none", fontWeight: 600 };
const title: CSSProperties = { fontSize: 21, margin: "8px 0 4px" };
const sub: CSSProperties = { fontSize: 13, color: T.textMuted };
const note: CSSProperties = { fontSize: 12, color: T.textFaint, lineHeight: 1.6, margin: "4px 0 16px" };
const input: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "9px 11px",
  borderRadius: T.radiusSm,
  border: `1px solid ${T.border}`,
  fontSize: 13.5,
  margin: "10px 0",
};
const primaryBtn: CSSProperties = {
  width: "100%",
  padding: "10px",
  borderRadius: T.radius,
  border: "none",
  background: T.primary,
  color: T.surface,
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};
const ghostBtn: CSSProperties = {
  padding: "8px 14px",
  borderRadius: T.radiusSm,
  border: `1px solid ${T.borderStrong}`,
  background: T.surface,
  color: T.textMuted,
  fontSize: 13,
  cursor: "pointer",
};
const errBox: CSSProperties = {
  padding: "8px 10px",
  borderRadius: T.radiusSm,
  background: T.dangerBg,
  color: T.danger,
  fontSize: 13,
  marginBottom: 10,
};
const headRow: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 };
const tiles: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 };
const tile: CSSProperties = { padding: "14px 12px", borderRadius: T.radius, background: T.surfaceAlt };
const tileN: CSSProperties = { fontSize: 22, fontWeight: 700, color: T.text, fontVariantNumeric: "tabular-nums" };
const tileL: CSSProperties = { fontSize: 12, color: T.textMuted, marginTop: 2 };
const grid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: 16,
  alignItems: "start",
};
const userList: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, maxHeight: "70vh", overflowY: "auto" };
const userRow: CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderRadius: T.radiusSm,
  border: `1px solid ${T.divider}`,
  background: T.surface,
  cursor: "pointer",
};
const userRowOn: CSSProperties = { ...userRow, borderColor: T.primary, background: T.primaryBg };
const userRowTop: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 8, fontSize: 14 };
const userRowMeta: CSSProperties = { fontSize: 12, color: T.textFaint, marginTop: 3 };
const amountTxt: CSSProperties = { fontWeight: 700, color: T.text, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const detail: CSSProperties = {
  border: `1px solid ${T.divider}`,
  borderRadius: T.radius,
  padding: 16,
  minHeight: 200,
  gridColumn: "span 1",
};
const h2: CSSProperties = { fontSize: 18, margin: "0 0 10px" };
const h3: CSSProperties = { fontSize: 14, margin: "18px 0 8px", color: T.text };
const infoGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: "4px 12px",
  fontSize: 13,
  color: T.textSub,
};
const infoK: CSSProperties = { color: T.textFaint };
const dlCard: CSSProperties = { border: `1px solid ${T.divider}`, borderRadius: T.radiusSm, marginBottom: 6, overflow: "hidden" };
const dlHead: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 10px",
  border: "none",
  background: T.surfaceAlt,
  cursor: "pointer",
  fontSize: 12.5,
  fontVariantNumeric: "tabular-nums",
};
const dlBody: CSSProperties = { padding: 8 };
const table: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 12.5 };
const th: CSSProperties = { textAlign: "left", padding: "6px 8px", borderBottom: `2px solid ${T.divider}`, color: T.textMuted, fontWeight: 600 };
const thR: CSSProperties = { ...th, textAlign: "right" };
const td: CSSProperties = { padding: "5px 8px", borderBottom: `1px solid ${T.divider}`, color: T.textSub };
const tdR: CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
