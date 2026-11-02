"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QuizScreen } from "@/features/reading/screens/QuizScreen";
import { RehearsalScreen } from "@/features/reading/screens/RehearsalScreen";
import { useReadingStep } from "@/features/reading/use-reading-step";
import { isSampleScript, otherQuickStartRole, quickStartPath, QUICK_START_ROLES, type QuickStartRole } from "@/features/reading/quick-start";
import { TrialBar } from "@/features/trial/trial-bar";
import { useTrialGuest } from "@/features/trial/use-trial-guest";
import { trackTrialFirstPartnerLine } from "@/lib/analytics/ga";
import { scriptDetailPath, STEP_PATH } from "@/lib/reading/step";
import { storage, type RunStats } from "@/lib/reading/storage";

/** /reading/run — 읽어주기 또는 암기 대조. 회차의 mode 로 갈린다. 나가면 대본 상세로 간다. */
export function RunPage() {
  const router = useRouter();
  const { script, session, ready } = useReadingStep("run");
  const [prefs] = useState(() => (typeof window === "undefined" ? null : storage.loadRunPrefs()));
  const guest = useTrialGuest();
  const firstPartnerLine = useRef(false);
  if (!ready || !script || !session) return <div className="min-h-svh" />;
  const common = {
    script,
    session,
    partnerVoice: prefs?.partnerVoice ?? ("supertonic" as const),
    onExit: () => router.push(scriptDetailPath(script.id)),
    onFinish: (st: RunStats) => {
      storage.saveStats(st);
      // 배역 화면의 기본 선택이 이번 회차의 내 배역이 되도록 캐시의 마지막 회차를 갱신한다.
      storage.saveScript({ ...script, lastSession: { myCharacterIds: session.my_character_ids } });
      router.push(STEP_PATH.done);
    },
  };
  if (session.mode === "quiz") return <QuizScreen {...common} />;
  // 가입 없이 체험하는 동안 위쪽에 얇은 띠를 둔다. 예시 대본이면 반대 배역으로 바꾸는 링크도 둔다(SOMA-834 3차).
  const current = QUICK_START_ROLES.find((role) => role === session.my_character_names[0]);
  const switchTo: QuickStartRole | null = current && isSampleScript(script) ? otherQuickStartRole(current) : null;
  return (
    <>
      <TrialBar
        feature="reading"
        action={
          switchTo ? (
            <Link href={quickStartPath(switchTo)} className="text-[13px] font-bold text-[#d1d6db] underline underline-offset-2">
              {switchTo}로 읽기
            </Link>
          ) : null
        }
      />
      <RehearsalScreen
        {...common}
        onPartnerSpoken={
          guest
            ? () => {
                if (firstPartnerLine.current) return;
                firstPartnerLine.current = true;
                trackTrialFirstPartnerLine();
              }
            : undefined
        }
      />
    </>
  );
}
