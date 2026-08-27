import type { SavedPracticeReport } from '@/lib/api';
import { translate } from './i18n.ts';

export type ReportDisplay = {
  title: string;
  found: string;
  blocked: string;
  evidence: string;
  actorWords: string;
  next: string;
  caution: string;
};

export function reportDisplay(report: SavedPracticeReport): ReportDisplay {
  if (report.report_type === 'analysis') {
    return {
      title: report.title,
      found: report.actor_discovery,
      blocked: report.line_meaning,
      evidence: report.evidence.join('\n'),
      actorWords: report.target_effect,
      next: translate('report.untried', { direction: report.next_take.direction }),
      caution: report.acting_caution,
    };
  }

  return {
    title: report.title,
    found: report.observed_change,
    blocked: report.blocked_point,
    evidence: report.evidence.join('\n'),
    actorWords: report.actor_words.join('\n'),
    next: report.next_take,
    caution: report.acting_trap,
  };
}
