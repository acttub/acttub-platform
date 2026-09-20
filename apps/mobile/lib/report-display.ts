import type { SavedPracticeReport, PublicPracticeNote } from '@/lib/api';
import { translate, translate as t } from './i18n.ts';

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
  if (report.report_type === 'practice_note') {
    return { title: report.title, found: report.summary ?? '', blocked: report.reading ?? '',
      evidence: report.evidence.map(item => item.text).join('\n'), actorWords: report.direction?.text ?? '',
      next: report.practice?.instruction ?? '', caution: '' };
  }
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

  if (report.report_type !== 'expression') {
    return { title: t('report.noteReload'), found: '', blocked: '', evidence: '', actorWords: '', next: '', caution: '' };
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

export type PracticeNoteSection = {
  kind: 'summary' | 'next' | 'encouragement';
  label: string;
  text: string;
};

export function practiceNoteSections(note: PublicPracticeNote): PracticeNoteSection[] {
  return [
    {
      kind: 'summary', label: t('report.noteSummaryLabel'),
      text: note.summary?.trim()
        || (note.focus
          ? t('report.noteSummaryFocus', { label: note.focus.label })
          : t('report.noteSummaryEmpty')),
    },
    {
      kind: 'next', label: t('report.noteNextLabel'),
      text: note.practice?.instruction || t('report.noteNextEmpty'),
    },
    {
      kind: 'encouragement', label: '',
      text: t('report.noteEncouragement'),
    },
  ];
}
