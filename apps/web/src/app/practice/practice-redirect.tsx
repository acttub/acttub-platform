"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { preserveWebAttributionFromSearch } from "@/lib/analytics/web-attribution";

export default function PracticeRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace(
      preserveWebAttributionFromSearch("/home", window.location.search),
    );
  }, [router]);

  return null;
}
