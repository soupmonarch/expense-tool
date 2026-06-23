import { NextRequest, NextResponse } from "next/server";

// 회사 공용 비밀번호 잠금.
// APP_PASSWORD 환경변수가 설정돼 있으면, 올바른 비밀번호로 로그인한 사용자만
// (쿠키 보유) 앱에 접근할 수 있다. 설정돼 있지 않으면 잠그지 않는다.

const COOKIE = "expense_auth";

async function expectedToken(pw: string): Promise<string> {
  const data = new TextEncoder().encode("expense::" + pw);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(req: NextRequest) {
  const pw = process.env.APP_PASSWORD;
  // 비밀번호 미설정 시 잠그지 않음(로컬/미설정 환경에서도 동작).
  if (!pw) return NextResponse.next();

  const { pathname } = req.nextUrl;
  // 로그인 페이지/로그인·로그아웃 API는 항상 허용.
  if (
    pathname === "/login" ||
    pathname === "/api/login" ||
    pathname === "/api/logout"
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE)?.value;
  const expected = await expectedToken(pw);
  if (token && token === expected) return NextResponse.next();

  // API는 401, 일반 페이지는 로그인으로 리다이렉트.
  if (pathname.startsWith("/api")) {
    return new NextResponse(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
