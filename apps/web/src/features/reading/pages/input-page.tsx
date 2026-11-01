"use client";

import { useRouter } from "next/navigation";
import { InputScreen } from "@/features/reading/screens/InputScreen";
import { useReadingStep } from "@/features/reading/use-reading-step";
import { useScriptImport } from "@/features/reading/use-script-import";
import { scriptDetailPath, STEP_PATH } from "@/lib/reading/step";

/** /reading — 대본 넣기. 서버가 나눠 저장하면 배역 정하기로, 목록이나 중복 알림에서 고르면 대본 상세로 간다. */
export function InputPage() {
  const router = useRouter();
  const { ready } = useReadingStep("input");
  const importer = useScriptImport(() => router.push(STEP_PATH.setup));
  if (!ready) return <div className="min-h-svh" />;
  return <InputScreen importer={importer} onOpen={(id) => router.push(scriptDetailPath(id))} />;
}
