import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, adminConfigured, adminToken } from "@/lib/adminAuth";

export const runtime = "nodejs";

// POST: 관리자 로그인. 틀리면 잠깐 기다리게 해서 비밀번호 맞추기 시도를 늦춘다.
export async function POST(req: NextRequest) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!adminConfigured() || !pw) {
    return NextResponse.json(
      { error: "관리자 비밀번호(ADMIN_PASSWORD)가 서버에 설정되지 않았어요." },
      { status: 503 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (String(body.password || "") !== pw) {
    await new Promise((r) => setTimeout(r, 1200));
    return NextResponse.json({ error: "비밀번호가 올바르지 않아요." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, adminToken(pw), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 12, // 12시간
  });
  return res;
}

// DELETE: 관리자 로그아웃
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
