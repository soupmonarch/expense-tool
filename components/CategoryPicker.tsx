"use client";

// 분류 선택기: 한글 이름 + 자주 쓰는 분류 + 검색.
// 기존 <select> 는 영문 분류 43개가 길게 나열돼 찾기 어려웠다.
// 펼친 목록은 버튼 바로 아래에 '자리를 차지하며' 열린다(팝업 안 스크롤에 잘리지 않도록).

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  EXPENSE_CATEGORIES,
  TRAVEL_CATEGORIES,
  UNCLASSIFIED,
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

const GROUPS: { title: string; items: readonly string[] }[] = [
  { title: "자주 쓰는 분류", items: FAVORITE_CATEGORIES },
  { title: "Expense", items: EXPENSE_CATEGORIES },
  { title: "Travel", items: TRAVEL_CATEGORIES },
];

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

  const groups = useMemo(() => {
    const k = q.trim().toLowerCase();
    const match = (c: string) =>
      !k || categoryLabel(c).toLowerCase().includes(k) || c.toLowerCase().includes(k);
    return GROUPS.map((g) => ({
      title: g.title,
      // 검색 중에는 '자주 쓰는 분류'를 숨겨 중복 표시를 막는다.
      items: k && g.title === "자주 쓰는 분류" ? [] : g.items.filter(match),
    })).filter((g) => g.items.length > 0);
  }, [q]);

  function pick(c: string) {
    onChange(c);
    setOpen(false);
    setQ("");
  }

  const unclassified = !value || value === UNCLASSIFIED;
  const sm = size === "sm";

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
        <span style={{ minWidth: 0 }}>
          {unclassified ? (
            <b style={{ color: T.danger }}>분류를 골라 주세요</b>
          ) : (
            <>
              <b style={labelKo}>{categoryLabel(value)}</b>
              <span style={labelEn}>{shortCategory(value)}</span>
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
            placeholder="검색 (예: 택시, 주차, software)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter") {
                e.preventDefault();
                const first = groups[0]?.items[0];
                if (first) pick(first);
              }
            }}
          />
          <div style={list}>
            {groups.length === 0 && <div style={empty}>검색 결과가 없어요</div>}
            {groups.map((g) => (
              <div key={g.title}>
                <div style={groupTitle}>{g.title}</div>
                {g.items.map((c) => (
                  <button
                    key={g.title + c}
                    type="button"
                    style={c === value ? optionActive : option}
                    onClick={() => pick(c)}
                  >
                    <span style={labelKo}>{categoryLabel(c)}</span>
                    <span style={labelEn}>{shortCategory(c)}</span>
                  </button>
                ))}
              </div>
            ))}
            {!q && allowUnclassified && (
              <button type="button" style={option} onClick={() => pick(UNCLASSIFIED)}>
                <span style={{ ...labelKo, color: T.textMuted }}>미분류로 두기 (나중에)</span>
              </button>
            )}
          </div>
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
const triggerSm: CSSProperties = { padding: "4px 8px", fontSize: 12 };
const triggerWarn: CSSProperties = {
  borderColor: T.dangerBorder,
  background: T.dangerBgSoft,
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
  padding: "8px 10px",
  border: "none",
  borderBottom: `1px solid ${T.divider}`,
  fontSize: 13,
  outline: "none",
};
const list: CSSProperties = { maxHeight: 260, overflowY: "auto", padding: "4px 0" };
const groupTitle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: T.textFaint,
  padding: "8px 10px 2px",
};
const option: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "6px 10px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontSize: 13,
};
const optionActive: CSSProperties = { ...option, background: T.primaryBg };
const empty: CSSProperties = { padding: "10px", fontSize: 12.5, color: T.textFaint };
