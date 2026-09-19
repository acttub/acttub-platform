"use client";

import Image from "next/image";
import Link from "next/link";
import { useSyncExternalStore } from "react";

import wordmark from "@/assets/acttub-wordmark.png";
import type { PublicPortfolio } from "@/lib/api/v2/public-portfolio";
import { useResource } from "@/lib/react/use-resource";

import {
  PORTFOLIO_FAILED_COPY,
  PORTFOLIO_NOT_FOUND_COPY,
  creditKindLabel,
  loadPortfolioPage,
  portfolioFacts,
  portfolioPhotoUrls,
} from "./public-portfolio";

const subscribeToNothing = () => () => undefined;

/**
 * 포트폴리오 공개 페이지(account.portfolio, 결정 I-8). 배우가 공유 링크를 켠 동안만 열리고,
 * 링크를 아는 사람이 로그인 없이 본다. 연습·분석·챌린지는 여기 없다.
 *
 * 이 컴포넌트는 slug 를 모른 채 한 번만 프리렌더된다. 주소(/p/<slug>)의 slug 는 브라우저에서
 * 읽는다 — rewrites 로 서빙되는 정적 페이지에서 usePathname 은 프리렌더 때의 값(/p)과
 * 브라우저의 값이 달라 하이드레이션이 어긋난다. 그래서 서버 스냅샷을 따로 준다.
 */
export function PublicPortfolioPage() {
  const pathname = useSyncExternalStore(
    subscribeToNothing,
    () => window.location.pathname,
    () => null,
  );
  const page = useResource(
    pathname,
    (key, signal) => loadPortfolioPage(key, signal),
    PORTFOLIO_FAILED_COPY.body,
  );

  if (page.state === "failed") {
    return <PortfolioNotice title={PORTFOLIO_FAILED_COPY.title} body={page.message} />;
  }
  if (page.state !== "ready") return <PortfolioShell aria-busy="true" />;
  if (page.data.kind === "notFound") {
    return (
      <PortfolioNotice
        title={PORTFOLIO_NOT_FOUND_COPY.title}
        body={PORTFOLIO_NOT_FOUND_COPY.body}
      />
    );
  }
  return <PortfolioView portfolio={page.data.portfolio} />;
}

function PortfolioShell({
  children,
  ...rest
}: {
  children?: React.ReactNode;
  "aria-busy"?: "true";
}) {
  return (
    <div className="min-h-dvh bg-[#f2f4f6] text-[#191f28]" {...rest}>
      <header className="border-b border-[#edf0f3] bg-white px-5">
        <nav className="mx-auto flex h-14 max-w-2xl items-center">
          <Link href="/" aria-label="Acttub 홈" className="shrink-0">
            <Image src={wordmark} alt="Acttub" className="h-5 w-auto" />
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}

function PortfolioNotice({ title, body }: { title: string; body: string }) {
  return (
    <PortfolioShell>
      <main className="mx-auto w-full max-w-2xl px-5 py-16">
        <section className="rounded-[28px] bg-white p-7 sm:p-10">
          <h1 className="text-2xl font-black tracking-[-0.04em] sm:text-3xl">{title}</h1>
          <p className="mt-4 text-base font-semibold leading-7 text-[#4e5968]">{body}</p>
        </section>
      </main>
    </PortfolioShell>
  );
}

function PortfolioView({ portfolio }: { portfolio: PublicPortfolio }) {
  const facts = portfolioFacts(portfolio);
  const photoUrls = portfolioPhotoUrls(portfolio);

  return (
    <PortfolioShell>
      <main className="mx-auto w-full max-w-2xl px-5 py-8 sm:py-12">
        <section className="rounded-[28px] bg-white p-6 sm:p-9">
          <div className="flex items-center gap-5">
            {portfolio.photo_url ? (
              <PortfolioImage
                src={portfolio.photo_url}
                alt={`${portfolio.name} 프로필 사진`}
                className="h-24 w-24 shrink-0 rounded-full object-cover sm:h-28 sm:w-28"
              />
            ) : null}
            <div className="min-w-0">
              <h1 className="break-words text-[28px] font-black tracking-[-0.04em] sm:text-4xl">
                {portfolio.name}
              </h1>
              <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold text-[#4e5968]">
                {facts.map((fact) => (
                  <div key={fact.label} className="flex gap-1.5">
                    <dt className="text-[#8b95a1]">{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          {portfolio.intro ? (
            <p className="mt-7 whitespace-pre-wrap break-words text-base leading-7 text-[#333d4b]">
              {portfolio.intro}
            </p>
          ) : null}
        </section>

        {portfolio.credits.length > 0 ? (
          <section className="mt-4 rounded-[28px] bg-white p-6 sm:p-9">
            <h2 className="text-lg font-black tracking-[-0.03em]">경력</h2>
            <ul className="mt-4 divide-y divide-[#f2f4f6]">
              {portfolio.credits.map((credit, index) => (
                <li key={index} className="flex items-baseline gap-4 py-3.5">
                  <span className="w-12 shrink-0 text-sm font-bold text-[#8b95a1]">
                    {credit.year}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-base font-bold">
                      {credit.title}
                    </span>
                    <span className="mt-0.5 block break-words text-sm font-semibold text-[#6b7684]">
                      {credit.role} 역
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-[#f2f4f6] px-2.5 py-1 text-xs font-bold text-[#4e5968]">
                    {creditKindLabel(credit.kind)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {photoUrls.length > 0 ? (
          <section className="mt-4 rounded-[28px] bg-white p-6 sm:p-9">
            <h2 className="text-lg font-black tracking-[-0.03em]">사진</h2>
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photoUrls.map((url, index) => (
                <li key={url}>
                  <PortfolioImage
                    src={url}
                    alt={`${portfolio.name} 사진 ${index + 1}`}
                    className="aspect-[3/4] w-full rounded-2xl object-cover"
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </PortfolioShell>
  );
}

/**
 * 배우가 올린 사진은 오브젝트 스토리지의 주소로 온다. 그 호스트는 빌드 때 정해져 있지 않아
 * next/image 의 remotePatterns 에 적을 수 없다(이미지 최적화도 쓰지 않는다 — next.config.ts).
 * referrer 를 보내지 않는다 — 이 페이지의 주소가 곧 링크를 아는 사람만 여는 열쇠다.
 */
function PortfolioImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 위 주석: 호스트를 빌드 때 모른다
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={className}
    />
  );
}
