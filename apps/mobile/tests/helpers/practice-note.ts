import type { PracticeNote } from '@/lib/practice/types';

export function practiceNote(overrides: Partial<PracticeNote> = {}): PracticeNote {
  return {
    id: 'n1',
    conversation_id: 'conv1',
    format: 'v2',
    kind: 'action',
    title: '첫 대사의 숨',
    summary_quotes: [],
    next_take: '첫 줄 전에 한 박자 쉬기',
    actor_words: [],
    corrections: [],
    tags: [],
    fallback: false,
    report: null,
    source_revision: 1,
    created_at: '2026-03-05T03:00:00Z',
    my_rating: null,
    ...overrides,
  };
}
