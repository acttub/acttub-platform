"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import wordmark from "@/assets/acttub-wordmark.png";
import { AccountLink } from "@/features/auth/account-link";
import { useAppDownloadHref } from "@/features/app-download/app-download-button";
import { StoreBadges } from "@/features/app-download/store-badges";
import { BusinessInfo } from "@/features/business-info/business-info";

/**
 * 공개 페이지(홈·고객센터·요금)가 함께 쓰는 머리와 바닥(SOMA-834 웹 개편).
 * 웹은 앱 탭을 옮기지 않는다 — 소개(코칭·리딩·챌린지), 요금, 고객센터, 계정, 앱 받기만 둔다.
 */
export const SITE_NAV = [
  { href: "/?intro=1#coaching", label: "연기 코칭" },
  { href: "/?intro=1#reading", label: "대본 리딩" },
  { href: "/?intro=1#challenge", label: "챌린지" },
  { href: "/pricing", label: "요금" },
] as const;

type NavKey = "home" | "help" | "pricing";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4880ee]";
const FOCUS_DARK =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2ebe0]";

/**
 * 머리·바닥 색. 고객센터·요금은 흰 바탕(light), 랜딩은 먹색 무대(dark, SOMA-918)라 흰 띠가 화면을 끊지 않게 한다.
 * 로고는 파란 글자 PNG 한 장이라, 어두운 바탕에서는 밝기 필터로 미색 단색으로 바꾼다.
 */
export type SiteTone = "light" | "dark";

const TONE = {
  light: {
    header: "border-[#edf0f3] bg-white",
    logo: "",
    nav: "text-[#4e5968] hover:text-[#191f28] aria-[current=page]:text-[#191f28]",
    focus: FOCUS,
    weight: "font-semibold",
    account:
      "rounded-[11px] font-bold bg-[#f2f4f6] text-[#333d4b] hover:bg-[#e5e8eb] lg:bg-transparent lg:font-semibold lg:text-[#4e5968] lg:hover:bg-transparent lg:hover:text-[#191f28]",
    cta: "h-11 rounded-[14px] bg-[#4880ee] px-[18px] font-bold text-white hover:bg-[#3268d8]",
    bar: "bg-[#333d4b]",
    menu: "border-[#edf0f3] bg-white",
    menuList: "divide-[#f2f4f6] text-[#333d4b]",
    menuCta: "rounded-[14px] bg-[#4880ee] font-bold text-white",
    footer: "border-[#edf0f3] bg-[#f9fafb]",
    footerText: "text-[#6b7684]",
    footerHead: "font-extrabold text-[#333d4b]",
    footerLink: "text-[#6b7684] hover:text-[#191f28]",
    footerRule: "border-[#e5e8eb]",
  },
  dark: {
    header: "border-[#f2ebe0]/10 bg-[#14110e]",
    logo: "brightness-0 invert opacity-90",
    nav: "text-[#b8ad9e] hover:text-[#f2ebe0] aria-[current=page]:text-[#f2ebe0]",
    focus: FOCUS_DARK,
    weight: "font-medium",
    account:
      "rounded-[10px] font-medium bg-[#f2ebe0]/10 text-[#f2ebe0] hover:bg-[#f2ebe0]/15 lg:bg-transparent lg:text-[#b8ad9e] lg:hover:bg-transparent lg:hover:text-[#f2ebe0]",
    cta: "h-10 rounded-[10px] border border-[#f2ebe0]/30 px-4 font-medium text-[#f2ebe0] hover:border-[#f2ebe0]/70",
    bar: "bg-[#f2ebe0]",
    menu: "border-[#f2ebe0]/10 bg-[#14110e]",
    menuList: "divide-[#f2ebe0]/10 text-[#f2ebe0]",
    menuCta: "rounded-[10px] bg-[#ffa21f] font-semibold text-[#1a140d]",
    footer: "border-[#f2ebe0]/10 bg-[#14110e]",
    footerText: "text-[#a3978a]",
    footerHead: "font-semibold text-[#f2ebe0]",
    footerLink: "text-[#a3978a] hover:text-[#f2ebe0]",
    footerRule: "border-[#f2ebe0]/10",
  },
} as const;

export function SiteHeader({ current = "home", tone = "light" }: { current?: NavKey; tone?: SiteTone }) {
  const [open, setOpen] = useState(false);
  const t = TONE[tone];
  const focus = t.focus;
  const appHref = useAppDownloadHref("landing_header");

  // 흐림(backdrop-blur)은 스크롤할 때마다 뒤를 다시 그려 버벅임의 원인이 돼서 쓰지 않는다.
  return (
    <header className={`sticky top-0 z-30 border-b ${t.header}`}>
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-10 px-5 sm:h-[72px] sm:px-8">
        <Link href="/?intro=1" aria-label="ACTTUB 홈" className={`shrink-0 rounded ${focus}`}>
          <Image src={wordmark} alt="Acttub" priority className={`h-6 w-auto sm:h-7 ${t.logo}`} />
        </Link>
        <nav aria-label="주요 메뉴" className={`hidden items-center gap-7 text-[15px] lg:flex ${t.weight}`}>
          {SITE_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={current === "pricing" && item.href === "/pricing" ? "page" : undefined}
              className={`rounded transition ${t.nav} ${focus}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-5">
          <Link
            href="/help"
            aria-current={current === "help" ? "page" : undefined}
            className={`hidden rounded text-[15px] transition lg:inline ${t.weight} ${t.nav} ${focus}`}
          >
            고객센터
          </Link>
          <AccountLink
            className={`shrink-0 px-3 py-2 text-sm transition lg:px-0 lg:text-[15px] ${t.account} ${focus}`}
          />
          <a
            href={appHref}
            data-app-download="landing_header"
            className={`hidden items-center text-[15px] transition lg:inline-flex ${t.cta} ${focus}`}
          >
            앱에서 시작하기
          </a>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
            onClick={() => setOpen((v) => !v)}
            className={`flex h-10 w-10 flex-col items-center justify-center gap-[5px] rounded-lg lg:hidden ${focus}`}
          >
            <span className={`h-0.5 w-5 rounded ${t.bar}`} />
            <span className={`h-0.5 w-5 rounded ${t.bar}`} />
            <span className={`h-0.5 w-5 rounded ${t.bar}`} />
          </button>
        </div>
      </div>
      {open ? (
        <nav id="site-menu" aria-label="전체 메뉴" className={`border-t px-5 pb-5 pt-2 lg:hidden ${t.menu}`}>
          <ul className={`divide-y text-base font-semibold ${t.menuList}`}>
            {[...SITE_NAV, { href: "/help", label: "고객센터" }].map((item) => (
              <li key={item.href}>
                <Link href={item.href} onClick={() => setOpen(false)} className={`block py-3.5 ${focus}`}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <a
            href={appHref}
            data-app-download="landing_header"
            className={`mt-3 flex h-12 items-center justify-center text-base ${t.menuCta} ${focus}`}
          >
            앱에서 시작하기
          </a>
        </nav>
      ) : null}
    </header>
  );
}

const FOOTER_GROUPS = [
  {
    title: "서비스",
    links: [
      { href: "/?intro=1#coaching", label: "연기 코칭" },
      { href: "/?intro=1#reading", label: "대본 리딩" },
      { href: "/?intro=1#challenge", label: "챌린지" },
      { href: "/admissions", label: "입시·오디션 정보" },
    ],
  },
  {
    title: "이용·결제",
    links: [
      { href: "/pricing", label: "요금" },
      { href: "/refund", label: "해지·환불 정책" },
      { href: "/account", label: "내 계정" },
      { href: "/home", label: "웹에서 해 보기" },
    ],
  },
  {
    title: "고객지원",
    links: [
      { href: "/help#notice", label: "공지" },
      { href: "/help#faq", label: "자주 묻는 질문" },
      { href: "/help/contact", label: "문의하기" },
      { href: "/account#delete", label: "계정 삭제" },
    ],
  },
  {
    title: "정책",
    links: [
      { href: "/terms", label: "이용약관" },
      { href: "/privacy", label: "개인정보 처리방침" },
      { href: "/guide", label: "연기 연습 가이드" },
    ],
  },
] as const;

export function SiteFooter({ showBadges = true, tone = "light" }: { showBadges?: boolean; tone?: SiteTone }) {
  const t = TONE[tone];
  return (
    <footer className={`border-t ${t.footer}`}>
      <div className="mx-auto max-w-[1200px] px-5 pb-10 pt-12 sm:px-8">
        <div className="flex flex-col gap-10 lg:flex-row lg:gap-20">
          <div className="lg:w-[300px]">
            <Image src={wordmark} alt="Acttub" className={`h-6 w-auto ${t.logo}`} />
            <p className={`mt-3 text-sm leading-6 ${t.footerText}`}>혼자 연습하는 배우를 위한 AI 연기 코치</p>
            {showBadges ? <StoreBadges surface="landing_cta" className="mt-4" /> : null}
          </div>
          <div className="grid flex-1 grid-cols-2 gap-8 sm:grid-cols-4">
            {FOOTER_GROUPS.map((group) => (
              <div key={group.title}>
                <h2 className={`text-sm ${t.footerHead}`}>{group.title}</h2>
                <ul className="mt-3 space-y-2.5">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className={`rounded text-sm transition ${t.footerLink} ${t.focus}`}>
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className={`mt-10 border-t pt-6 ${t.footerRule}`}>
          <BusinessInfo tone={tone} />
        </div>
      </div>
    </footer>
  );
}
