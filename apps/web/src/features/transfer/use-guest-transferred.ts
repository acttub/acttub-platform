"use client";

import { useCallback, useEffect, useState } from "react";

import { onSessionEvent } from "@/lib/auth/session-events";

/** 새로 시작하는 자리. 화면이 들고 있던 옮겨진 게스트의 연습을 통째로 버리려고 하드 이동한다. */
const START_OVER_PATH = "/practice/new";

function hardNavigate(path: string): void {
  window.location.assign(path);
}

/**
 * 이 브라우저의 게스트가 앱으로 옮겨졌는지. 어떤 요청이든 서버가 guest_transferred 로 답하면
 * 공용 클라이언트가 토큰을 지우고 알린다 — 액세스 403 이든 갱신 401 이든, 이 기기에서 옮겼든
 * 다른 기기에서 옮겼든 같다(account.guest).
 *
 * 새로 시작해도 게스트를 바로 만들지 않는다. 새 게스트는 다른 방문자와 똑같이 처음 보호
 * 기능을 쓰려 할 때 생긴다.
 */
export function useGuestTransferred(
  navigate: (path: string) => void = hardNavigate,
): { transferred: boolean; startOver: () => void } {
  const [transferred, setTransferred] = useState(false);

  useEffect(
    () =>
      onSessionEvent((event) => {
        if (event === "guest-transferred") setTransferred(true);
      }),
    [],
  );

  const startOver = useCallback(() => {
    setTransferred(false);
    navigate(START_OVER_PATH);
  }, [navigate]);

  return { transferred, startOver };
}
