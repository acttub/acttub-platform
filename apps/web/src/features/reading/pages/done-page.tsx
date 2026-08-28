"use client";

import { useRouter } from "next/navigation";
import { DoneScreen } from "@/features/reading/screens/DoneScreen";
import { useReadingStep } from "@/features/reading/use-reading-step";
import { STEP_PATH } from "@/lib/reading/step";
import { storage } from "@/lib/reading/storage";

/** /reading/done — 완료. 다시 리딩 · 배역 바꾸기 · 새 대본. */
export function DonePage() {
  const router = useRouter();
  const { script, setup, stats, ready } = useReadingStep("done");
  if (!ready || !script || !setup || !stats) return <div className="min-h-svh" />;
  return (
    <DoneScreen
      script={script}
      setup={setup}
      stats={stats}
      onRepeat={() => {
        storage.saveStats(null);
        router.push(STEP_PATH.run);
      }}
      onChangeSetup={() => router.push(STEP_PATH.setup)}
      onNewScript={() => {
        storage.saveScript(null);
        storage.saveSetup(null);
        storage.saveStats(null);
        router.push(STEP_PATH.input);
      }}
    />
  );
}
