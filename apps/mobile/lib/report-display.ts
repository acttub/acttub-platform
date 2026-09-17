import type { SavedPracticeReport, PublicPracticeNote } from '@/lib/api';
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
    return { title: '연습 노트를 다시 불러와 주세요', found: '', blocked: '', evidence: '', actorWords: '', next: '', caution: '' };
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
      kind: 'summary', label: '이번 대화 요약',
      text: note.summary?.trim()
        || (note.focus ? `${note.focus.label} 부분을 함께 살펴봤어요.` : '이번에는 구체적인 촬영 방향을 정하지 않았어요.'),
    },
    {
      kind: 'next', label: '다음 촬영에서 해볼 것',
      text: note.practice?.instruction || '이번에는 촬영 아이템을 정하지 않았어요.',
    },
    {
      kind: 'encouragement', label: '',
      text: '오늘 촬영도 수고했어요.\n다음 촬영도 응원할게요.',
    },
  ];
}
