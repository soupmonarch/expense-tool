import { NextRequest, NextResponse } from "next/server";

const COOKIE = "expense_auth";

async function tokenFor(pw: string): Promise<string> {
  const data = new TextEncoder().encode("expense::" + pw);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function POST(req: NextRequest) {
  const pw = process.env.APP_PASSWORD;
  // 비밀번호 미설정이면 그냥 통과(잠금 비활성).
  if (!pw) return NextResponse.json({ ok: true });

  let input = "";
  const ctype = req.headers.get("content-type") || "";
  if (ctype.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as { password?: string };
    input = String(body.password || "");
  } else {
    const form = await req.formData();
    input = String(form.get("password") || "");
  }

  if (input !== pw) {
    return NextResponse.json(
      { error: "비밀번호가 올바르지 않습니다." },
      { status: 401 },
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, await tokenFor(pw), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30일
  });
  return res;
}
