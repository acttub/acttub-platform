"use client";

import { useRouter } from "next/navigation";
import { SetupScreen } from "@/features/reading/screens/SetupScreen";
import { useReadingStep } from "@/features/reading/use-reading-step";
import { STEP_PATH } from "@/lib/reading/step";
import { storage } from "@/lib/reading/storage";

/** /reading/setup — 배역 정하기. 시작하면 설정을 저장하고 리딩으로 간다. */
export function SetupPage() {
  const router = useRouter();
  const { script, setup, ready, desktop } = useReadingStep("setup");
  if (!ready || !script) return <div className="min-h-svh" />;
  return (
    <SetupScreen
      script={script}
      initialSetup={setup}
      onBack={() => router.push(desktop ? STEP_PATH.input : STEP_PATH.script)}
      onReinput={() => router.push(STEP_PATH.input)}
      onStart={(st) => {
        storage.saveSetup(st);
        storage.saveStats(null);
        router.push(STEP_PATH.run);
      }}
    />
  );
}
