"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  getStoredUser,
  isLoggedIn,
} from "../../lib/auth/token-store";
import { onSessionEvent } from "../../lib/auth/session-events";
import { errorMessage } from "../../lib/api/v2/errors";
import { resolveConsentEntry } from "./consent-entry";

export function useRequireAuth() {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [entryAttempt, setEntryAttempt] = useState(0);
  const retryEntry = useCallback(() => {
    setEntryError(null);
    setEntryAttempt((attempt) => attempt + 1);
  }, []);

  useEffect(() => {
    // 쿼리까지 실어야 /practice/history?session=<id> 링크가 로그인 뒤에도 살아남는다.
    // 붙잡아 두지 않고 그때그때 읽는다 — 로그아웃·만료는 나중에 일어나는데,
    // effect는 pathname만 보고 다시 돌기 때문에 ?session=A에서 B로 옮긴 뒤
    // 로그아웃되면 굳어 있던 A로 되돌아가 엉뚱한 세션이 열린다.
    const nextPathNow = () =>
      `${window.location.pathname}${window.location.search}`;
    const loginPathNow = () =>
      `/login?next=${encodeURIComponent(nextPathNow())}`;
    let cancelled = false;
    const readyTimer: { id?: number } = {};
    const redirectToLogin = () => {
      cancelled = true;
      if (readyTimer.id !== undefined) window.clearTimeout(readyTimer.id);
      setReady(false);
      setEntryError(null);
      router.replace(loginPathNow());
    };
    const unsubscribe = onSessionEvent((event) => {
      if (event !== "logout") return;
      redirectToLogin();
    });
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "acttub.refresh_token" && event.newValue === null) {
        redirectToLogin();
      }
    };
    window.addEventListener("storage", handleStorage);
    const cleanup = () => {
      cancelled = true;
      if (readyTimer.id !== undefined) window.clearTimeout(readyTimer.id);
      unsubscribe();
      window.removeEventListener("storage", handleStorage);
    };

    if (!isLoggedIn()) {
      router.replace(loginPathNow());
      return cleanup;
    }

    void resolveConsentEntry(nextPathNow())
      .then((resolution) => {
        if (cancelled || !isLoggedIn()) return;
        if (resolution.kind !== "allowed") {
          router.replace(resolution.destination);
          return;
        }
        readyTimer.id = window.setTimeout(() => {
          if (!cancelled && isLoggedIn()) setReady(true);
        }, 0);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setEntryError(
          errorMessage(cause, "동의 결정을 확인하지 못했어요."),
        );
      });
    return cleanup;
  }, [entryAttempt, pathname, router]);

  return { ready, user: getStoredUser(), entryError, retryEntry };
}
