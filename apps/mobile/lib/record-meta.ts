import type { RecordMeta } from '@/components/record-card';

/**
 * 기록 카드에 붙일 부가정보를 채운다.
 *
 * 목록 API(GET /v2/reports)는 headline·created_at만 주므로 카드별 상세를 따로 불러야 한다.
 * 한 번에 다 던지면 기록이 쌓일수록 동시 요청이 폭주해서 동시 실행 수를 제한한다.
 * 실패한 항목은 빈 meta로 두고 나머지는 그대로 보여준다(카드가 통째로 사라지지 않게).
 *
 * 예전에는 리포트의 `biggest_problem.dimension`(6축 진단)을 읽었다. 그 개념이
 * 폐기되면서 응답에서 사라져 늘 빈 값이 나오고 있었다. 지금은 연습 카드가 분석·표현
 * 중 어느 쪽인지를 칩으로 쓴다.
 */
export const RECORD_META_CONCURRENCY = 4;

type ReportLike = {
  report?: unknown;
};

const KIND_LABEL: Record<string, string> = {
  analysis: '분석',
  expression: '표현',
};

export function toRecordMeta(detail: ReportLike | null | undefined): RecordMeta {
  const report = detail?.report;
  const kind =
    report && typeof report === 'object' && 'report_type' in report
      ? String((report as { report_type?: unknown }).report_type ?? '')
      : '';
  return { kind: KIND_LABEL[kind] ?? '', start: '', end: '' };
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
        out[id] = { kind: '', start: '', end: '' };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, ids.length) }, worker));
  return out;
}
