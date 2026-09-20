"use client";

/**
 * /reading/scripts/<id> — 대본 상세. 프리렌더한 껍데기 하나를 rewrite 로 서빙하고 브라우저가 경로에서 id 를
 * 읽는다(next.config rewrites). 대본과 회차 목록을 서버에서 받고, 이어서 연습·새로운 연습·회차 삭제를 잇는다.
 */
import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { getScript } from "@/lib/api/v2/reading-scripts";
import { getSession, listSessions } from "@/lib/api/v2/reading-sessions";
import { errorMessage } from "@/lib/api/v2/errors";
import type { SessionCard, SessionDetail } from "@/lib/reading/api-types";
import { hasGuestSession } from "@/lib/auth/token-store";
import { useResource } from "@/lib/react/use-resource";
import { toStoredScript } from "@/lib/reading/script/from-server";
import { scriptIdFromPath, STEP_PATH } from "@/lib/reading/step";
import { storage, type StoredScript } from "@/lib/reading/storage";
import { adoptStoredScript } from "@/features/reading/script-save";
import { ScriptDetailScreen } from "@/features/reading/screens/ScriptDetailScreen";
import { Page } from "@/features/reading/page-shell";

const LOAD_FAILED_COPY = "대본을 불러오지 못했어요.";
const NOT_FOUND_COPY = "대본을 찾을 수 없어요. 목록에서 다시 골라 주세요.";
const RESUME_FAILED_COPY = "회차를 열지 못했어요. 다시 시도해 주세요.";

const noop = () => () => {};

type Loaded = { script: StoredScript; sessions: SessionCard[]; openSession: SessionDetail | null };

export function ScriptDetailPage() {
  const router = useRouter();
  const pathname = useSyncExternalStore(noop, () => window.location.pathname, () => "");
  const scriptId = scriptIdFromPath(pathname);
  const [version, setVersion] = useState(0);
  const key = scriptId && hasGuestSession() ? `${scriptId}:${version}` : null;
  const page = useResource<Loaded>(
    key,
    async (k, signal) => {
      const id = k.slice(0, k.lastIndexOf(":"));
      const [detail, list] = await Promise.all([getScript(id, { signal }), listSessions(id, { signal })]);
      const script = toStoredScript(detail);
      const openSession = detail.open_session_id ? await getSession(detail.open_session_id, { signal }) : null;
      return { script, sessions: list.sessions, openSession };
    },
    LOAD_FAILED_COPY,
  );
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (pathname === "") return <div className="min-h-svh" />;
  if (!scriptId || !hasGuestSession() || page.state === "failed") {
    return (
      <Page>
        <div className="p-5 flex flex-col gap-3">
          <p className="text-[14px] text-ink-3">{page.state === "failed" ? page.message : NOT_FOUND_COPY}</p>
          <button type="button" onClick={() => router.push(STEP_PATH.input)} className="text-[13px] font-bold text-blue text-left">
            대본 목록으로
          </button>
        </div>
      </Page>
    );
  }
  if (page.state !== "ready") return <div className="min-h-svh" />;
  const { script, sessions, openSession } = page.data;

  const resume = async () => {
    if (!openSession) return;
    setResuming(true);
    setError(null);
    try {
      // 목록을 본 사이 진행이 바뀌었을 수 있다 — 다시 받아 그 위치부터 연다.
      const fresh = await getSession(openSession.id);
      storage.saveScript(script);
      storage.saveSession(fresh);
      storage.saveStats(null);
      router.push(STEP_PATH.run);
    } catch (cause) {
      setError(errorMessage(cause, RESUME_FAILED_COPY));
      setResuming(false);
    }
  };

  return (
    <ScriptDetailScreen
      script={script}
      sessions={sessions}
      openSession={openSession}
      resuming={resuming}
      error={error}
      onResume={() => void resume()}
      onNew={() => {
        adoptStoredScript(script);
        router.push(STEP_PATH.setup);
      }}
      onDeleted={() => setVersion((v) => v + 1)}
      onBack={() => router.push(STEP_PATH.input)}
    />
  );
}
