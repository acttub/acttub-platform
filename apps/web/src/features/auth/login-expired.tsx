"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { clearLoginExpired, isLoginExpired, subscribeLoginExpired } from "@/lib/auth/login-expired";

export { clearLoginExpired };

/**
 * 루트 레이아웃에 한 번 놓는다. 회원 로그인이 풀렸을 때만 화면 위에 한 줄 안내를 띄운다.
 * 새 게스트로 몰래 이어 가지 않고, 다시 로그인하면 지금 화면으로 돌아온다.
 */
export function LoginExpiredNoticeHost() {
  const expired = useSyncExternalStore(subscribeLoginExpired, isLoginExpired, () => false);
  const pathname = usePathname();
  if (!expired || pathname === "/login" || pathname === "/signup" || pathname?.startsWith("/auth/")) return null;
  const next = typeof window === "undefined" ? pathname : `${window.location.pathname}${window.location.search}`;
  return (
    <div role="status" className="sticky top-0 z-[80] flex items-center gap-3 bg-[#191f28] px-4 py-3 text-sm text-white">
      <span className="font-semibold">로그인이 풀렸어요. 다시 로그인하면 이어서 쓸 수 있어요.</span>
      <a href={`/login?next=${encodeURIComponent(next ?? "/")}`} className="ml-auto shrink-0 font-bold text-[#8fb8ff] underline underline-offset-2">
        다시 로그인
      </a>
      <button type="button" onClick={clearLoginExpired} aria-label="안내 닫기" className="shrink-0 px-1 text-[#b0b8c1]">
        ✕
      </button>
    </div>
  );
}
