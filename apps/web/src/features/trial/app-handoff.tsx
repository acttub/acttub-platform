"use client";

import { useAppDownloadHref } from "@/features/app-download/app-download-button";
import { trackTrialAppClick, type TrialFeature } from "@/lib/analytics/ga";
import { APP_DOWNLOAD_ATTR } from "@/lib/app-download/store-links";
import { useTrialGuest } from "./use-trial-guest";

/**
 * 체험이 끝난 화면의 「앱에서 이어서 하기」 카드. 체험하는 방문자(게스트)에게만 그린다.
 * 휴대폰 너비에서는 QR 대신 스토어로 가는 버튼이다. 리딩 완료 본문(DoneBody)이 next/link 없이 그려지는 테스트에 쓰이므로 일반 앵커를 쓴다.
 *
 * 앱으로 가져갈 수 있는 것은 서버가 정한다: 게스트의 대본·회차·녹음·연습은 로그인할 때(웹 로그인이 자동으로)
 * 또는 「앱으로 옮기기」 코드로 회원 계정에 넘어간다(GuestTransferService). 설치만 해서는 따라가지 않으므로
 * 카드는 그 길을 그대로 안내한다.
 */
export const HANDOFF_COPY = {
  reading: {
    title: ["내 대본으로 이어서 하려면", "앱에서 하세요"],
    body: "내 대본을 넣고 매일 이어서 연습할 수 있어요. 오늘 녹음은 「앱으로 옮기기」 코드로 앱에 가져가요.",
  },
  coaching: {
    title: ["다음 연습도 이어서 하려면", "앱에서 하세요"],
    body: "영상을 올려 코치와 이야기하는 연습을 매일 이어서 할 수 있어요. 오늘 연습은 「앱으로 옮기기」 코드로 앱에 가져가요.",
  },
} as const;

export const HANDOFF_QR_TITLE = "휴대폰 카메라로 찍으세요";
export const HANDOFF_QR_NOTE = "iPhone · Android 무료";
export const HANDOFF_MOBILE_BUTTON = "앱에서 이어서 하기";
export const HANDOFF_TRANSFER_LINK = "오늘 기록 앱으로 옮기기";
export const HANDOFF_WEB_COPY = "PC에서 계속할래요";
export const HANDOFF_WEB_LINK = "웹에서 내 대본 넣기";

export function AppHandoff({
  feature,
  compact = false,
  continueHref,
}: {
  feature: TrialFeature;
  /** 코칭 노트 아래처럼 좁은 자리에서 쓰는 작은 모양 */
  compact?: boolean;
  /** 웹에서 계속하는 작은 링크의 도착지. 없으면 그 줄을 그리지 않는다. */
  continueHref?: string;
}) {
  const guest = useTrialGuest();
  const appHref = useAppDownloadHref("trial_done");
  if (!guest) return null;
  const copy = HANDOFF_COPY[feature];
  const track = () => trackTrialAppClick(feature, "done");
  return (
    <section
      aria-label="앱에서 이어서 하기"
      className={`w-full rounded-[28px] bg-[#191f28] text-white ${compact ? "p-5" : "p-6 md:p-8"}`}
    >
      <h2 className={`font-extrabold leading-[1.35] tracking-[-0.03em] ${compact ? "text-[18px]" : "text-[22px] md:text-[26px]"}`}>
        {copy.title[0]}
        <br />
        {copy.title[1]}
      </h2>
      <p className={`mt-3 leading-[1.65] text-[#d1d6db] ${compact ? "text-[13px]" : "text-[14px] md:text-[15px]"}`}>{copy.body}</p>

      <a
        href={appHref}
        {...{ [APP_DOWNLOAD_ATTR]: "trial_done" }}
        onClick={track}
        className="mt-5 flex h-12 w-full items-center justify-center rounded-[14px] bg-[#3182f6] text-[15px] font-bold text-white md:hidden"
      >
        {HANDOFF_MOBILE_BUTTON}
      </a>
      <div className="mt-5 hidden items-center gap-4 rounded-[20px] bg-white p-4 text-[#191f28] md:flex">
        {/* 정적 SVG 라 최적화가 필요 없다. next/image 를 쓰지 않으면 리딩 화면 테스트(순수 노드)에서도 그대로 그려진다. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/site/app-qr.svg" alt="앱 설치 QR 코드" width={compact ? 80 : 96} height={compact ? 80 : 96} className="shrink-0" />
        <div>
          <p className="text-[15px] font-extrabold">{HANDOFF_QR_TITLE}</p>
          <p className="mt-1 text-[13px] leading-[1.5] text-[#6b7684]">{HANDOFF_QR_NOTE}</p>
          <a
            href={appHref}
            {...{ [APP_DOWNLOAD_ATTR]: "trial_done" }}
            onClick={track}
            className="mt-1.5 inline-block text-[13px] font-bold text-[#3182f6] underline-offset-2 hover:underline"
          >
            링크로 받기
          </a>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-2 border-t border-white/15 pt-4 text-[13px] text-[#d1d6db]">
        <a href="/transfer" className="w-fit font-bold text-white underline underline-offset-2">
          {HANDOFF_TRANSFER_LINK}
        </a>
        {continueHref ? (
          <p>
            {HANDOFF_WEB_COPY} ·{" "}
            <a href={continueHref} className="font-bold text-white underline underline-offset-2">
              {HANDOFF_WEB_LINK}
            </a>
          </p>
        ) : null}
      </div>
    </section>
  );
}
