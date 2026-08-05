export type ReportPractice<T> = {
  coachSessionId: string | null;
  report: T | null;
};

export async function createOrReuseReport<T>(
  practice: ReportPractice<T>,
  createReport: (coachSessionId: string) => Promise<T>,
): Promise<T> {
  if (practice.report) return practice.report;
  if (!practice.coachSessionId) {
    throw new Error('코치 대화가 끝나지 않아 카드를 만들 수 없어요.');
  }
  const report = await createReport(practice.coachSessionId);
  practice.report = report;
  return report;
}
