import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { noteNextTake } from '@/lib/practice/note';

/**
 * 노트 회차들의 「다음에 해 볼 것」(다음 테이크 문장)을 불러온다. 목록 응답에는 이 문장이 없어 노트를 따로 읽는다.
 * 아직 못 받았거나 없거나 실패하면 그 회차는 값이 없다(undefined/null) — 화면은 그 칸을 띄우지 않는다.
 */
export function useNextTakes(practiceIds: readonly (string | null | undefined)[]): Record<string, string | null> {
  const [takes, setTakes] = useState<Record<string, string | null>>({});
  const key = [...new Set(practiceIds.filter((id): id is string => !!id))].join('|');

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    for (const id of key.split('|')) {
      api
        .getPracticeNote(id)
        .then((note) => {
          if (!cancelled) setTakes((was) => ({ ...was, [id]: noteNextTake(note) }));
        })
        .catch(() => {
          if (!cancelled) setTakes((was) => ({ ...was, [id]: null }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [key]);

  return takes;
}
