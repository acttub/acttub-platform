"use client";

// 앱 전체를 가로지르는 상단 네비. 높이 56px 고정(워크스페이스 헤더와 같은 h-14).
//
// 2026-08-09에 좌측 레일에서 상단 바로 옮겼다 — 폰에서 76px 레일이 본문 폭을 먹었고,
// 워크스페이스는 그 옆에 SessionRail 이 한 겹 더 붙어 가로가 두 번 깎였다.
// 워크스페이스는 이 컴포넌트를 쓰지 않고 자기 헤더 오른쪽 끝에 입시·커뮤를 단다
// (바가 두 줄이 되지 않게). 입시·커뮤니티 화면만 이 바를 쓴다.
//
// 세션 API 를 부르지 않는다 — 커뮤니티는 로그인 없이도 열리므로, 여기서 목록을
// 불러오면 비로그인 방문자에게 401 이 난다.

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useOptionalAuth } from "@/features/auth/use-optional-auth";
import { getStoredUser } from "@/lib/auth/token-store";

type Item = {
  href: string;
  label: string;
  icon: IconName;
  /** 이 경로들 중 하나로 시작하면 현재 위치로 본다. */
  match: string[];
};

const ITEMS: Item[] = [
  { href: "/practice/new", label: "홈", icon: "home", match: ["/practice", "/home"] },
  { href: "/admissions", label: "입시", icon: "school", match: ["/admissions"] },
  { href: "/community", label: "커뮤", icon: "chat", match: ["/community"] },
  { href: "/app", label: "앱", icon: "phone", match: ["/app"] },
];

export function AppRail() {
  const pathname = usePathname();
  const { loggedIn } = useOptionalAuth();

  return (
    <nav
      aria-label="주요 메뉴"
      // 스크롤해도 따라오도록 상단에 붙인다. shrink-0 이 없으면 본문이 길 때
      // 세로 flex 안에서 바 높이가 눌린다.
      className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-1 border-b border-[#edf0f3] bg-white px-3 sm:px-5"
    >
      {ITEMS.map((item) => (
        <RailLink
          key={item.href}
          item={item}
          active={item.match.some((prefix) => pathname.startsWith(prefix))}
        />
      ))}
      <div className="ml-auto flex shrink-0 items-center">
        <AccountSlot loggedIn={loggedIn} />
      </div>
    </nav>
  );
}

function RailLink({ item, active }: { item: Item; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex h-9 items-center gap-1.5 rounded-[12px] px-2.5 transition ${
        active
          ? "bg-[#e8f3ff] text-[#3182f6]"
          : "text-[#8b95a1] hover:bg-[#f2f4f6] hover:text-[#4e5968]"
      }`}
    >
      <RailIcon name={item.icon} />
      <span className="text-[13px] font-black leading-none">{item.label}</span>
    </Link>
  );
}

type IconName = "home" | "school" | "chat" | "phone";

/**
 * 유니코드 글리프(⌂ ◎ ▢)는 글자마다 실제 크기가 제각각이라 셋을 나란히 두면
 * 하나만 작아 보인다. 획 굵기와 상자 크기를 우리가 정하려고 SVG 로 그린다.
 */
function RailIcon({ name }: { name: IconName }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "home" && (
        <>
          <path d="M4 10.5 12 4l8 6.5" />
          <path d="M6 10v9.5h12V10" />
        </>
      )}
      {name === "school" && (
        <>
          <path d="M12 4 2.5 9 12 14l9.5-5L12 4Z" />
          <path d="M6.5 11.4V16c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-4.6" />
        </>
      )}
      {name === "chat" && (
        <>
          <path d="M4 5.5h12.5v9H9l-5 3.5v-3.5H4v-9Z" />
          <path d="M20 9v9h-1.5v3l-4-3" />
        </>
      )}
      {name === "phone" && (
        <>
          <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
          <path d="M10.5 18.5h3" />
        </>
      )}
    </svg>
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
        className="flex h-9 items-center rounded-[12px] px-3 text-[13px] font-black text-[#3182f6] transition hover:bg-[#f2f4f6]"
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
      className="flex h-9 w-9 items-center justify-center rounded-full bg-[#191f28] text-[13px] font-black text-white"
    >
      {initial}
    </Link>
  );
}

/** 상단 바 + 본문을 세로로 쌓는 껍데기. 입시·커뮤니티가 쓴다. */
export function RailLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-[#f8fbff]">
      <AppRail />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
