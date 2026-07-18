"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LegacyPracticePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/home");
  }, [router]);

  return null;
}
