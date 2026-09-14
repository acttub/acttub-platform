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

export function practiceNoteSections(note: PublicPracticeNote): { label: string; text: string }[] {
  const sections: { label: string; text: string }[] = [];
  const add = (label: string, text: string | null | undefined) => {
    if (text?.trim()) sections.push({ label, text });
  };
  add('이번 대화', note.summary);
  if (note.direction) add(note.direction.origin === 'coach_proposed' ? '함께 살펴볼 방향' : '내가 바라는 전달', note.direction.text);
  if (note.focus) add('살펴본 순간', [note.focus.start_ms == null ? '' : `${(note.focus.start_ms / 1000).toFixed(1)}초`, note.focus.quote, note.focus.label].filter(Boolean).join(' · '));
  add('대화에서 짚은 읽힘', note.reading);
  if (note.practice) {
    add(note.practice.selection === 'selected' ? '선택한 다음 연습' : '다음 연습 제안', note.practice.instruction);
    add('해본 뒤 비교할 것', note.practice.comparison);
    add('함께 유지할 것', note.practice.keep);
  }
  for (const attempt of note.attempts) {
    add(attempt.execution === 'reported_tried' ? '직접 해봤다고 남긴 연습' : attempt.execution === 'not_tried' ? '아직 해보지 않았다고 남긴 연습' : '실행 여부를 확인하지 않은 연습', attempt.instruction);
    add('배우가 전한 변화', attempt.result?.statement);
  }
  add('확인한 기록', note.evidence.map(item => item.text).join('\n'));
  add('아직 열어 둔 부분', note.open_points.join('\n'));
  if (note.mode === 'record_only') add('이번 대화 기록', '오늘 나눈 대화를 남겼어요. 다음에 원하는 장면부터 이어갈 수 있어요.');
  return sections;
}
