// 서버 전용: 관리자 메뉴 잠금.
// 비밀번호는 코드에 두지 않고 Vercel 환경변수 ADMIN_PASSWORD 에만 둔다
// (코드에 적으면 GitHub 에 그대로 올라간다). 설정돼 있지 않으면 관리자 메뉴는 열리지 않는다.
import { createHash } from "crypto";
import type { NextRequest } from "next/server";

export const ADMIN_COOKIE = "expense_admin";

export function adminToken(pw: string): string {
  return createHash("sha256").update("expense-admin::" + pw).digest("hex");
}

export function adminConfigured(): boolean {
  return !!process.env.ADMIN_PASSWORD;
}

export function isAdmin(req: NextRequest): boolean {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return false;
  return req.cookies.get(ADMIN_COOKIE)?.value === adminToken(pw);
}
