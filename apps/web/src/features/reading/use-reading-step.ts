"use client";

/**
 * 단계 페이지가 공통으로 하는 일 — 저장된 대본·설정·결과를 읽고, 앞 단계가 비어 있으면
 * 앞 페이지로 돌려보낸다. 서버에서는 저장소가 없으므로 하이드레이션이 끝난 뒤에만 그린다.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useDesktop } from "@/features/reading/hooks/useMediaQuery";
import { redirectFor, type Step } from "@/lib/reading/step";
import { storage, type RunStats, type Setup, type StoredScript } from "@/lib/reading/storage";

const noop = () => () => {};
function useHydrated() {
  return useSyncExternalStore(noop, () => true, () => false);
}
const isClient = typeof window !== "undefined";

export interface ReadingStep {
  script: StoredScript | null;
  setup: Setup | null;
  stats: RunStats | null;
  /** 그려도 되는가 — 하이드레이션이 끝났고 돌려보낼 곳이 없을 때 */
  ready: boolean;
  desktop: boolean;
}

export function useReadingStep(step: Step): ReadingStep {
  const hydrated = useHydrated();
  const desktop = useDesktop();
  const router = useRouter();
  // 초기값을 저장소에서 읽어도 hydrated 가 false 인 동안은 빈 화면만 그리므로 서버 HTML 과 어긋나지 않는다
  const [script] = useState<StoredScript | null>(() => (isClient ? storage.loadScript() : null));
  const [setup] = useState<Setup | null>(() => (isClient ? storage.loadSetup() : null));
  const [stats] = useState<RunStats | null>(() => (isClient ? storage.loadStats() : null));

  const to = hydrated
    ? redirectFor(step, { hasScript: !!script, hasSetup: !!setup, hasStats: !!stats, desktop })
    : null;

  useEffect(() => {
    if (to) router.replace(to);
  }, [to, router]);

  return { script, setup, stats, ready: hydrated && !to, desktop };
}
