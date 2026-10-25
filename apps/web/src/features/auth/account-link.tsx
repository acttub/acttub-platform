"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { isMemberSession } from "@/lib/auth/token-store";

/** 상단 메뉴 오른쪽 끝의 계정 자리. 회원이면 내 계정, 아니면 로그인. 첫 그림은 서버와 같게 로그인으로 둔다. */
function subscribeStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export function AccountLink({ className }: { className?: string }) {
  const member = useSyncExternalStore(subscribeStorage, isMemberSession, () => false);
  return (
    <Link
      href={member ? "/account" : "/login"}
      className={className ?? "ml-auto shrink-0 rounded-full px-3 py-1.5 text-[13px] font-black text-[#4e5968] ring-1 ring-[#e5e8eb] hover:bg-[#f2f4f6]"}
    >
      {member ? "내 계정" : "로그인"}
    </Link>
  );
}
