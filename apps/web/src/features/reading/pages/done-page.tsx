"use client";

import { useRouter } from "next/navigation";
import { useCompletionPending } from "@/features/reading/hooks/useCompletionPending";
import { DoneScreen } from "@/features/reading/screens/DoneScreen";
import { useReadingStep } from "@/features/reading/use-reading-step";
import { useSessionStart } from "@/features/reading/use-session-start";
import { getSession } from "@/lib/api/v2/reading-sessions";
import { useResource } from "@/lib/react/use-resource";
import { reviewFor } from "@/lib/reading/session/results";
import { MEMORIZE_PATH, scriptDetailPath, STEP_PATH } from "@/lib/reading/step";
import { storage } from "@/lib/reading/storage";

/** /reading/done — 완료. 다시 리딩(같은 설정의 새 회차) · 배역·방식 바꾸기 · 새 대본 · 회차 목록. */
export function DonePage() {
  const router = useRouter();
  const { script, session, stats, ready } = useReadingStep("done");
  const repeat = useSessionStart(() => router.push(STEP_PATH.run));
  const { completing, uploading } = useCompletionPending(session?.id ?? null);
  // read 의 완료 응답을 받지 못했다(끊김·409 session_closed). 완료 저장이 끝나면 회차 상세의 different_lines 를 읽는다.
  const detailKey = session && stats?.mode === "read" && !stats.differentLines && !completing ? session.id : null;
  const detail = useResource(detailKey, (id, signal) => getSession(id, { signal }), "");
  if (!ready || !script || !session || !stats) return <div className="min-h-svh" />;
  const shown = detail.state === "ready" ? { ...stats, differentLines: detail.data.different_lines } : stats;
  return (
    <DoneScreen
      script={script}
      stats={shown}
      repeating={repeat.starting}
      error={repeat.error}
      saving={completing || uploading}
      onReview={() => {
        storage.saveMemorizeEntry({ scriptId: script.id, roles: session.my_character_names, lineIds: (reviewFor(script, shown) ?? []).map((r) => r.lineId) });
        router.push(MEMORIZE_PATH);
      }}
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
