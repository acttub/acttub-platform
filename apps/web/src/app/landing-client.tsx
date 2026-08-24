"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import wordmark from "../assets/acttub-wordmark.png";
import { isLoggedIn } from "../lib/auth/token-store";
import { APP_HIGHLIGHTS } from "../features/app-download/app-highlights";
import { StoreBadges } from "../features/app-download/store-badges";

const productFlow = [
  {
    label: "입력",
    title: "연기 영상 업로드",
    description: "MP4/MOV 영상과 장면의 상황, 인물, 숨은 의도를 적어요.",
  },
  {
    label: "질문",
    title: "확인된 단서로 질문",
    description: "보이는 관찰을 먼저 확인하고, 단정하지 않는 질문으로 이어가요.",
  },
  {
    label: "결과",
    title: "내 연습 노트 완성",
    description: "답변을 모아 다음 테이크에서 붙잡을 한 문장으로 정리해요.",
  },
];

const heroAssurances = ["무료", "Google·Apple 로그인", "영상은 언제든 삭제"];

const heroConfirmChoices: [string, boolean][] = [
  ["맞아요", true],
  ["아니에요", false],
  ["잘 모르겠어요", false],
];

const outcomes = [
  ["놓친 순간", "영상 속 작은 멈춤과 반응을 다시 보게 해요."],
  ["장면 의도", "인물의 목표와 상대에게 기대한 것을 말로 붙잡아요."],
  ["다음 액션", "다음 테이크에서 바로 시도할 연습 문장을 남겨요."],
];

const practiceLoginHref = "/login?next=/practice/new";

export default function LandingClient() {
  const router = useRouter();

  useEffect(() => {
    if (isLoggedIn()) router.replace("/home");
  }, [router]);

  return (
    <>
      <main className="min-h-dvh overflow-hidden bg-white text-[#191f28]">
        <header className="sticky top-0 z-20 border-b border-[#edf0f3]/80 bg-white/90 px-5 backdrop-blur-xl">
          <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between">
            <Link href="/" aria-label="Acttub 홈" className="shrink-0">
              <Image src={wordmark} alt="Acttub" priority className="h-6 w-auto" />
            </Link>
            <div className="flex items-center gap-8">
              <div className="hidden items-center gap-8 text-sm font-semibold text-[#4e5968] sm:flex">
                <a href="#flow" className="transition hover:text-[#191f28]">
                  서비스 흐름
                </a>
                <a href="#result" className="transition hover:text-[#191f28]">
                  결과물
                </a>
                <Link href="/terms" className="transition hover:text-[#191f28]">
                  안전 약속
                </Link>
              </div>
              {/* 앱은 폰에서 받는다 — 이 버튼만은 좁은 화면에서도 접지 않는다. */}
              <Link
                href="/app"
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-[#3182f6] px-4 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-[#1b64da]"
              >
                앱 다운로드
              </Link>
            </div>
          </nav>
        </header>

        <section className="relative overflow-hidden break-keep bg-[linear-gradient(180deg,#eaf6ff_0%,#f8fbff_58%,#ffffff_100%)] px-5 pb-16 pt-14 lg:pb-20 lg:pt-[4.25rem]">
          <div className="absolute left-1/2 top-12 h-80 w-80 -translate-x-1/2 rounded-full bg-[#3182f6]/[0.16] blur-3xl" />

          <div className="relative mx-auto grid max-w-6xl items-center gap-11 lg:grid-cols-[minmax(0,1.04fr)_minmax(340px,0.96fr)] lg:gap-20">
            <div>
              <p className="text-base font-black text-[#3182f6]">
                질문으로 다시 보는 연기 연습
              </p>
              <h1 className="mt-[1.1rem] text-4xl font-black leading-[1.06] tracking-[-0.065em] sm:text-5xl lg:text-6xl">
                연기 영상 하나 올려보세요.
              </h1>
              <p className="mt-6 text-lg font-semibold leading-[1.8] text-[#4e5968]">
                AI가 막힌 지점을 같이 찾아드립니다.
              </p>

              <div className="mt-[2.1rem] flex flex-col gap-4 lg:flex-row lg:items-center">
                <Link
                  href={practiceLoginHref}
                  prefetch={false}
                  className="inline-flex h-14 items-center justify-center gap-2.5 rounded-2xl bg-[#191f28] px-[1.6rem] text-base font-black text-white shadow-[0_14px_34px_rgba(25,31,40,0.18)] transition hover:-translate-y-0.5 hover:bg-[#333d4b]"
                >
                  내 영상으로 질문 받아보기
                  <span aria-hidden="true">→</span>
                </Link>
                <a
                  href="#result"
                  className="inline-flex h-14 items-center justify-center rounded-2xl bg-white px-5 text-base font-black text-[#4e5968] shadow-[0_2px_10px_rgba(25,31,40,0.08)] transition hover:-translate-y-0.5 hover:text-[#191f28]"
                >
                  예시 결과 먼저 보기
                </a>
              </div>

              <ul className="mt-[1.4rem] flex flex-col gap-2 text-sm font-bold text-[#8b95a1] lg:flex-row lg:flex-wrap lg:gap-[1.1rem]">
                {heroAssurances.map((item) => (
                  <li key={item} className="flex items-center gap-1.5">
                    <CheckIcon />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* 질문의 근거가 영상 몇 초인지 보이게 한다 — 관찰만 텍스트로 띄우면
                AI가 지어낸 문장처럼 읽힌다. 타임라인 핀과 00:14 배지가 같은 지점을 가리킨다. */}
            <article
              className="relative rounded-[30px] bg-white p-4 shadow-[0_34px_100px_rgba(25,31,40,0.12)] lg:p-5"
              aria-label="Acttub 대화 예시"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black text-[#8b95a1]">오늘 연습한 장면</p>
                  <h2 className="mt-1 text-lg font-black tracking-[-0.035em] lg:text-xl">
                    오디션 독백 · take 03
                  </h2>
                </div>
                <span className="shrink-0 rounded-full bg-[#e8f3ff] px-2.5 py-1 text-xs font-black text-[#1b64da]">
                  대화 마침
                </span>
              </div>

              <div className="relative mt-[0.9rem] aspect-[21/9] overflow-hidden rounded-[20px] bg-[linear-gradient(135deg,#4e5968,#dbeafe)] p-3">
                <span className="inline-block rounded-full bg-white/90 px-2.5 py-1 text-xs font-black text-[#3182f6]">
                  take_03.mov
                </span>
                <span
                  aria-hidden="true"
                  className="absolute left-1/2 top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/85 shadow-[0_6px_20px_rgba(25,31,40,0.19)]"
                >
                  <span className="ml-0.5 border-y-[7px] border-l-[11px] border-y-transparent border-l-[#191f28]" />
                </span>
              </div>

              <div className="mt-5 flex items-center gap-2.5 text-xs font-black tabular-nums text-[#8b95a1]">
                <span>00:00</span>
                <span className="relative h-1.5 flex-1 rounded-full bg-[#e5e8eb]">
                  <span className="absolute inset-y-0 left-0 w-[19.4%] rounded-full bg-[#3182f6]" />
                  <span className="absolute left-[19.4%] top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3.5px] border-[#3182f6] bg-white shadow-[0_2px_6px_rgba(25,31,40,0.2)]">
                    <span className="absolute bottom-[155%] left-1/2 -translate-x-1/2 whitespace-nowrap text-[0.68rem] font-black text-[#3182f6]">
                      00:14
                    </span>
                  </span>
                </span>
                <span>01:12</span>
              </div>

              <div className="mt-3 rounded-[20px] bg-[#f2f4f6] p-4">
                <p className="text-xs font-black text-[#8b95a1]">Acttub이 본 것</p>
                <p className="mt-1.5 font-bold leading-relaxed">
                  <span className="mr-1.5 inline-block rounded-[7px] bg-[#191f28] px-1.5 py-0.5 text-xs font-black tabular-nums text-white">
                    00:14
                  </span>
                  상대의 말을 들은 뒤 숨을 고르는 순간이 보여요. 맞나요?
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {heroConfirmChoices.map(([label, picked]) => (
                    <span
                      key={label}
                      className={`rounded-full px-3 py-1.5 text-sm font-extrabold ${
                        picked
                          ? "bg-[#3182f6] text-white"
                          : "bg-white text-[#8b95a1] shadow-[inset_0_0_0_1.5px_#e5e8eb]"
                      }`}
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-3 rounded-[20px] bg-[#e8f3ff] p-4">
                <p className="text-xs font-black text-[#8b95a1]">Acttub의 질문</p>
                <p className="mt-1.5 font-bold leading-relaxed">
                  그 침묵에서 인물은 무엇을 얻고 싶었나요?
                </p>
              </div>

              <div className="mt-3 rounded-[20px] bg-[#191f28] p-4 text-white">
                <p className="text-xs font-black text-[#c6d3e3]">
                  내가 남긴 문장
                  <span className="ml-1.5 rounded-full bg-white/15 px-2 py-0.5 text-[0.7rem] font-black text-white">
                    배우가 직접 씀
                  </span>
                </p>
                <p className="mt-1.5 text-base font-extrabold leading-normal lg:text-[17px]">
                  “나는 확신보다 확인을 원했다.”
                </p>
                <span className="mt-3 inline-block rounded-full bg-white/[0.12] px-3 py-1.5 text-xs font-extrabold">
                  다음 연습 · 대답 전 2초를 더 듣기
                </span>
              </div>
            </article>
          </div>
        </section>

        <section id="flow" className="bg-[#f9fafb] px-5 py-28 sm:py-36">
          <div className="mx-auto max-w-5xl">
            <p className="text-lg font-black text-[#3182f6]">서비스 흐름</p>
            <h2 className="mt-4 max-w-3xl text-4xl font-black leading-tight tracking-[-0.05em] sm:text-5xl">
              처음 와도 바로 이해되는
              <br />3단계 연기 복기
            </h2>
            <div className="mt-14 grid gap-5 md:grid-cols-3">
              {productFlow.map((item) => (
                <article
                  key={item.label}
                  className="rounded-[32px] bg-white p-7 shadow-[0_18px_50px_rgba(25,31,40,0.06)]"
                >
                  <p className="text-sm font-black text-[#3182f6]">{item.label}</p>
                  <h3 className="mt-8 text-2xl font-black tracking-[-0.04em]">
                    {item.title}
                  </h3>
                  <p className="mt-4 text-base font-semibold leading-7 text-[#6b7684]">
                    {item.description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="result" className="px-5 py-28 sm:py-40">
          <div className="mx-auto grid max-w-5xl gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <p className="text-lg font-black text-[#3182f6]">결과물</p>
              <h2 className="mt-4 text-4xl font-black leading-tight tracking-[-0.05em] sm:text-5xl">
                질문을 넘기면
                <br />연습 노트가 남아요
              </h2>
              <p className="mt-7 text-lg font-semibold leading-8 text-[#4e5968]">
                Acttub은 장면을 단정하지 않아요. 확인한 관찰만 질문의 근거로
                삼고, 마지막 문장은 배우가 직접 선택하게 합니다.
              </p>
              <Link
                href="/terms"
                className="mt-8 inline-flex h-12 items-center justify-center rounded-2xl bg-[#f2f4f6] px-5 text-sm font-black text-[#333d4b] transition hover:bg-[#e5e8eb]"
              >
                안전한 질문 원칙 보기
              </Link>
            </div>
            <div className="grid gap-4">
              {outcomes.map(([title, description]) => (
                <article
                  key={title}
                  className="rounded-[32px] bg-[#f2f4f6] p-7 transition hover:-translate-y-1 hover:bg-[#e8f3ff]"
                >
                  <h3 className="text-3xl font-black tracking-[-0.05em] text-[#191f28]">
                    {title}
                  </h3>
                  <p className="mt-3 text-lg font-bold leading-8 text-[#4e5968]">
                    {description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="app" className="bg-[#f9fafb] px-5 py-28 sm:py-36">
          <div className="mx-auto grid max-w-5xl gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
              <p className="text-lg font-black text-[#3182f6]">앱 출시</p>
              <h2 className="mt-4 text-4xl font-black leading-tight tracking-[-0.05em] sm:text-5xl">
                연습실을 나오기 전에
                <br />폰에서 바로
              </h2>
              <p className="mt-7 text-lg font-semibold leading-8 text-[#4e5968]">
                영상은 어차피 폰으로 찍으니까요. 올리는 것부터 질문에 답하는 것까지
                앱에서 한 번에 끝나요.
              </p>
              <StoreBadges surface="landing_app_section" size="lg" className="mt-9" />
            </div>
            <div className="grid gap-4">
              {APP_HIGHLIGHTS.map((item) => (
                <article key={item.title} className="rounded-[32px] bg-white p-7">
                  <h3 className="text-2xl font-black tracking-[-0.04em]">
                    {item.title}
                  </h3>
                  <p className="mt-3 text-base font-semibold leading-7 text-[#6b7684]">
                    {item.body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#191f28] px-5 py-24 text-white">
          <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-10 md:flex-row md:items-center">
            <div>
              <p className="text-base font-bold text-[#8b95a1]">Ready to practice</p>
              <h2 className="mt-4 text-4xl font-black leading-tight tracking-[-0.05em] sm:text-5xl">
                오늘 찍은 장면으로
                <br />바로 질문을 받아보세요
              </h2>
            </div>
            <Link
              href={practiceLoginHref}
              prefetch={false}
              className="inline-flex h-16 items-center justify-center rounded-2xl bg-white px-8 text-lg font-black text-[#191f28] transition hover:-translate-y-0.5"
            >
              무료로 사용해보기
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#edf0f3] bg-white px-5 py-16">
        <div className="mx-auto flex max-w-5xl flex-col gap-12 md:flex-row md:items-start md:justify-between">
          <div>
            <Image src={wordmark} alt="Acttub" className="h-6 w-auto" />
            <p className="mt-5 max-w-sm text-base font-semibold leading-7 text-[#6b7684]">
              질문으로 다시 보는 연기 연습. 웹에서도, 앱에서도 같은 계정으로
              이어서 해요.
            </p>
            <StoreBadges surface="landing_footer" className="mt-7" />
          </div>
          <nav className="grid gap-4 text-base font-bold text-[#4e5968]">
            <Link href="/app" className="transition hover:text-[#191f28]">
              앱 다운로드
            </Link>
            <a href="#flow" className="transition hover:text-[#191f28]">
              서비스 흐름
            </a>
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
        </div>
      </footer>
    </>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="#3182f6"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}
