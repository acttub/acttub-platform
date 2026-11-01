"use client";

/**
 * 회차 시작 버튼이 쓰는 상태. 같은 본문에는 같은 요청 id 를 다시 쓴다 — 실패 뒤 다시 눌러도 회차가 하나다
 * (reading.session). 성공하면 회차·기기 설정을 캐시에 두고 실행으로 간다.
 */
import { useRef, useState } from "react";
import { createSession } from "@/lib/api/v2/reading-sessions";
import { errorMessage } from "@/lib/api/v2/errors";
import type { SessionCreateRequest, SessionDetail } from "@/lib/reading/api-types";
import { newRequestId } from "@/lib/reading/request-id";
import { saveMask, type MaskMode } from "@/lib/reading/session/mask";
import { storage, type RunPrefs } from "@/lib/reading/storage";

export const START_FAILED_COPY = "회차를 시작하지 못했어요. 다시 시도해 주세요.";

export interface SessionStart {
  start: (scriptId: string, body: Omit<SessionCreateRequest, "request_id">, prefs: RunPrefs & { mask?: MaskMode }) => Promise<void>;
  starting: boolean;
  error: string | null;
}

export function useSessionStart(onStarted: (session: SessionDetail) => void): SessionStart {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ key: string; id: string } | null>(null);

  const requestIdFor = (scriptId: string, body: unknown) => {
    const key = JSON.stringify([scriptId, body]);
    if (request.current?.key !== key) request.current = { key, id: newRequestId() };
    return request.current.id;
  };

  const start: SessionStart["start"] = async (scriptId, body, prefs) => {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const { session } = await createSession(scriptId, body, { requestId: requestIdFor(scriptId, body) });
      if (prefs.mask) saveMask(scriptId, prefs.mask);
      storage.saveRunPrefs({ partnerVoice: prefs.partnerVoice });
      storage.saveSession(session);
      storage.saveStats(null);
      onStarted(session);
    } catch (cause) {
      setError(errorMessage(cause, START_FAILED_COPY));
      setStarting(false);
    }
  };

  return { start, starting, error };
}
