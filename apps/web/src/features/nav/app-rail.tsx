"use client";

// 앱 전체를 가로지르는 좌측 네비. 64px 고정.
//
// 워크스페이스의 SessionRail(연습 목록)과는 다른 층이다. 홈에서는 이 레일 오른쪽에
// SessionRail 이 한 겹 더 붙고, 입시·커뮤니티에서는 이 레일과 본문만 있다.
//
// 세션 API 를 부르지 않는다 — 커뮤니티는 로그인 없이도 열리므로, 여기서 목록을
// 불러오면 비로그인 방문자에게 401 이 난다.

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useOptionalAuth } from "@/features/auth/use-optional-auth";
import { getStoredUser } from "@/lib/auth/token-store";

const RAIL_WIDTH = "w-16";

type Item = {
  href: string;
  label: string;
  icon: string;
  /** 이 경로들 중 하나로 시작하면 현재 위치로 본다. */
  match: string[];
};

const ITEMS: Item[] = [
  { href: "/practice/new", label: "홈", icon: "⌂", match: ["/practice", "/home"] },
  { href: "/admissions", label: "입시", icon: "◎", match: ["/admissions"] },
  { href: "/community", label: "커뮤", icon: "▢", match: ["/community"] },
];

export function AppRail() {
  const pathname = usePathname();
  const { loggedIn } = useOptionalAuth();

  return (
    <nav
      aria-label="주요 메뉴"
      // 뷰포트에 붙여 둔다. flex 자식으로 그냥 두면 본문이 길어질수록 레일도 문서
      // 높이만큼 늘어나서, 아래 붙은 프로필이 화면 밖 저 끝으로 밀려난다.
      // self-start 가 stretch 를 끄고, sticky+h-dvh 가 화면 높이를 지킨다.
      className={`sticky top-0 flex h-dvh ${RAIL_WIDTH} shrink-0 flex-col items-center self-start overflow-y-auto border-r border-[#edf0f3] bg-white py-3`}
    >
      <div className="flex flex-1 flex-col items-center gap-1">
        {ITEMS.map((item) => (
          <RailLink
            key={item.href}
            item={item}
            active={item.match.some((prefix) => pathname.startsWith(prefix))}
          />
        ))}
      </div>
      <AccountSlot loggedIn={loggedIn} />
    </nav>
  );
}

function RailLink({ item, active }: { item: Item; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-2xl transition ${
        active
          ? "bg-[#e8f3ff] text-[#3182f6]"
          : "text-[#8b95a1] hover:bg-[#f2f4f6] hover:text-[#4e5968]"
      }`}
    >
      <span aria-hidden="true" className="text-[17px] leading-none">
        {item.icon}
      </span>
      <span className="text-[11px] font-black leading-none">{item.label}</span>
    </Link>
  );
}

function AccountSlot({ loggedIn }: { loggedIn: boolean }) {
  // getStoredUser 는 로그인 상태가 바뀔 때만 값이 달라지고, useOptionalAuth 가
  // 그 변화에 맞춰 다시 그린다.
  const user = loggedIn ? getStoredUser() : null;
  if (!loggedIn) {
    return (
      <Link
        href="/login"
        className="mt-2 flex h-10 w-14 items-center justify-center rounded-2xl text-[11px] font-black text-[#3182f6] transition hover:bg-[#f2f4f6]"
      >
        로그인
      </Link>
    );
  }
  const initial = (user?.email ?? "배").trim().charAt(0).toUpperCase() || "배";
  return (
    <Link
      href="/practice/new"
      title="내 연습으로"
      className="mt-2 flex h-9 w-9 items-center justify-center rounded-full bg-[#191f28] text-[13px] font-black text-white"
    >
      {initial}
    </Link>
  );
}

/** 레일 + 본문을 나란히 세우는 껍데기. 입시·커뮤니티가 쓴다. */
export function RailLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-[#f8fbff]">
      <AppRail />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
