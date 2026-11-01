import Link from "next/link";
import type { ComponentProps } from "react";

type SiteLinkProps = ComponentProps<typeof Link>;

/** 리딩 화면은 교차 출처 격리(COOP·COEP) 헤더가 붙은 문서로 열려야 한다(next.config). */
export function needsDocumentNavigation(href: SiteLinkProps["href"]): boolean {
  const path = typeof href === "string" ? href : (href.pathname ?? "");
  return path === "/reading" || path.startsWith("/reading/") || path.startsWith("/reading?");
}

/**
 * 사이트 안 링크. 리딩으로 가는 링크만 일반 문서 이동(<a>)으로 연다 — 라우터 안 이동으로 들어가면 문서가 격리되지
 * 않아 브라우저 음성 합성이 한 줄(스레드 1개)로만 돌고, 이동이 끝나지 않은 채 멈춰 보일 수 있다(SOMA-834, 2026-11-01).
 * 나머지는 next/link 그대로다.
 */
export function SiteLink({ href, prefetch, replace, scroll, shallow, passHref, legacyBehavior, locale, onNavigate, ...rest }: SiteLinkProps) {
  if (needsDocumentNavigation(href)) {
    const url = typeof href === "string" ? href : `${href.pathname ?? ""}${href.search ?? ""}${href.hash ?? ""}`;
    return <a href={url} {...rest} />;
  }
  return <Link href={href} prefetch={prefetch} replace={replace} scroll={scroll} shallow={shallow} passHref={passHref} legacyBehavior={legacyBehavior} locale={locale} onNavigate={onNavigate} {...rest} />;
}
