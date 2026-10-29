import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { hasFinishedReading } from '@/lib/reading/first-reading';

/** 첫 리딩인가(리딩을 한 번도 끝내지 않은 계정, lib/reading/first-reading). null 은 아직 확인 중이다. */
export function useFirstReading(): boolean | null {
  const [first, setFirst] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void hasFinishedReading(() => api.listReadingScripts()).then((finished) => alive && setFirst(!finished));
    return () => {
      alive = false;
    };
  }, []);
  return first;
}
