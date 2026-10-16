"use client";

// 분류 선택기: 한글 이름 + 자주 쓰는 분류 + 검색.
// Expense(파랑) / Travel(주황)을 좌우 두 칸으로 나눠 한눈에 구분되게 한다
// (좁은 화면에서는 위아래로 쌓인다).
// 펼친 목록은 버튼 바로 아래에 '자리를 차지하며' 열린다(팝업 안 스크롤에 잘리지 않도록).

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  EXPENSE_CATEGORIES,
  TRAVEL_CATEGORIES,
  UNCLASSIFIED,
  groupOf,
  type Category,
} from "@/lib/categories";
import {
  FAVORITE_CATEGORIES,
  categoryLabel,
  shortCategory,
} from "@/lib/categoryLabels";
import { T } from "@/lib/theme";

interface Props {
  value: string;
  onChange: (category: string) => void;
  size?: "md" | "sm";
  allowUnclassified?: boolean; // "미분류로 두기" 선택지 표시 (학습 데이터 화면에서는 끔)
}

const ALL = new Set<string>([...EXPENSE_CATEGORIES, ...TRAVEL_CATEGORIES]);

function groupColors(c: string) {
  const travel = ALL.has(c) && groupOf(c as Category) === "travel";
  return travel
    ? { fg: T.travel, bg: T.travelBg, border: T.travelBorder, name: "Travel" }
    : { fg: T.expense, bg: T.expenseBg, border: T.expenseBorder, name: "Expense" };
}

export default function CategoryPicker({
  value,
  onChange,
  size = "md",
  allowUnclassified = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 바깥을 누르면 닫는다.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    inputRef.current?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const k = q.trim().toLowerCase();
  const match = (c: string) =>
    !k || categoryLabel(c).toLowerCase().includes(k) || c.toLowerCase().includes(k);
  const expense = useMemo(() => EXPENSE_CATEGORIES.filter(match), [k]); // eslint-disable-line react-hooks/exhaustive-deps
  const travel = useMemo(() => TRAVEL_CATEGORIES.filter(match), [k]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(c: string) {
    onChange(c);
    setOpen(false);
    setQ("");
  }

  const unclassified = !value || value === UNCLASSIFIED;
  const sm = size === "sm";
  const cur = groupColors(value);

  function renderColumn(title: "Expense" | "Travel", items: readonly string[]) {
    const col = title === "Travel" ? groupColors(TRAVEL_CATEGORIES[0]) : groupColors(EXPENSE_CATEGORIES[0]);
    return (
      <div style={{ ...column, borderColor: col.border }}>
        <div style={{ ...columnHead, color: col.fg, background: col.bg }}>
          {title} <span style={columnCount}>{items.length}</span>
        </div>
        <div style={columnList}>
          {items.length === 0 && <div style={empty}>결과 없음</div>}
          {items.map((c) => (
            <button
              key={c}
              type="button"
              style={c === value ? { ...option, background: col.bg } : option}
              onClick={() => pick(c)}
            >
              <span style={labelKo}>{categoryLabel(c)}</span>
              <span style={labelEn}>{shortCategory(c)}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={boxRef} style={{ width: "100%" }}>
      <button
        type="button"
        style={{
          ...trigger,
          ...(sm ? triggerSm : null),
          ...(unclassified ? triggerWarn : null),
          ...(open ? { borderColor: T.primary } : null),
        }}
        onClick={() => setOpen((v) => !v)}
      >
        <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
          {unclassified ? (
            <b style={{ color: T.danger }}>분류를 골라 주세요</b>
          ) : (
            <>
              <span style={{ ...tag, color: cur.fg, background: cur.bg, borderColor: cur.border }}>
                {cur.name}
              </span>
              <span style={{ minWidth: 0 }}>
                <b style={labelKo}>{categoryLabel(value)}</b>
                {!sm && <span style={labelEn}>{shortCategory(value)}</span>}
              </span>
            </>
          )}
        </span>
        <span style={caret}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={panel}>
          <input
            ref={inputRef}
            style={search}
            placeholder="검색 (예: 택시, 주차, 구독)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter") {
                e.preventDefault();
                const first = expense[0] ?? travel[0];
                if (first) pick(first);
              }
            }}
          />
          {!k && (
            <div style={favRow}>
              <span style={favTitle}>자주 쓰는 분류</span>
              {FAVORITE_CATEGORIES.map((c) => {
                const g = groupColors(c);
                return (
                  <button
                    key={c}
                    type="button"
                    style={{ ...chip, borderColor: g.border, background: c === value ? g.bg : T.surface }}
                    onClick={() => pick(c)}
                  >
                    <span style={{ ...dot, background: g.fg }} />
                    {categoryLabel(c).replace(/\s*\(.*\)$/, "")}
                  </button>
                );
              })}
            </div>
          )}
          <div style={columns}>
            {renderColumn("Expense", expense)}
            {renderColumn("Travel", travel)}
          </div>
          {!k && allowUnclassified && (
            <button type="button" style={unclassifiedBtn} onClick={() => pick(UNCLASSIFIED)}>
              미분류로 두기 (나중에)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const trigger: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "7px 10px",
  borderRadius: T.radiusSm,
  border: `1px solid ${T.borderStrong}`,
  background: T.surface,
  cursor: "pointer",
  textAlign: "left",
  fontSize: 13,
};
const triggerSm: CSSProperties = { padding: "5px 8px", fontSize: 12.5 };
const triggerWarn: CSSProperties = { borderColor: T.dangerBorder, background: T.dangerBgSoft };
const tag: CSSProperties = {
  flexShrink: 0,
  fontSize: 10.5,
  fontWeight: 700,
  padding: "1px 6px",
  borderRadius: 5,
  border: "1px solid",
};
const labelKo: CSSProperties = {
  display: "block",
  color: T.text,
  fontWeight: 600,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const labelEn: CSSProperties = {
  display: "block",
  fontSize: 11,
  color: T.textFaint,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const caret: CSSProperties = { fontSize: 9, color: T.textFaint, flexShrink: 0 };
const panel: CSSProperties = {
  marginTop: 4,
  border: `1px solid ${T.border}`,
  borderRadius: T.radiusSm,
  background: T.surface,
  boxShadow: "0 6px 18px rgba(0,0,0,0.08)",
  overflow: "hidden",
};
const search: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "9px 10px",
  border: "none",
  borderBottom: `1px solid ${T.divider}`,
  fontSize: 13,
  outline: "none",
};
const favRow: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 6,
  padding: "8px 10px",
  borderBottom: `1px solid ${T.divider}`,
};
const favTitle: CSSProperties = { fontSize: 11, fontWeight: 700, color: T.textFaint, marginRight: 2 };
const chip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "3px 9px",
  borderRadius: 999,
  border: "1px solid",
  fontSize: 12,
  fontWeight: 600,
  color: T.textSub,
  cursor: "pointer",
};
const dot: CSSProperties = { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 };
const columns: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  gap: 8,
  padding: 8,
};
const column: CSSProperties = {
  border: "1px solid",
  borderRadius: T.radiusSm,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};
const columnHead: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  padding: "6px 10px",
};
const columnCount: CSSProperties = { fontWeight: 500, opacity: 0.7 };
const columnList: CSSProperties = { maxHeight: 230, overflowY: "auto", padding: "2px 0" };
const option: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "6px 10px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontSize: 12.5,
};
const empty: CSSProperties = { padding: "10px", fontSize: 12, color: T.textFaint };
const unclassifiedBtn: CSSProperties = {
  display: "block",
  width: "100%",
  padding: "8px 10px",
  border: "none",
  borderTop: `1px solid ${T.divider}`,
  background: T.surfaceAlt,
  color: T.textMuted,
  fontSize: 12.5,
  cursor: "pointer",
  textAlign: "left",
};
