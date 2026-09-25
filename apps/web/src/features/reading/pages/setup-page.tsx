"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SetupScreen } from "@/features/reading/screens/SetupScreen";
import { buildSessionRequest } from "@/features/reading/session-start";
import { useReadingStep } from "@/features/reading/use-reading-step";
import { useSessionStart } from "@/features/reading/use-session-start";
import { scriptDetailPath, STEP_PATH } from "@/lib/reading/step";
import { storage, type StoredScript } from "@/lib/reading/storage";

/** /reading/setup — 배역 정하기. 시작하면 서버에 회차를 만들고 리딩으로 간다. */
export function SetupPage() {
  const router = useRouter();
  const { script: initial, ready } = useReadingStep("setup");
  // 목소리를 고치면 캐시의 대본도 바꾼다 — 실행 화면이 그 값으로 읽는다.
  const [script, setScript] = useState<StoredScript | null>(initial);
  const session = useSessionStart(() => router.push(STEP_PATH.run));
  if (!ready || !script) return <div className="min-h-svh" />;
  return (
    <SetupScreen
      script={script}
      starting={session.starting}
      error={session.error}
      onVoiceChange={(characterId, preset) => {
        const next = { ...script, characters: script.characters.map((c) => (c.id === characterId ? { ...c, voicePreset: preset } : c)) };
        setScript(next);
        storage.saveScript(next);
      }}
      onStart={(result) => {
        const body = buildSessionRequest(script, result);
        if (!body) return;
        void session.start(script.id, body, { partnerVoice: result.partnerVoice, mask: result.mask });
      }}
      onBack={() => router.push(scriptDetailPath(script.id))}
      onReinput={() => router.push(STEP_PATH.input)}
    />
  );
}
