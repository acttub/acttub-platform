"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  APP_DOWNLOAD_ATTR,
  APP_DOWNLOAD_STORE_ATTR,
  goHref,
  STORE_ORDER,
  type AppStore,
} from "@/lib/app-download/store-links";

import type { HeroMedia } from "./landing-hero-media";

/**
 * 랜딩 B안 첫 화면(SOMA-918). 스픽 한국어 랜딩처럼 왼쪽에 제목·짧은 설명·버튼 하나,
 * 오른쪽에 살짝 기운 휴대폰 한 대만 두고 그 안에서 실제 앱 녹화 영상이 돈다.
 * 다운로드 주소·UTM·클릭 가로채기·GA4 는 A안과 같은 것(appHref, goHref, data-app-download)을 쓴다.
 */
const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4880ee]";

const STORE_NAME: Record<AppStore, string> = { app_store: "App Store", google_play: "Google Play" };

export function LandingHeroB({
  appHref,
  webHref,
  returningGuest,
  campaignSearch,
  media,
}: {
  appHref: string;
  webHref: string;
  returningGuest: boolean;
  campaignSearch: string;
  media: HeroMedia;
}) {
  return (
    <section id="hero" className="relative overflow-x-clip bg-white lg:flex lg:flex-1 lg:items-center">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-10 px-6 pb-14 pt-9 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:gap-10 lg:py-12">
        <div className="w-full lg:max-w-[600px]">
          <h1 className="text-[32px] font-extrabold leading-[1.3] tracking-[-0.04em] sm:text-[44px] lg:text-[54px] lg:leading-[1.24]">
            내 연기를 같이 봐 줄
            <br />
            사람이 없을 때, <span className="text-[#4880ee]">액터브</span>
          </h1>
          <p className="mt-5 text-base leading-[1.7] text-[#4e5968] sm:text-lg lg:mt-6">
            연기 영상을 올리면 코치가 장면을 보고 질문해요.
            <br /> 답하다 보면 막힌 곳이 보이고, 연습 노트가 남아요.
          </p>

          <div className="mt-7 flex flex-col gap-4 lg:mt-9 lg:flex-row lg:items-center lg:gap-6">
            <a
              href={appHref}
              data-app-download="landing_hero"
              className={`flex h-14 w-full items-center justify-center rounded-[14px] bg-[#4880ee] px-8 text-[17px] font-bold text-white transition hover:bg-[#3268d8] lg:w-fit ${FOCUS}`}
            >
              앱 열기 · 무료로 설치
            </a>
            <p className="text-center text-[15px] text-[#4e5968] lg:text-left">
              {returningGuest ? "하던 연습이 있어요 " : "설치 전에 "}
              <Link
                href={webHref}
                data-landing-web="landing_hero"
                className={`rounded font-bold text-[#3268d8] hover:underline ${FOCUS}`}
              >
                {returningGuest ? "이어서 연습하기 →" : "웹에서 먼저 해 보기 →"}
              </Link>
            </p>
          </div>

          <div className="mt-12 hidden items-center gap-3.5 lg:flex">
            <Image
              src="/site/app-qr.svg"
              alt="앱 설치 QR 코드"
              width={56}
              height={56}
              unoptimized
              className="rounded-lg border border-[#e5e8eb] bg-white p-1"
            />
            <div className="text-sm leading-[1.65] text-[#8b95a1]">
              <p>휴대폰 카메라로 찍으면 설치 화면으로 가요</p>
              <p>
                iPhone · Android 무료 ·{" "}
                {STORE_ORDER.map((store, i) => (
                  <span key={store}>
                    {i > 0 ? " · " : null}
                    <a
                      href={goHref(store, "landing_hero", campaignSearch)}
                      {...{ [APP_DOWNLOAD_ATTR]: "landing_hero", [APP_DOWNLOAD_STORE_ATTR]: store }}
                      className={`rounded font-semibold text-[#4e5968] underline-offset-2 hover:underline ${FOCUS}`}
                    >
                      {STORE_NAME[store]}
                    </a>
                  </span>
                ))}
              </p>
            </div>
          </div>
        </div>

        <HeroPhone media={media} />
      </div>
    </section>
  );
}

/** 기운 휴대폰 한 대와 뒤의 옅은 빛. 크기를 미리 고정해 영상이 늦게 와도 자리가 흔들리지 않는다. */
function HeroPhone({ media }: { media: HeroMedia }) {
  return (
    <div className="relative mx-auto h-[500px] w-[260px] shrink-0 lg:mx-0 lg:mr-6 lg:h-[640px] lg:w-[340px]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(72,128,238,0.2),rgba(72,128,238,0.07)_55%,transparent)] lg:h-[760px] lg:w-[760px] lg:translate-x-[-38%] lg:translate-y-[-44%]"
      />
      <div className="absolute left-1/2 top-1/2 w-[224px] -translate-x-1/2 -translate-y-1/2 -rotate-3 lg:w-[282px] lg:-rotate-[7deg]">
        <div className="rounded-[42px] bg-[#16181d] p-[9px] shadow-[0_28px_56px_rgba(25,31,40,0.18),0_0_0_1px_rgba(25,31,40,0.06)] lg:rounded-[50px] lg:p-[11px]">
          <div className="relative aspect-[9/19.5] overflow-hidden rounded-[34px] bg-white lg:rounded-[40px]">
            <HeroVideo media={media} />
          </div>
        </div>
      </div>
    </div>
  );
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * 휴대폰 화면 안 영상. 밑에 정지 화면(poster)을 깔고 그 위에서 영상이 돈다.
 * 움직임 줄이기면 재생하지 않고 정지 화면만 둔다. 화면 밖으로 나가면 멈춘다.
 * 재생은 스크립트로 건다 — 움직임 줄이기·화면 밖 여부를 알기 전에 저절로 돌지 않게 하려는 것.
 */
function HeroVideo({ media }: { media: HeroMedia }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const hasVideo = media.sources.length > 0;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hasVideo) return;
    const reduced = typeof window.matchMedia === "function" ? window.matchMedia(REDUCED_MOTION) : null;
    let visible = false;

    const sync = () => {
      if (visible && !reduced?.matches) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    };
    const onReducedChange = () => {
      if (reduced?.matches) {
        video.pause();
        video.currentTime = 0;
        setPlaying(false);
      }
      sync();
    };

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "undefined") {
      visible = true;
      sync();
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          visible = entries.some((entry) => entry.isIntersecting);
          sync();
        },
        { threshold: 0.15 },
      );
      observer.observe(video);
    }
    reduced?.addEventListener?.("change", onReducedChange);
    return () => {
      observer?.disconnect();
      reduced?.removeEventListener?.("change", onReducedChange);
      video.pause();
    };
  }, [hasVideo]);

  return (
    <>
      <Image
        src={media.poster}
        alt="앱에서 코치가 연기 영상을 보고 질문하는 화면"
        fill
        sizes="282px"
        priority
        className="object-cover object-top"
      />
      {hasVideo ? (
        <video
          ref={videoRef}
          muted
          loop
          playsInline
          preload="metadata"
          poster={media.poster}
          aria-hidden="true"
          tabIndex={-1}
          onPlaying={() => setPlaying(true)}
          data-playing={playing ? "" : undefined}
          className={`absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-300 ${playing ? "opacity-100" : "opacity-0"}`}
        >
          {media.sources.map((source) => (
            <source key={source.src} src={source.src} type={source.type} />
          ))}
        </video>
      ) : null}
    </>
  );
}
