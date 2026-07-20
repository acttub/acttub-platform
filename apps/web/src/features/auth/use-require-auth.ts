"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  getStoredUser,
  isLoggedIn,
} from "../../lib/auth/token-store";
import { onSessionEvent } from "../../lib/auth/session-events";
import { hasPendingConsents } from "./pending-consents";

export function useRequireAuth() {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const loginPath = `/login?next=${pathname}`;
    let cancelled = false;
    const readyTimer: { id?: number } = {};
    const redirectToLogin = () => {
      cancelled = true;
      if (readyTimer.id !== undefined) window.clearTimeout(readyTimer.id);
      setReady(false);
      router.replace(loginPath);
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
      router.replace(loginPath);
      return cleanup;
    }

    if (hasPendingConsents()) {
      router.replace(`/terms?next=${pathname}`);
      return cleanup;
    }

    readyTimer.id = window.setTimeout(() => {
      if (!cancelled && isLoggedIn()) setReady(true);
    }, 0);
    return cleanup;
  }, [pathname, router]);

  return { ready, user: getStoredUser() };
}
