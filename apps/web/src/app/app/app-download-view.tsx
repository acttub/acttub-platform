import Link from "next/link";
import Image from "next/image";

import wordmark from "../../assets/acttub-wordmark.png";
import { StoreBadges } from "../../features/app-download/store-badges";

// 인스타그램 프로필 링크와 네이버 검색광고가 이 주소를 가리킨다. 폰 세로 화면 첫 화면 안에서
// 배지까지 닿는 것이 이 페이지의 임무라 위쪽에 다른 것을 끼우지 않는다.
//
// 검색광고로 오는 사람은 액터브를 처음 본다. 그래서 첫 화면 문장은 "앱이 나왔다"가 아니라
// 이 앱이 무엇을 해 주는지를 광고 문구와 같은 말로 적는다(SOMA-635).
//
// 웹에는 로그인이 없다. 연습 화면은 누구에게나 바로 열린다(account.guest).
const practiceHref = "/practice/new";

// 이 페이지 전용 카드. 홈과 같이 쓰는 APP_HIGHLIGHTS(웹과 앱의 차이)는 이미 액터브를 아는
// 사람을 위한 문장이라, 처음 온 사람에게는 앱이 하는 일을 먼저 보여 준다.
const APP_PAGE_HIGHLIGHTS: readonly { title: string; body: string }[] = [
  {
    title: "상대 대사는 AI가 읽어요",
    body: "대본만 넣으면 상대역 대사를 AI가 소리 내 읽어 줘요. 내 대사는 가려 두고 외워요.",
  },
  {
    title: "영상을 올리면 코치가 질문해요",
    body: "연습 영상을 보고 내가 자주 하는 연기 습관을 짚어 줘요.",
  },
  {
    title: "찍은 자리에서 바로",
    body: "연습실에서 찍은 영상을 컴퓨터로 옮기지 않고 폰에서 그대로 올려요.",
  },
];

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
              무료 · iOS · Android
            </p>
            <h1 className="mt-7 text-4xl font-black leading-[1.1] tracking-[-0.06em] sm:text-6xl">
              혼자 하는 연기 연습,
              <br />
              상대역은 AI가
            </h1>
            <p className="mt-6 text-lg font-semibold leading-8 text-[#4e5968]">
              대본을 넣으면 상대 대사는 AI가 읽어 주고,
              <br className="hidden sm:block" /> 연기 영상을 올리면 AI 코치가
              질문해요.
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
            {APP_PAGE_HIGHLIGHTS.map((item) => (
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
          <Link
            href="/ai-acting-coaching"
            className="transition hover:text-[#191f28]"
          >
            AI 연기 코칭
          </Link>
          <Link
            href="/acting-coaching"
            className="transition hover:text-[#191f28]"
          >
            연기 코칭 안내
          </Link>
          <Link href="/guide" className="transition hover:text-[#191f28]">
            연기 연습 가이드
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
