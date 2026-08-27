import { translate } from './i18n.ts';

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
    throw new Error(translate('report.notDone'));
  }
  const report = await createReport(practice.coachSessionId);
  practice.report = report;
  return report;
}
