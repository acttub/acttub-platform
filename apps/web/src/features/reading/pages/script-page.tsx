"use client";

import { useRouter } from "next/navigation";
import { ReviewScreen } from "@/features/reading/screens/ReviewScreen";
import { useReadingStep } from "@/features/reading/use-reading-step";
import { STEP_PATH } from "@/lib/reading/step";

/** /reading/script — 대본 확인(폰). 데스크톱은 가드가 배역 정하기로 보낸다. */
export function ScriptPage() {
  const router = useRouter();
  const { script, ready } = useReadingStep("script");
  if (!ready || !script) return <div className="min-h-svh" />;
  return <ReviewScreen script={script} onBack={() => router.push(STEP_PATH.input)} onNext={() => router.push(STEP_PATH.setup)} />;
}
