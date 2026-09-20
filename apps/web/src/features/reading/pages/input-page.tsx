"use client";

import { useRouter } from "next/navigation";
import { InputScreen } from "@/features/reading/screens/InputScreen";
import { useReadingStep } from "@/features/reading/use-reading-step";
import { useScriptSave } from "@/features/reading/use-script-save";
import { STEP_PATH } from "@/lib/reading/step";
import { storage } from "@/lib/reading/storage";

/**
 * /reading — 대본 넣기. 확인 화면에서 돌아온 초안이 있으면 그 본문을 채워 둔다. 저장(데스크톱)이나
 * 목록에서 열기가 끝나면 배역 정하기로 간다.
 */
export function InputPage() {
  const router = useRouter();
  const { draft, ready } = useReadingStep("input");
  const save = useScriptSave(() => router.push(STEP_PATH.setup));
  if (!ready) return <div className="min-h-svh" />;
  return (
    <InputScreen
      initialDraft={draft}
      save={save}
      onConfirm={(d) => {
        storage.saveDraft(d);
        router.push(STEP_PATH.script);
      }}
      onOpened={() => router.push(STEP_PATH.setup)}
    />
  );
}
