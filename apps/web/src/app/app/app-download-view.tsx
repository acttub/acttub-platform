"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import wordmark from "../../assets/acttub-wordmark.png";
import { StoreBadges } from "../../features/app-download/store-badges";

import "./app-download.css";

// 인스타그램 프로필 링크와 네이버 검색광고가 이 주소를 가리킨다. 폰 세로 화면 첫 화면 안에서
// 배지까지 닿는 것이 이 페이지의 임무라 제목과 배지 위에 다른 것을 끼우지 않는다.
//
// 검색광고로 오는 사람은 액터브를 처음 본다. 첫 화면에서 리딩 시연이 저절로 돌아가
// "상대 대사는 AI가 읽고 내 대사는 가린다"는 것을 글보다 먼저 보여 준다(SOMA-635).
// 움직임은 제품이 어떻게 돌아가는지 보여 주는 데만 쓰고, 움직임 줄이기 설정이면 멈춘다.
//
// 웹에는 로그인이 없다. 연습 화면은 누구에게나 바로 열린다(account.guest).
const practiceHref = "/practice/new";

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduce(onChange: () => void) {
  const media = window.matchMedia(REDUCE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduce,
    () => window.matchMedia(REDUCE_QUERY).matches,
    () => false,
  );
}

// 시연용으로 직접 쓴 짧은 장면이다. 실제 작품 대사가 아니다.
const HERO_LINES: readonly { them: string; mine: string }[] = [
  { them: "왜 이제야 왔어?", mine: "네가 기다릴 줄 몰랐어." },
  { them: "그럼 왜 돌아온 건데?", mine: "아직 못 한 말이 있어서." },
];

const HERO_CAPTIONS = [
  "01 · 상대 대사를 들어요",
  "02 · 내 대사를 가려요",
  "03 · 막히면 펼쳐 봐요",
  "04 · 다음 대사를 들어요",
] as const;

const HERO_STATUS = [
  "잠시 뒤 내 차례예요",
  "외워서 말해 보세요",
  "확인하고 다시 말해 봐요",
  "외워서 말해 보세요",
] as const;

function HeroDemo() {
  const reduce = useReducedMotion();
  const [scene, setScene] = useState({ phase: 0, pair: 0 });
  const [running, setRunning] = useState(true);
  const autoplay = running && !reduce;

  useEffect(() => {
    if (!autoplay) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      setScene(({ phase, pair }) => {
        const next = (phase + 1) % 4;
        return { phase: next, pair: next === 3 ? 1 - pair : pair };
      });
    }, 1800);
    return () => window.clearInterval(timer);
  }, [autoplay]);

  // 움직임 줄이기면 자동 재생 대신 대사가 펼쳐진 장면에서 시작한다.
  const phase = reduce && running ? 2 : scene.phase;
  const line = HERO_LINES[scene.pair];
  const reading = phase === 0 || phase === 3;
  const revealed = phase === 2;

  const takeOver = (nextPhase: number) => {
    setRunning(false);
    setScene((s) => ({ ...s, phase: nextPhase }));
  };

  const listen = () => {
    takeOver(0);
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(line.them);
      utterance.lang = "ko-KR";
      utterance.rate = 0.85;
      window.speechSynthesis.speak(utterance);
    }
  };

  const toggleLabel = reduce
    ? "다음 장면 보기"
    : running
      ? "Ⅱ 시연 멈추기"
      : "▶ 시연 이어 보기";

  return (
    <div
      className={`adl-demo ${reading ? "is-reading" : ""} ${revealed ? "is-revealed" : ""}`}
      aria-label="대본 리딩 시연"
    >
      <div className="adl-demo-top">
        <span>대사 호흡, 이렇게 맞춰요</span>
        <span className="adl-auto">
          {reduce ? "리딩 시연" : running ? "자동 시연" : "직접 조작 중"}
        </span>
      </div>
      <div className="adl-frame">
        <div className="adl-who">
          상대역 <span className="adl-reading-tag">AI가 읽고 있어요</span>
          <span className="adl-wave" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
        </div>
        <div className="adl-speech">{line.them}</div>
        <div className="adl-mine">
          <div className="adl-who">
            내 대사 <span>{HERO_STATUS[phase]}</span>
          </div>
          <button
            type="button"
            className="adl-hiddenline"
            aria-expanded={revealed}
            onClick={() => takeOver(revealed ? 1 : 2)}
          >
            <span className="adl-hint">내 대사를 가리고 외워 봐요</span>
            <span className="adl-actual">{line.mine}</span>
          </button>
        </div>
      </div>
      <div className="adl-controls">
        <button
          type="button"
          onClick={() => {
            if (reduce) {
              takeOver((phase + 1) % 4);
              return;
            }
            setRunning((r) => !r);
          }}
        >
          {toggleLabel}
        </button>
        <button type="button" onClick={listen}>
          상대 대사 듣기 ↗
        </button>
        <span className="adl-caption">{HERO_CAPTIONS[phase]}</span>
      </div>
      <div className="adl-track" aria-hidden="true">
        {HERO_CAPTIONS.map((caption, i) => (
          <i key={caption} className={i === phase ? "is-on" : ""} />
        ))}
      </div>
    </div>
  );
}

function useInView<T extends Element>(threshold = 0.25) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);

  return [ref, inView] as const;
}

const REEL_LINES: readonly { who: string; text: string; mine: boolean }[] = [
  { who: "상대역", text: "왜 이제야 왔어?", mine: false },
  { who: "지우 · 내 대사", text: "네가 기다릴 줄 몰랐어.", mine: true },
  { who: "상대역", text: "그럼 왜 돌아온 건데?", mine: false },
  { who: "지우 · 내 대사", text: "아직 못 한 말이 있어서.", mine: true },
];

function ReadingReel() {
  const reduce = useReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!inView || reduce) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setTick((t) => (t + 1) % 8);
    }, 1600);
    return () => window.clearInterval(timer);
  }, [inView, reduce]);

  const step = reduce ? 3 : tick;
  const activeRow = Math.floor(step / 2);
  const caption =
    step % 4 === 2
      ? "내 대사를 가려요"
      : step % 4 === 3
        ? "내 대사를 펼쳐 봐요"
        : "상대 대사를 읽고 있어요";

  return (
    <div className="adl-reel" ref={ref}>
      <div className="adl-reel-title">
        <span>대본 예시 · 내 역할: 지우</span>
        <span>{caption}</span>
      </div>
      <div
        className="adl-reel-lines"
        style={{
          transform: `translateY(calc(var(--adl-line) * ${-Math.max(0, activeRow - 1)}))`,
        }}
      >
        {REEL_LINES.map((row, i) => (
          <div
            key={row.text}
            className={`adl-reel-line ${row.mine ? "is-mine" : ""} ${i === activeRow ? "is-active" : ""} ${row.mine && i === activeRow && step % 2 === 1 ? "is-open" : ""}`}
          >
            <b>{row.who}</b>
            <p>{row.mine ? <span className="adl-mask">{row.text}</span> : row.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// 운영 코치(v35)의 흐름을 따른 대화 예시: 소리 습관 하나 → 인물의 선택인지 묻기 → 배우의 한 줄.
const COACH_BUBBLES = 4;

function CoachDemo() {
  const reduce = useReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>();
  const [run, setRun] = useState(0);
  const [shown, setShown] = useState({ uploaded: false, count: 0 });

  useEffect(() => {
    if (!inView || reduce) return;
    const timers = [
      window.setTimeout(() => setShown({ uploaded: false, count: 0 }), 0),
      window.setTimeout(() => setShown((s) => ({ ...s, uploaded: true })), 850),
      ...Array.from({ length: COACH_BUBBLES }, (_, i) =>
        window.setTimeout(
          () => setShown((s) => ({ ...s, count: i + 1 })),
          1600 + i * 1250,
        ),
      ),
    ];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [inView, reduce, run]);

  const uploaded = reduce || shown.uploaded;
  const count = reduce ? COACH_BUBBLES : shown.count;
  const visible = (i: number) => (i < count ? "is-visible" : "");

  return (
    <div className={`adl-coach ${uploaded ? "is-uploaded" : ""}`} ref={ref}>
      <div className="adl-upload">
        <div className="adl-video">
          <svg viewBox="0 0 40 52" fill="none" aria-hidden="true">
            <circle cx="20" cy="14" r="8" fill="currentColor" />
            <path
              d="M5 49V39C5 31 12 27 20 27C28 27 35 31 35 39V49"
              fill="currentColor"
            />
          </svg>
        </div>
        <div>
          <span className="adl-upload-name">내 연습 영상</span>
          <small>{uploaded ? "코치와 이야기해요 · 시연" : "영상을 올려요 · 시연"}</small>
        </div>
      </div>
      <div className="adl-chat">
        <div className={`adl-bubble ${visible(0)}`}>
          <span className="adl-bubble-label">코치 · 대화 예시</span>
          대사 끝이 두 번 모두 내려갔어요.
        </div>
        <div className={`adl-bubble ${visible(1)}`}>
          인물의 선택인가요,
          <br />
          평소에도 그런 편인가요?
        </div>
        <div className={`adl-bubble adl-answer ${visible(2)}`}>
          <span>평소에도 그래요.</span>
        </div>
        <div className={`adl-bubble adl-final ${visible(3)}`}>
          <span className="adl-bubble-label">대화 끝에 남는 내 한 줄</span>
          <em>
            나는 마음을 숨길 때
            <br />
            말끝을 내리는 배우다.
          </em>
        </div>
      </div>
      <button type="button" className="adl-replay" onClick={() => setRun((r) => r + 1)}>
        ↻ 대화 다시 보기
      </button>
    </div>
  );
}

const HOW_STEPS = [
  { title: "대본을 넣어요.", body: "연습할 대본을 넣고 내 역할을 골라요." },
  { title: "상대와 맞춰 봐요.", body: "AI가 읽어 주는 상대 대사에 내 대사를 이어 가요." },
  { title: "찍고 돌아봐요.", body: "연습 영상을 올리고 코치와 내 습관을 이야기해요." },
] as const;

const USES = [
  { title: "독백", body: "찍어 둔 영상을 보며 반복되는 습관을 돌아봐요." },
  { title: "입시 자유연기", body: "준비한 장면을 연습하고 나를 담은 한 줄을 남겨요." },
  { title: "오디션·셀프테이프", body: "상대역이 필요한 장면에서 대사를 주고받아 봐요." },
  { title: "대사 외우기", body: "내 대사를 가려 두고 소리 내 말해 봐요." },
] as const;

function StickyBar() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const hero = document.getElementById("adl-hero");
    const end = document.getElementById("download");
    if (!hero || !end || typeof IntersectionObserver === "undefined") return;
    const seen = { hero: true, end: false };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === hero) seen.hero = entry.isIntersecting;
        if (entry.target === end) seen.end = entry.isIntersecting;
      }
      setShown(!seen.hero && !seen.end);
    });
    observer.observe(hero);
    observer.observe(end);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={`adl-sticky ${shown ? "is-shown" : ""}`} aria-hidden={!shown}>
      <span>오늘도 혼자 연습하나요?</span>
      <a href="#download" tabIndex={shown ? 0 : -1}>
        무료로 시작해요 ↗
      </a>
    </div>
  );
}

export default function AppDownloadView() {
  return (
    <div className="adl">
      <header className="adl-header">
        <Link href="/" aria-label="Acttub 홈" className="shrink-0">
          <Image src={wordmark} alt="Acttub" priority className="h-6 w-auto" />
        </Link>
        <Link href={practiceHref} prefetch={false}>
          웹에서 바로 연습 ↗
        </Link>
      </header>

      <main>
        <div className="adl-hero adl-wrap" id="adl-hero">
          <div>
            <p className="adl-eyebrow">혼자 하는 연기 연습, 액터브</p>
            <h1>
              혼자여도,<em>대사는 오가요.</em>
            </h1>
            <p className="adl-sub">
              상대 대사는 AI가 읽어 줘요.
              <br />
              내 대사는 가리고, 호흡을 맞춰 봐요.
            </p>
            <StoreBadges surface="app_page" size="md" />
            <p className="adl-note">무료로 연습해요 · iOS / Android</p>
          </div>
          <HeroDemo />
        </div>

        <section className="adl-section">
          <div className="adl-wrap adl-split">
            <div>
              <p className="adl-label">01 / 대본 리딩</p>
              <h2>
                상대 대사는 듣고,
                <br />
                내 대사는 가려요.
              </h2>
              <p className="adl-copy">
                대본을 넣고 내 역할을 골라요.
                <br />
                상대의 말을 듣고, 외운 대사를 꺼내 봐요.
                <br />
                막히면 내 대사를 펼쳐 볼 수 있어요.
              </p>
              <Link href={practiceHref} prefetch={false} className="adl-web-link">
                설치·가입 없이 직접 연습해요 ↗
              </Link>
            </div>
            <div>
              <ReadingReel />
              <p className="adl-mini-note">
                상대역의 차례와 내 차례가 번갈아 이어져요. 시연용 대본이에요.
              </p>
            </div>
          </div>
        </section>

        <section className="adl-section adl-coach-section">
          <div className="adl-wrap adl-split">
            <div>
              <p className="adl-label">02 / 연기 코칭</p>
              <h2>
                자꾸 반복되는
                <br />
                내 습관이 보이나요?
              </h2>
              <p className="adl-copy">
                연습 영상을 올리면 코치가 습관 하나를 짚어 줘요. 인물의 선택인지, 평소
                버릇인지 이야기하다 보면 나를 담은 한 줄이 남아요.
              </p>
            </div>
            <CoachDemo />
          </div>
        </section>

        <section className="adl-section adl-how">
          <div className="adl-wrap">
            <p className="adl-label">연습은 이렇게 이어져요</p>
            <h2>
              대본부터,
              <br />
              내 연기를 돌아보기까지.
            </h2>
            <div className="adl-how-grid">
              {HOW_STEPS.map((item, i) => (
                <article key={item.title}>
                  <strong>{i + 1}</strong>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="adl-section">
          <div className="adl-wrap">
            <p className="adl-label">오늘은 어떤 연습을 하나요?</p>
            <h2>
              혼자 연습하는 날에
              <br />
              꺼내 써요.
            </h2>
            <div className="adl-uses">
              {USES.map((item, i) => (
                <div className="adl-use" key={item.title}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="adl-section adl-founder">
          <div className="adl-wrap">
            <p className="adl-label">배우가 직접 만들었어요</p>
            <h2>
              대사 호흡이라도
              <br />
              맞춰줄 분이 필요해서요.
            </h2>
            <p>
              연극 무대에 서는 배우가 만들었어요.
              <br />
              함께 연습할 친구가 없는 날에도,
              <br />
              혼자 연습을 이어 갈 수 있도록요.
            </p>
          </div>
        </section>

        <section className="adl-section adl-faq">
          <div className="adl-wrap">
            <p className="adl-label">자주 묻는 질문</p>
            <h2>궁금한 점이 있나요?</h2>
            <details>
              <summary>무료로 쓸 수 있나요?</summary>
              <p>네, 무료로 연습할 수 있어요. iOS와 Android 앱이 있어요.</p>
            </details>
            <details>
              <summary>설치하지 않고도 쓸 수 있나요?</summary>
              <p>
                네, 웹에서는 설치·가입 없이 바로 연습할 수 있어요.{" "}
                <Link href={practiceHref} prefetch={false}>
                  웹에서 연습해 보세요.
                </Link>
              </p>
            </details>
            <details>
              <summary>올린 영상은 어떻게 쓰이나요?</summary>
              <p>
                영상 관련 안내는 <Link href="/terms">안전 약속</Link>에서 확인할 수 있어요.
              </p>
            </details>
          </div>
        </section>

        <section className="adl-section adl-final-section" id="download">
          <div className="adl-wrap">
            <p className="adl-label">오늘 연습, 액터브와 함께해요</p>
            <h2>
              이제 내 대사를
              <br />
              꺼내 볼까요?
            </h2>
            <StoreBadges surface="app_page" size="md" className="justify-center" />
            <Link href={practiceHref} prefetch={false} className="adl-web-link">
              설치·가입 없이 웹에서 연습해요 ↗
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#edf0f3] bg-white px-5 pt-12 pb-28 sm:pb-12">
        <nav className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-6 gap-y-3 text-sm font-bold text-[#6b7684]">
          <Link href="/" className="transition hover:text-[#191f28]">
            acttub 홈
          </Link>
          <Link href="/terms" className="transition hover:text-[#191f28]">
            안전 약속
          </Link>
          <Link href="/ai-acting-coaching" className="transition hover:text-[#191f28]">
            AI 연기 코칭
          </Link>
          <Link href="/acting-coaching" className="transition hover:text-[#191f28]">
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
          <a href="mailto:acttub0527@gmail.com" className="transition hover:text-[#191f28]">
            acttub0527@gmail.com
          </a>
        </nav>
      </footer>

      <StickyBar />
    </div>
  );
}
