"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { onSessionEvent } from "@/lib/auth/session-events";
import { createConsentRedirectHandler } from "./consent-redirect";

export function ConsentRedirectListener() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const redirect = createConsentRedirectHandler(
      (destination) => router.replace(destination),
      () => ({
        pathname: window.location.pathname,
        search: window.location.search,
      }),
    );
    return onSessionEvent((event) => {
      if (event !== "consent-required") return;
      redirect();
    });
  }, [pathname, router]);

  return null;
}
