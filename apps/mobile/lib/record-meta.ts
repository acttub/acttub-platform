import type { RecordMeta } from '@/components/record-card';

/**
 * 기록 카드에 붙일 부가정보(진단 축 키워드·문제 구간)를 채운다.
 *
 * 목록 API(GET /v2/reports)는 headline·created_at만 주므로 카드별 상세를 따로 불러야 한다.
 * 한 번에 다 던지면 기록이 쌓일수록 동시 요청이 폭주해서 동시 실행 수를 제한한다.
 * 실패한 항목은 빈 meta로 두고 나머지는 그대로 보여준다(카드가 통째로 사라지지 않게).
 */
export const RECORD_META_CONCURRENCY = 4;

type ReportLike = {
  report?: { biggest_problem?: { dimension?: string; start?: string; end?: string } | null } | null;
};

export function toRecordMeta(detail: ReportLike | null | undefined): RecordMeta {
  const problem = detail?.report?.biggest_problem;
  return {
    dimension: problem?.dimension ?? '',
    start: problem?.start ?? '',
    end: problem?.end ?? '',
  };
}

export async function loadRecordMeta(
  ids: readonly string[],
  getReport: (id: string) => Promise<ReportLike>,
  concurrency: number = RECORD_META_CONCURRENCY,
): Promise<Record<string, RecordMeta>> {
  const out: Record<string, RecordMeta> = {};
  const queue = [...ids];
  const limit = Math.max(1, concurrency);

  const worker = async () => {
    for (;;) {
      const id = queue.shift();
      if (id === undefined) return;
      try {
        out[id] = toRecordMeta(await getReport(id));
      } catch {
        out[id] = { dimension: '', start: '', end: '' };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, ids.length) }, worker));
  return out;
}
