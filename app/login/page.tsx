"use client";

import { useState, Suspense, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "로그인에 실패했습니다.");
        setLoading(false);
        return;
      }
      const next = params.get("next") || "/";
      router.replace(next);
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} style={card}>
      <h1 style={title}>🧾 지출 증빙 · 변제 도구</h1>
      <p style={subtitle}>회사 공용 비밀번호를 입력해 주세요.</p>
      <input
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder="비밀번호"
        autoFocus
        style={input}
      />
      {error && <div style={errBox}>{error}</div>}
      <button type="submit" disabled={loading || !pw} style={button}>
        {loading ? "확인 중…" : "입장하기"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main style={wrap}>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}

const wrap: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#f5f6f8",
  padding: 24,
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Malgun Gothic', sans-serif",
};
const card: CSSProperties = {
  width: "100%",
  maxWidth: 360,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 28,
  borderRadius: 16,
  background: "#fff",
  border: "1px solid #e6e8eb",
  boxShadow: "0 4px 24px rgba(0,0,0,0.05)",
};
const title: CSSProperties = { fontSize: 20, margin: "0 0 2px" };
const subtitle: CSSProperties = {
  fontSize: 13.5,
  color: "#8a9099",
  margin: "0 0 8px",
};
const input: CSSProperties = {
  padding: "11px 12px",
  borderRadius: 10,
  border: "1px solid #d7dbe0",
  fontSize: 14,
};
const errBox: CSSProperties = {
  padding: "9px 11px",
  borderRadius: 8,
  background: "#fdecec",
  color: "#c0392b",
  fontSize: 13,
};
const button: CSSProperties = {
  padding: "11px 16px",
  borderRadius: 10,
  border: "none",
  background: "#2d6cdf",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
