import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { journalNext, readOptionalJournal } from '@/lib/practice/journal';
import { noteNextTake } from '@/lib/practice/note';

/**
 * 노트 회차들의 「다음에 해 볼 것」(다음 테이크 문장)을 불러온다. 목록 응답에는 이 문장이 없어 노트를 따로 읽는다.
 * 그 회차에 배우 일지가 있고 배우가 「다음엔 뭘 해 볼래요?」에 직접 쓴 글이 있으면 그것을 먼저 쓴다(SOMA-720) — 배우가 정한 것이
 * 코치 제안보다 앞선다. 일지를 못 읽으면 노트 값 그대로다.
 * 아직 못 받았거나 없거나 실패하면 그 회차는 값이 없다(undefined/null) — 화면은 그 칸을 띄우지 않는다.
 */
export function useNextTakes(practiceIds: readonly (string | null | undefined)[]): Record<string, string | null> {
  const [takes, setTakes] = useState<Record<string, string | null>>({});
  const key = [...new Set(practiceIds.filter((id): id is string => !!id))].join('|');

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    for (const id of key.split('|')) {
      const journal = readOptionalJournal(api.getPracticeJournal, id).catch(() => null);
      api
        .getPracticeNote(id)
        .then((note) => noteNextTake(note))
        .catch(() => null)
        .then(async (fromNote) => {
          const fromJournal = journalNext(await journal);
          if (!cancelled) setTakes((was) => ({ ...was, [id]: fromJournal ?? fromNote }));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [key]);

  return takes;
}
