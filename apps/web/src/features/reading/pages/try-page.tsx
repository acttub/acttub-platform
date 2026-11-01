"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { micSupported } from "@/lib/reading/audio/mic";
import { trackTrialStart } from "@/lib/analytics/ga";
import { trialEntryFromSearch } from "@/features/trial/trial-paths";
import {
  prepareSampleScript,
  QUICK_START_COPY,
  quickStartRequest,
  quickStartRoleFromSearch,
} from "@/features/reading/quick-start";
import { useSessionStart } from "@/features/reading/use-session-start";
import { apiDeps } from "@/features/reading/use-script-import";
import { storage } from "@/lib/reading/storage";
import { STEP_PATH } from "@/lib/reading/step";

/**
 * /reading/try — 빠른 시작. 예시 대본을 불러와 회차를 만들고 곧바로 리딩 실행 화면으로 간다(입력·배역 단계 없음).
 * 광고 링크는 이 주소에 UTM 만 붙인다. 처음 읽는 배역은 윤서이고, `?role=taeo` 면 태오다.
 * 실행 화면의 시작 버튼을 누를 때 소리·마이크 권한 요청이 사용자 동작으로 이뤄진다.
 */
export function TryPage() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const session = useSessionStart(() => router.replace(STEP_PATH.run));
  const startRef = useRef(session.start);
  useEffect(() => {
    startRef.current = session.start;
  });
  const reported = useRef(false);

  useEffect(() => {
    if (!reported.current) {
      reported.current = true;
      trackTrialStart("reading", trialEntryFromSearch(window.location.search));
    }
    const ac = new AbortController();
    (async () => {
      try {
        const script = await prepareSampleScript({ importDeps: apiDeps, cached: storage.loadScript(), signal: ac.signal });
        if (ac.signal.aborted) return;
        const body = quickStartRequest(script, quickStartRoleFromSearch(window.location.search), micSupported());
        if (!body) throw new Error("no_lines");
        await startRef.current(script.id, body, { partnerVoice: "supertonic" });
      } catch {
        if (!ac.signal.aborted) setFailed(true);
      }
    })();
    return () => ac.abort();
  }, [attempt]);

  const error = failed || session.error;
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 px-6 text-center">
      {error ? (
        <>
          <p className="text-[16px] font-extrabold">{QUICK_START_COPY.failed}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setFailed(false);
                setAttempt((n) => n + 1);
              }}
              className="h-11 rounded-[14px] bg-[#3182f6] px-5 text-[14px] font-bold text-white"
            >
              {QUICK_START_COPY.retry}
            </button>
            <Link href="/reading" className="inline-flex h-11 items-center rounded-[14px] bg-[#f2f4f6] px-5 text-[14px] font-bold text-[#4e5968]">
              {QUICK_START_COPY.own}
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="text-[16px] font-extrabold" role="status">
            {QUICK_START_COPY.preparing}
          </p>
          <p className="text-[13px] text-[#8b95a1]">{QUICK_START_COPY.preparingNote}</p>
        </>
      )}
    </main>
  );
}
