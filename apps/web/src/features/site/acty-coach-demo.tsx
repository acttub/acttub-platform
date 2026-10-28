"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * 랜딩 B안 첫 화면(SOMA-918). 코치 액티가 연기 영상을 보고 질문하고, 배우가 답하고, 다음 테이크에서 해 볼 것이
 * 남는 한 장면을 휴대폰 안에서 짧게 되풀이한다. 휴대폰 화면은 스크린샷이 아니라 실제 앱 코칭 화면(shot-coach.jpg)의
 * 색·모양을 따라 HTML 로 다시 그렸다. 시연용으로 직접 쓴 장면이며 사람 사진은 쓰지 않는다.
 *
 * - 움직이는 영역은 aria-hidden 이다. 같은 내용을 스크린리더용 문장으로 한 번 읽어 준다.
 * - 움직임 줄이기 설정이면 마지막 장면(질문·답·다음 테이크 카드)을 멈춘 채 보인다. 스크립트 전에도 CSS 가 같은 상태를 만든다.
 * - 화면 밖이거나 탭이 숨으면 시계와 CSS 애니메이션을 함께 멈춘다.
 * - 모든 요소는 크기·자리를 미리 잡아 두고 투명도·transform 만 바꾼다(레이아웃 흔들림 없음).
 */

export const DEMO_SCENE = "카페에서 이별을 말하는 장면";
export const DEMO_QUESTION = "「우리 그만하자」 뒤에 2초 멈췄어요. 그 2초 동안 무엇을 결심했을까요?";
export const DEMO_ANSWER = "헤어지기로 마음먹었던 것 같아요.";
export const DEMO_NEXT_TAKE = "「우리 그만하자」 전 2초, 결심을 눈으로 먼저 보여 주기";

const QUESTION_CHARS = Array.from(DEMO_QUESTION);

/** 시간표(ms). 진행 막대·자막 CSS 애니메이션 길이는 PLAY_MS 와 같아야 한다(globals.css `.acty-demo`). */
export const DEMO_TIMELINE = (() => {
  const PLAY_MS = 1900;
  const ASK = 2000;
  const TYPE_START = 2200;
  const CHAR_MS = 30;
  const TYPE_END = TYPE_START + QUESTION_CHARS.length * CHAR_MS;
  const ANSWER = TYPE_END + 320;
  const NEXT = ANSWER + 550;
  const LOOP = NEXT + 1900;
  return { PLAY_MS, ASK, TYPE_START, CHAR_MS, TYPE_END, ANSWER, NEXT, LOOP };
})();

/** 0 영상 재생 · 1 질문 · 2 답 · 3 다음 테이크. */
type Step = 0 | 1 | 2 | 3;
type Frame = { loop: number; step: Step; typed: number };

const FINAL_FRAME: Frame = { loop: 0, step: 3, typed: QUESTION_CHARS.length };
const START_FRAME: Frame = { loop: 0, step: 0, typed: 0 };

/** 한 바퀴 안의 경과 시간 → 화면 상태. 새 바퀴의 처음 0.35초는 앞 바퀴 대화가 사라지는 동안 글자를 그대로 둔다. */
export function demoFrameAt(elapsed: number): Frame {
  const T = DEMO_TIMELINE;
  const loop = Math.floor(elapsed / T.LOOP);
  const t = elapsed - loop * T.LOOP;
  const step: Step = t >= T.NEXT ? 3 : t >= T.ANSWER ? 2 : t >= T.ASK ? 1 : 0;
  let typed = Math.max(0, Math.min(QUESTION_CHARS.length, Math.floor((t - T.TYPE_START) / T.CHAR_MS) + 1));
  if (t < T.TYPE_START) typed = loop > 0 && t < 350 ? QUESTION_CHARS.length : 0;
  return { loop, step, typed };
}

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduce(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(REDUCE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduce,
    () => typeof window.matchMedia === "function" && window.matchMedia(REDUCE_QUERY).matches,
    () => false,
  );
}

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/** 화면에 보이고 탭이 앞에 있을 때만 true. */
function useActive(ref: React.RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [inView, setInView] = useState(false);
  const tabVisible = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== "hidden",
    () => false,
  );

  useEffect(() => {
    const node = ref.current;
    if (!enabled || !node) return;
    if (typeof IntersectionObserver === "undefined") {
      // 관찰할 수 없는 브라우저는 보이는 것으로 친다(다음 프레임에 켠다).
      const id = requestAnimationFrame(() => setInView(true));
      return () => cancelAnimationFrame(id);
    }
    const observer = new IntersectionObserver((entries) => setInView(entries.some((e) => e.isIntersecting)), {
      threshold: 0.2,
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, enabled]);

  return enabled && inView && tabVisible;
}

function useDemoFrame(active: boolean): Frame {
  const [frame, setFrame] = useState<Frame>(START_FRAME);
  const elapsedRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // 멈췄다 돌아오면 그 사이 시간을 건너뛰지 않는다. 한 프레임이 길어도 0.1초까지만 센다.
      elapsedRef.current += Math.min(now - last, 100);
      last = now;
      const next = demoFrameAt(elapsedRef.current);
      setFrame((prev) =>
        prev.loop === next.loop && prev.step === next.step && prev.typed === next.typed ? prev : next,
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return frame;
}

function on(visible: boolean) {
  return visible ? " is-on" : "";
}

export function ActyCoachDemo() {
  const rootRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const active = useActive(rootRef, !reduced);
  const live = useDemoFrame(active);
  const frame = reduced ? FINAL_FRAME : live;
  const { step, typed, loop } = frame;
  const typing = step >= 1 && typed < QUESTION_CHARS.length;

  return (
    <>
      <p className="sr-only">
        코칭 예시. 코치 액티가 {DEMO_SCENE} 영상을 보고 묻습니다. “{DEMO_QUESTION}” 배우가 답합니다. “{DEMO_ANSWER}”
        다음 테이크에서 해 볼 것: {DEMO_NEXT_TAKE}.
      </p>
      <div
        ref={rootRef}
        aria-hidden="true"
        data-paused={active ? undefined : ""}
        data-step={step}
        className="acty-demo pointer-events-none absolute inset-0 select-none"
      >
        {/* 휴대폰 */}
        <div className="absolute left-[90px] top-0 w-[260px] rounded-[44px] bg-[#111] p-2.5 shadow-[0_30px_60px_rgba(25,31,40,0.22)] sm:left-[120px] lg:left-[180px] lg:w-[300px]">
          <div className="relative h-[520px] w-[240px] overflow-hidden rounded-[34px] bg-white lg:h-[606px] lg:w-[280px]">
            <div className="absolute left-0 top-0 h-[606px] w-[280px] origin-top-left scale-[0.8572] text-[#191f28] lg:scale-100">
              <PhoneChrome />

              {/* 상단 띠: 보는 중 → 액티가 본 장면 */}
              <div className="absolute inset-x-0 top-[58px] h-[24px] bg-[#ebf3fe] text-[11px] font-bold leading-[24px] text-[#3268d8]">
                <span className={`acty-demo-swap absolute inset-x-[14px]${on(step === 0)}`}>
                  액티가 영상을 보는 중
                  <span className="acty-demo-dots">
                    <i>.</i>
                    <i>.</i>
                    <i>.</i>
                  </span>
                </span>
                <span className={`acty-demo-swap absolute inset-x-[14px]${on(step >= 1)}`}>
                  액티가 본 장면 · {DEMO_SCENE}
                </span>
              </div>

              {/* 영상 재생(크게) */}
              <div
                className={`acty-demo-video absolute left-[14px] top-[92px] h-[140px] w-[252px] overflow-hidden rounded-[14px]${on(step === 0)}`}
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_30%,rgba(255,196,120,0.45),transparent_28%),radial-gradient(circle_at_78%_22%,rgba(255,220,160,0.32),transparent_22%),radial-gradient(circle_at_62%_70%,rgba(255,170,90,0.2),transparent_30%),linear-gradient(160deg,#4a3b33_0%,#2a2220_55%,#1b1716_100%)]" />
                <span className="absolute left-[10px] top-[9px] rounded-full bg-black/35 px-2 py-[3px] text-[10px] font-bold text-white/85">
                  오늘 영상 · 0:12
                </span>
                <span key={`title-${loop}`} className="acty-demo-title absolute inset-x-0 top-[50px] text-center text-[14px] font-bold leading-[1.4] text-white">
                  {DEMO_SCENE}
                </span>
                <span className="absolute right-[11px] top-[10px] flex gap-[3px]">
                  <i className="block h-[10px] w-[3px] rounded-sm bg-white/80" />
                  <i className="block h-[10px] w-[3px] rounded-sm bg-white/80" />
                </span>
                <span key={`sub-${loop}`} className="acty-demo-subtitle absolute inset-x-0 bottom-[22px] text-center text-[13px] font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">
                  우리 그만하자.
                </span>
                <div className="absolute inset-x-[10px] bottom-[10px] h-[3px] overflow-hidden rounded-full bg-white/25">
                  <div key={`bar-${loop}`} className="acty-demo-progress h-full w-full origin-left rounded-full bg-[#6f9bf5]" />
                </div>
              </div>

              {/* 다 본 뒤: 앱처럼 작은 영상 줄 */}
              <div className={`acty-demo-item absolute left-[14px] top-[92px] flex h-[40px] items-center gap-2.5${on(step >= 1)}`}>
                <span className="flex h-[40px] w-[40px] items-center justify-center rounded-[10px] bg-[#343c49]">
                  <span className="ml-[2px] h-0 w-0 border-y-[6px] border-l-[9px] border-y-transparent border-l-white/85" />
                </span>
                <span>
                  <span className="block text-[13px] font-bold leading-[18px]">오늘 영상</span>
                  <span className="block text-[11px] leading-[16px] text-[#8b95a1]">0:12 · 끝까지 봤어요</span>
                </span>
              </div>

              {/* 액티 질문 */}
              <p className={`acty-demo-item absolute left-[16px] top-[140px] text-[11px] font-bold${on(step >= 1)}`}>액티</p>
              <div
                className={`acty-demo-item absolute left-[14px] top-[157px] w-[218px] rounded-[16px] bg-[#f2f4f6] px-3 py-2.5 text-[12.5px] leading-[1.55]${on(step >= 1)}`}
              >
                {/* 글자마다 자리를 미리 잡아 두고 색만 바꾼다. 줄바꿈이 마지막 모양 그대로라 글자가 튀지 않는다. */}
                {QUESTION_CHARS.map((char, index) => (
                  <span
                    key={index}
                    className={index >= typed ? "acty-demo-rest" : typing && index === typed - 1 ? "acty-demo-caret" : undefined}
                  >
                    {char}
                  </span>
                ))}
              </div>

              {/* 배우 답 */}
              <div
                className={`acty-demo-item acty-demo-rise absolute right-[14px] top-[228px] rounded-[16px] bg-[#557ee7] px-3 py-2 text-[12.5px] leading-[1.55] text-white${on(step >= 2)}`}
              >
                {DEMO_ANSWER}
              </div>

              {/* 다음 테이크에서 해 볼 것 */}
              <div
                className={`acty-demo-item acty-demo-pop absolute inset-x-[14px] top-[272px] rounded-[14px] border border-[#e5e8eb] bg-white px-3 py-2.5 shadow-[0_6px_18px_rgba(25,31,40,0.08)]${on(step >= 3)}`}
              >
                <p className="text-[11px] font-bold text-[#3268d8]">다음 테이크에서 해 볼 것</p>
                <p className="mt-1 text-[13px] font-bold leading-[1.45]">{DEMO_NEXT_TAKE}</p>
              </div>
            </div>
          </div>
        </div>

        {/* 액티: 휴대폰 옆에서 영상을 보다가, 다음 테이크 카드가 나오면 응원한다 */}
        <div className="acty-demo-acty absolute bottom-[2px] left-0 h-[124px] w-[106px] sm:h-[150px] sm:w-[128px] lg:bottom-[120px] lg:left-[6px] lg:h-[222px] lg:w-[190px]">
          <Image
            src="/site/acty/hero-watch.png"
            alt=""
            width={307}
            height={360}
            priority
            className={`acty-demo-pose acty-demo-pose-watch absolute bottom-0 left-0 h-auto w-full${on(step < 3)}`}
          />
          <Image
            src="/site/acty/hero-cheer.png"
            alt=""
            width={400}
            height={365}
            className={`acty-demo-pose acty-demo-pose-cheer absolute bottom-0 left-0 h-auto w-[96%]${on(step >= 3)}`}
          />
        </div>
      </div>
    </>
  );
}

function PhoneChrome() {
  return (
    <>
      <div className="absolute inset-x-0 top-0 flex h-[28px] items-end justify-between px-[22px] pb-[2px]">
        <span className="text-[12px] font-bold">9:41</span>
        <span className="flex items-center gap-[5px]">
          <span className="flex items-end gap-[1.5px]">
            <i className="block h-[3px] w-[2px] rounded-[1px] bg-[#191f28]" />
            <i className="block h-[5px] w-[2px] rounded-[1px] bg-[#191f28]" />
            <i className="block h-[7px] w-[2px] rounded-[1px] bg-[#191f28]" />
            <i className="block h-[9px] w-[2px] rounded-[1px] bg-[#191f28]" />
          </span>
          <span className="block h-[8px] w-[16px] rounded-[2.5px] border border-[#191f28] p-[1px]">
            <span className="block h-full w-[70%] rounded-[1px] bg-[#191f28]" />
          </span>
        </span>
      </div>
      <div className="absolute inset-x-0 top-[28px] flex h-[30px] items-center justify-between px-[14px]">
        <span className="text-[17px] leading-none text-[#191f28]">‹</span>
        <span className="text-[14px] font-bold">질문 대화</span>
        <span className="text-[12px] font-semibold text-[#8b95a1]">그만하기</span>
      </div>

      <p className="absolute left-[14px] top-[478px] text-[11.5px] font-bold text-[#3268d8]">답이나 질문을 편하게 적어 주세요</p>
      <div className="absolute inset-x-[14px] top-[500px] flex gap-1.5">
        {["맞아요", "아니요", "잘 모르겠어요"].map((label) => (
          <span key={label} className="flex h-[30px] flex-1 items-center justify-center rounded-full bg-[#f2f4f6] text-[11.5px] font-bold text-[#333d4b]">
            {label}
          </span>
        ))}
      </div>
      <div className="absolute inset-x-[14px] top-[540px] flex items-center gap-1.5">
        <span className="h-[32px] w-[32px] rounded-full bg-[#eaf3fe]" />
        <span className="flex h-[32px] flex-1 items-center rounded-full bg-[#f2f4f6] px-3 text-[11.5px] text-[#b0b8c1]">직접 써도 돼요</span>
        <span className="h-[32px] w-[32px] rounded-full bg-[#dbe7fd]" />
      </div>
      <span className="absolute bottom-[8px] left-1/2 h-[4px] w-[96px] -translate-x-1/2 rounded-full bg-[#191f28]" />
    </>
  );
}
