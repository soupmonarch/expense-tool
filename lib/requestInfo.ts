// 서버 전용: 요청한 사람의 접속 정보(IP, 기기 요약). 이용 기록·관리자 메뉴용.
import type { NextRequest } from "next/server";

export interface ClientInfo {
  ip: string;
  ua: string; // 예: "Windows · Edge"
}

function uaSummary(ua: string): string {
  const os = /iPhone|iPad/.test(ua)
    ? "iPhone/iPad"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "Mac"
        : /Windows/.test(ua)
          ? "Windows"
          : "기타";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Whale\//.test(ua)
      ? "Whale"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "기타";
  return `${os} · ${browser}`;
}

export function clientInfo(req: NextRequest): ClientInfo {
  // Vercel 은 실제 접속 IP를 x-forwarded-for 첫 번째 값으로 넘겨 준다.
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = (fwd.split(",")[0] || req.headers.get("x-real-ip") || "").trim().slice(0, 64);
  return { ip, ua: uaSummary(req.headers.get("user-agent") || "") };
}

// 기기 ID 는 브라우저가 보낸 값 — 영문·숫자만 짧게 받는다.
export function cleanDeviceId(v: unknown): string {
  return typeof v === "string" ? v.replace(/[^a-z0-9]/gi, "").slice(0, 32) : "";
}
