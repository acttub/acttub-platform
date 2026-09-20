"use client";

import { useRouter } from "next/navigation";
import { DoneScreen } from "@/features/reading/screens/DoneScreen";
import { useReadingStep } from "@/features/reading/use-reading-step";
import { useSessionStart } from "@/features/reading/use-session-start";
import { scriptDetailPath, STEP_PATH } from "@/lib/reading/step";
import { storage } from "@/lib/reading/storage";

/** /reading/done — 완료. 다시 리딩(같은 설정의 새 회차) · 배역·방식 바꾸기 · 새 대본 · 회차 목록. */
export function DonePage() {
  const router = useRouter();
  const { script, session, stats, ready } = useReadingStep("done");
  const repeat = useSessionStart(() => router.push(STEP_PATH.run));
  if (!ready || !script || !session || !stats) return <div className="min-h-svh" />;
  return (
    <DoneScreen
      script={script}
      stats={stats}
      repeating={repeat.starting}
      error={repeat.error}
      onRepeat={() => {
        const prefs = storage.loadRunPrefs();
        void repeat.start(
          script.id,
          {
            my_character_ids: session.my_character_ids,
            mode: session.mode,
            start_line_id: session.start_line_id,
            end_line_id: session.end_line_id,
            advance: session.advance,
            record: session.record,
          },
          { partnerVoice: prefs?.partnerVoice ?? "supertonic" },
        );
      }}
      onChangeSetup={() => router.push(STEP_PATH.setup)}
      onDetail={() => router.push(scriptDetailPath(script.id))}
      onNewScript={() => {
        storage.saveScript(null);
        storage.saveSession(null);
        storage.saveStats(null);
        router.push(STEP_PATH.input);
      }}
    />
  );
}
