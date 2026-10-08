"use client";

// app.audition — /auditions 껍데기. 공고는 매일 두 번 바뀌므로 프리렌더된 HTML에는 싣지 않고,
// 열 때마다 /v2/auditions 를 묻는다. 찜·봤음은 이 브라우저에만 둔다(marks).

import { useState } from "react";

import { RailLayout } from "@/features/nav/app-rail";
import { getAuditions } from "@/lib/api/v2/auditions";
import { useResource } from "@/lib/react/use-resource";

import { EMPTY_AUDITION_FILTERS, kstDate, type AuditionFilters } from "./audition-list";
import { AuditionsBody } from "./auditions-body";
import { readMarks, writeMarks, type AuditionMark } from "./marks";

export function AuditionsPage() {
  // 「다시 시도」는 키를 바꿔 다시 묻는다 — useResource 는 키가 바뀔 때만 다시 묻는다.
  const [attempt, setAttempt] = useState(0);
  const auditions = useResource(
    `auditions:${attempt}`,
    (_, signal) => getAuditions({ signal }),
    "오디션 공고를 불러오지 못했어요.",
  );
  const [filters, setFilters] = useState<AuditionFilters>(EMPTY_AUDITION_FILTERS);
  // 서버 렌더에서는 window 가 없어 빈 집합이다. 카드는 응답이 온 뒤에야 그려지므로 하이드레이션과 어긋나지 않는다.
  const [starred, setStarred] = useState(() => readMarks("starred"));
  const [seen, setSeen] = useState(() => readMarks("seen"));

  const ready = auditions.state === "ready" ? auditions : null;

  const update = (mark: AuditionMark, id: string, on: boolean) => {
    const [was, set] = mark === "starred" ? [starred, setStarred] : [seen, setSeen];
    const next = new Set(was);
    if (on) next.add(id);
    else next.delete(id);
    set(next);
    writeMarks(mark, next);
  };

  return (
    <RailLayout>
      <main className="h-full">
        <AuditionsBody
          status={auditions.state === "idle" ? "loading" : auditions.state}
          items={ready?.data.items ?? []}
          collectedAt={ready?.data.collected_at ?? null}
          today={ready ? kstDate(new Date(ready.receivedAt)) : null}
          now={ready?.receivedAt ?? 0}
          errorMessage={auditions.state === "failed" ? auditions.message : null}
          filters={filters}
          starred={starred}
          seen={seen}
          onFilters={setFilters}
          onToggleStar={(id) => update("starred", id, !starred.has(id))}
          onOpen={(id) => update("seen", id, true)}
          onRetry={() => setAttempt((was) => was + 1)}
        />
      </main>
    </RailLayout>
  );
}
