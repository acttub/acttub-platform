"use client";

import { useState, type ReactNode } from "react";

import { BlockageSelectionFlow } from "@/features/practice/blockage-selection";
import type { BlockageSelection } from "@/features/practice/blockage-flow";

/**
 * 화면만 보는 통로 — 운영에서는 열리지 않는다.
 *
 * 연습 화면들은 로그인·영상 업로드·분석을 지나야 나온다. 문구와 배치만 고칠 때마다
 * 그 과정을 다시 밟지 않도록, 가짜 값을 넣어 화면을 바로 그린다. 폰에서 열어
 * 실물로 확인하는 용도도 겸한다 — 그래서 로컬뿐 아니라 dev 배포에서도 열린다.
 *
 * 여기서 하는 일은 서버에 아무것도 보내지 않는다. 앱 쪽 짝은 `app/ui-preview.tsx`다.
 */

// 배포 환경 이름은 deploy.yml 이 NEXT_PUBLIC_SENTRY_ENV 로 넣는다(dev · prod, 없으면 local).
// 계측 밖에서 이 값을 읽는 유일한 자리라 env.ts 로 올리지 않고 여기서만 본다.
const IS_PROD_SITE = process.env.NEXT_PUBLIC_SENTRY_ENV === "prod";

const SAMPLE_SCENE = {
  situation: "헤어지자는 말을 들은 직후",
  character: "붙잡고 싶지만 자존심이 센 사람",
  goal: "상대를 문 앞에서 멈춰 세우기",
};

// 재생은 안 되지만 <video> 가 빈 src 로 페이지를 다시 받지 않게 하는 최소 mp4 헤더.
const SAMPLE_VIDEO =
  "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=";

type PreviewScreen = {
  key: string;
  label: string;
  hint: string;
  render: (props: { onResult: (result: string) => void }) => ReactNode;
};

const SCREENS: readonly PreviewScreen[] = [
  {
    key: "blockage",
    label: "받고 싶은 도움 고르기",
    hint: "대분류 3개 → 하위 갈래 · 더 적기",
    render: ({ onResult }) => (
      // 감싸는 틀은 workspace-app 이 이 화면에 주는 것과 같은 값이다 — 폭이 달라지면
      // 제목 줄바꿈과 카드 높이가 실제와 다르게 보인다.
      <div className="bg-[#f7faff] px-4 py-6 sm:px-5 sm:py-8">
        <div className="mx-auto w-full max-w-[760px]">
          <BlockageSelectionFlow
            videoUrl={SAMPLE_VIDEO}
            scene={SAMPLE_SCENE}
            submitDisabled={false}
            onComplete={(selection: BlockageSelection) =>
              onResult(
                `보낼 값 · ${selection.blockage_kind} / ${selection.sub_branch} / ${
                  selection.blockage_detail ?? "(상세 없음)"
                }`,
              )
            }
          />
        </div>
      </div>
    ),
  },
];

export function UiPreview() {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  if (IS_PROD_SITE) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f2f4f6] px-6">
        <p className="text-sm font-semibold text-[#4e5968]">
          이 페이지는 개발 환경에서만 열려요.
        </p>
      </main>
    );
  }

  const open = SCREENS.find((screen) => screen.key === openKey);

  if (open) {
    return (
      <main className="min-h-screen bg-[#f7faff]">
        <div className="mx-auto flex w-full max-w-[760px] items-center justify-between gap-3 px-4 pt-4">
          <p className="text-sm font-black text-[#4e5968]">{open.label}</p>
          <button
            type="button"
            onClick={() => {
              setOpenKey(null);
              setResult(null);
            }}
            className="min-h-[44px] shrink-0 text-sm font-black text-[#3182f6]"
          >
            목록으로
          </button>
        </div>
        {result ? (
          <div className="mx-auto w-full max-w-[760px] px-4 pt-3">
            <p className="rounded-2xl bg-[#e8f3ff] px-4 py-3 text-sm font-semibold text-[#191f28]">
              {result}
            </p>
          </div>
        ) : null}
        {open.render({ onResult: setResult })}
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-[760px] bg-[#f2f4f6] px-4 py-8">
      <h1 className="text-xl font-black tracking-[-0.04em] text-[#191f28] break-keep sm:text-3xl">
        화면 미리보기
      </h1>
      <p className="mt-3 text-sm font-semibold leading-6 text-[#4e5968]">
        로그인이나 영상 없이 화면만 그립니다. 서버로는 아무것도 보내지 않아요.
      </p>
      <div className="mt-6 grid gap-3">
        {SCREENS.map((screen) => (
          <button
            key={screen.key}
            type="button"
            onClick={() => setOpenKey(screen.key)}
            className="min-h-[44px] rounded-[28px] bg-white p-5 text-left shadow-[0_16px_48px_rgba(25,31,40,0.08)]"
          >
            <span className="block text-base font-black text-[#191f28]">{screen.label}</span>
            <span className="mt-1 block text-sm font-semibold text-[#4e5968]">{screen.hint}</span>
          </button>
        ))}
      </div>
    </main>
  );
}
