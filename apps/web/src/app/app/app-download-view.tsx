import Link from "next/link";
import Image from "next/image";

import wordmark from "../../assets/acttub-wordmark.png";
import { APP_HIGHLIGHTS } from "../../features/app-download/app-highlights";
import { StoreBadges } from "../../features/app-download/store-badges";

// 인스타그램 프로필 링크가 이 주소를 가리킨다. 폰 세로 화면 첫 화면 안에서 배지까지 닿는
// 것이 이 페이지의 유일한 임무라 위쪽에 다른 것을 끼우지 않는다.
//
// 랜딩과 달리 로그인 주소를 바로 걸지 않는다. 랜딩은 로그인된 사람을 /home 으로 먼저
// 보내지만 이 페이지는 로그인 여부와 상관없이 열리고, /login 은 이미 로그인한 사람을
// 돌려보내지 않아 로그인 화면에서 막힌다. /practice/new 로 보내면 useRequireAuth 가
// 로그아웃 상태일 때만 next 를 실어 로그인으로 넘긴다.
const practiceHref = "/practice/new";

export default function AppDownloadView() {
  return (
    <>
      <main className="min-h-dvh bg-white text-[#191f28]">
        <header className="border-b border-[#edf0f3]/80 px-5">
          <nav className="mx-auto flex h-16 max-w-5xl items-center justify-between">
            <Link href="/" aria-label="Acttub 홈" className="shrink-0">
              <Image src={wordmark} alt="Acttub" priority className="h-6 w-auto" />
            </Link>
            <Link
              href={practiceHref}
              prefetch={false}
              className="text-sm font-bold text-[#4e5968] transition hover:text-[#191f28]"
            >
              웹에서 쓰기
            </Link>
          </nav>
        </header>

        <section className="bg-[linear-gradient(180deg,#eaf6ff_0%,#f8fbff_62%,#ffffff_100%)] px-5 pb-20 pt-16 text-center sm:pt-20">
          <div className="mx-auto flex max-w-3xl flex-col items-center">
            <p className="rounded-full bg-[#3182f6] px-4 py-2 text-sm font-black text-white shadow-sm">
              앱 출시
            </p>
            <h1 className="mt-7 text-4xl font-black leading-[1.1] tracking-[-0.06em] sm:text-6xl">
              acttub 앱이
              <br />
              나왔어요
            </h1>
            <p className="mt-6 text-lg font-semibold leading-8 text-[#4e5968]">
              App Store와 Google Play에서 받을 수 있어요.
              <br className="hidden sm:block" /> 연습실에서 찍은 영상을 폰에서
              그대로 올려요.
            </p>
            <StoreBadges
              surface="app_page"
              size="lg"
              className="mt-9 justify-center"
            />
          </div>
        </section>

        <section className="px-5 pb-24">
          <div className="mx-auto grid max-w-3xl gap-4">
            {APP_HIGHLIGHTS.map((item) => (
              <article key={item.title} className="rounded-[32px] bg-[#f2f4f6] p-7">
                <h2 className="text-2xl font-black tracking-[-0.04em]">
                  {item.title}
                </h2>
                <p className="mt-3 text-base font-semibold leading-7 text-[#4e5968]">
                  {item.body}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="bg-[#191f28] px-5 py-20 text-white">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-7 text-center">
            <h2 className="text-3xl font-black leading-tight tracking-[-0.05em] sm:text-4xl">
              지금 폰이 아니라면
              <br />웹에서 먼저 해도 돼요
            </h2>
            <Link
              href={practiceHref}
              prefetch={false}
              className="inline-flex h-14 items-center justify-center rounded-2xl bg-white px-8 text-base font-black text-[#191f28] transition hover:-translate-y-0.5"
            >
              웹에서 시작하기
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#edf0f3] bg-white px-5 py-12">
        <nav className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-6 gap-y-3 text-sm font-bold text-[#6b7684]">
          <Link href="/" className="transition hover:text-[#191f28]">
            acttub 홈
          </Link>
          <Link href="/terms" className="transition hover:text-[#191f28]">
            안전 약속
          </Link>
          <a
            href="https://www.instagram.com/acttub_com/"
            target="_blank"
            rel="noreferrer"
            className="transition hover:text-[#191f28]"
          >
            인스타그램
          </a>
          <a
            href="mailto:acttub0527@gmail.com"
            className="transition hover:text-[#191f28]"
          >
            acttub0527@gmail.com
          </a>
        </nav>
      </footer>
    </>
  );
}
