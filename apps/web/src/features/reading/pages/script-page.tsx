"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ReviewScreen } from "@/features/reading/screens/ReviewScreen";
import { useReadingStep } from "@/features/reading/use-reading-step";
import { useScriptSave } from "@/features/reading/use-script-save";
import type { ScriptDraft } from "@/lib/reading/draft";
import { STEP_PATH } from "@/lib/reading/step";
import { storage } from "@/lib/reading/storage";

/** /reading/script — 대본 확인(폰). 데스크톱은 가드가 대본 넣기로 보낸다. 저장하면 배역 정하기로 간다. */
export function ScriptPage() {
  const router = useRouter();
  const { draft: initial, ready } = useReadingStep("script");
  const save = useScriptSave(() => router.push(STEP_PATH.setup));
  // 여기서 고친 것(이름·뺀 배역·제목)은 초안에 남겨 두어 뒤로 갔다 와도 그대로다.
  const [draft, setDraft] = useState<ScriptDraft | null>(initial);
  if (!ready || !draft) return <div className="min-h-svh" />;
  return (
    <ReviewScreen
      draft={draft}
      onChange={(next) => {
        setDraft(next);
        storage.saveDraft(next);
      }}
      save={save}
      onBack={() => router.push(STEP_PATH.input)}
    />
  );
}
