"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { QuizScreen } from "@/features/reading/screens/QuizScreen";
import { RehearsalScreen } from "@/features/reading/screens/RehearsalScreen";
import { useReadingStep } from "@/features/reading/use-reading-step";
import { scriptDetailPath, STEP_PATH } from "@/lib/reading/step";
import { storage, type RunStats } from "@/lib/reading/storage";

/** /reading/run — 읽어주기 또는 암기 대조. 회차의 mode 로 갈린다. 나가면 대본 상세로 간다. */
export function RunPage() {
  const router = useRouter();
  const { script, session, ready } = useReadingStep("run");
  const [prefs] = useState(() => (typeof window === "undefined" ? null : storage.loadRunPrefs()));
  if (!ready || !script || !session) return <div className="min-h-svh" />;
  const common = {
    script,
    session,
    partnerVoice: prefs?.partnerVoice ?? ("supertonic" as const),
    onExit: () => router.push(scriptDetailPath(script.id)),
    onFinish: (st: RunStats) => {
      storage.saveStats(st);
      // 배역 화면의 기본 선택이 이번 회차의 내 배역이 되도록 캐시의 마지막 회차를 갱신한다.
      storage.saveScript({ ...script, openSessionId: null, lastSession: { id: session.id, status: "completed", myCharacterIds: session.my_character_ids } });
      router.push(STEP_PATH.done);
    },
  };
  return session.mode === "quiz" ? <QuizScreen {...common} /> : <RehearsalScreen {...common} />;
}
