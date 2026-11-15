import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { api } from '@/lib/api';
import { POLL_MS } from '@/lib/reading/script-import';
import { checkSplitJob, readSplitJobs, removeSplitJob, type SplitJob } from '@/lib/reading/split-jobs';
import { useFocusLoad } from '@/hooks/use-focus-load';

export type SplitJobRow = SplitJob & { failed: boolean; pct: number };

/**
 * 리딩 탭이 보이는 동안 기기에 기록된 나누기 작업을 묻는다(SOMA-976). 작업이 여럿이어도 1초에 한 번, 한 작업씩만 묻는다 —
 * 계정마다 분당 요청 한도가 있다. 기록도 매번 다시 읽는다: 파일을 읽는 사이 나가면 작업이 탭에 온 뒤에 접수된다.
 * 첫 답을 받기 전에는 행을 그리지 않아, 이미 끝난 작업(완료 푸시로 넘어간 경우)이나 남의 작업이 비치지 않는다.
 */
export function useSplitJobs(onSucceeded: () => Promise<void>) {
  const [rows, setRows] = useState<SplitJobRow[]>([]);
  const known = useRef(new Map<string, SplitJobRow>());
  const refresh = useRef(onSucceeded);
  refresh.current = onSucceeded;

  useFocusLoad((alive) => {
    void (async () => {
      let turn = 0;
      while (alive()) {
        const jobs = await readSplitJobs();
        // 실패는 서버에서 바뀌지 않으므로 [지우기]까지 다시 묻지 않는다.
        const open = jobs.filter((job) => !known.current.get(job.importId)?.failed);
        const job = open[turn++ % open.length];
        if (job && AppState.currentState !== 'background') {
          const check = await checkSplitJob(job.importId, (id) => api.getScriptImport(id));
          if (!alive()) return;
          if (check.kind === 'running') known.current.set(job.importId, { ...job, failed: false, pct: check.pct });
          if (check.kind === 'failed') known.current.set(job.importId, { ...job, failed: true, pct: 0 });
          // 목록을 받은 뒤에 행을 뺀다 — 행이 사라지고 대본이 뒤늦게 나타나지 않게.
          if (check.kind === 'succeeded') await refresh.current();
          if (check.kind === 'succeeded' || check.kind === 'gone') {
            known.current.delete(job.importId);
            await removeSplitJob(job.importId);
          }
          if (!alive()) return;
        }
        const next = jobs.flatMap((one) => known.current.get(one.importId) ?? []);
        setRows((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    })();
  }, []);

  const dismiss = useCallback((importId: string) => {
    known.current.delete(importId);
    setRows((prev) => prev.filter((row) => row.importId !== importId));
    void removeSplitJob(importId);
  }, []);

  return { rows, dismiss };
}
