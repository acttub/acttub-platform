"use client";

/**
 * /reading/memorize — 암기 화면. 대상은 storage 의 MemorizeEntry(대본 상세 또는 완료 화면이 둔 것)가 정하고,
 * 암기 상태는 대본 단위로 한 번에 받는다. 갱신은 줄마다 즉시 보내고 실패하면 다시 보낸다.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { listMemorization, setMemorization } from "@/lib/api/v2/reading-memorization";
import type { MemorizationEntry } from "@/lib/reading/api-types";
import { hasGuestSession } from "@/lib/auth/token-store";
import { createMemorizationSync } from "@/lib/reading/memorization/sync";
import { useResource } from "@/lib/react/use-resource";
import { scriptDetailPath, STEP_PATH } from "@/lib/reading/step";
import { storage, type MemorizeEntry, type StoredScript } from "@/lib/reading/storage";
import { MemorizationScreen } from "@/features/reading/screens/MemorizationScreen";
import { Page } from "@/features/reading/page-shell";

const LOAD_FAILED_COPY = "암기 상태를 불러오지 못했어요.";
const isClient = typeof window !== "undefined";

export function MemorizePage() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [script] = useState<StoredScript | null>(() => (isClient ? storage.loadScript() : null));
  const [entry, setEntry] = useState<MemorizeEntry | null>(() => (isClient ? storage.loadMemorizeEntry() : null));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
  }, []);
  const usable = hydrated && script && entry && entry.scriptId === script.id && hasGuestSession();
  useEffect(() => {
    if (hydrated && !usable) router.replace(STEP_PATH.input);
  }, [hydrated, usable, router]);

  const entries = useResource<MemorizationEntry[]>(usable ? script.id : null, (id, signal) => listMemorization(id, { signal }), LOAD_FAILED_COPY);
  const sync = useMemo(
    () => (entries.state === "ready" ? createMemorizationSync({ initial: entries.data, send: (lineId, status) => setMemorization(lineId, status) }) : null),
    [entries],
  );
  // 오프라인에서 토글한 것은 연결이 돌아올 때 다시 보낸다.
  useEffect(() => {
    if (!sync) return;
    const onOnline = () => void sync.flush();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [sync]);

  if (!usable) return <div className="min-h-svh" />;
  if (entries.state === "failed") {
    return (
      <Page>
        <div className="p-5 flex flex-col gap-3">
          <p className="text-[14px] text-ink-3">{entries.message}</p>
          <button type="button" onClick={() => router.push(scriptDetailPath(script.id))} className="text-[13px] font-bold text-blue text-left">
            대본 상세로
          </button>
        </div>
      </Page>
    );
  }
  if (!sync) return <div className="min-h-svh" />;
  return (
    <MemorizationScreen
      script={script}
      roles={entry.roles}
      lineIds={entry.lineIds}
      sync={sync}
      onRolesChange={(roles) => {
        const next = { ...entry, roles };
        setEntry(next);
        storage.saveMemorizeEntry(next);
      }}
      onBack={() => router.push(scriptDetailPath(script.id))}
      onReading={() => router.push(scriptDetailPath(script.id))}
    />
  );
}
