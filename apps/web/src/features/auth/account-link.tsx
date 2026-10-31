"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { isMemberSession, memberName, subscribeAuthChange } from "@/lib/auth/token-store";

/**
 * 상단 메뉴의 계정 자리. 회원이면 「<이름> 님」(내 계정으로), 아니면 「로그인」.
 * 첫 그림은 서버와 같게 로그인으로 둔다. 회원일 때 좁은 화면에서는 메뉴 안의 「내 계정」이 이 자리를 대신한다
 * (memberClassName 으로 숨김 여부를 정한다).
 */
export function AccountLink({ className, memberClassName }: { className?: string; memberClassName?: string }) {
  const member = useSyncExternalStore(subscribeAuthChange, isMemberSession, () => false);
  const name = useSyncExternalStore(subscribeAuthChange, memberName, () => "");
  if (member) {
    return (
      <Link href="/account" className={memberClassName ?? className}>
        {name ? `${name} 님` : "내 계정"}
      </Link>
    );
  }
  return (
    <Link href="/login" className={className}>
      로그인
    </Link>
  );
}
