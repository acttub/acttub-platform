"use client";

import { useRouter } from "next/navigation";
import { QuizScreen } from "@/features/reading/screens/QuizScreen";
import { RehearsalScreen } from "@/features/reading/screens/RehearsalScreen";
import { useReadingStep } from "@/features/reading/use-reading-step";
import { STEP_PATH } from "@/lib/reading/step";
import { storage, type RunStats } from "@/lib/reading/storage";

/** /reading/run — 읽어주기 또는 암기 대조. 설정의 mode 로 갈린다. */
export function RunPage() {
  const router = useRouter();
  const { script, setup, ready } = useReadingStep("run");
  if (!ready || !script || !setup) return <div className="min-h-svh" />;
  const common = {
    script,
    setup,
    onExit: () => router.push(STEP_PATH.setup),
    onFinish: (st: RunStats) => {
      storage.saveStats(st);
      router.push(STEP_PATH.done);
    },
  };
  return setup.mode === "quiz" ? <QuizScreen {...common} /> : <RehearsalScreen {...common} />;
}
