/**
 * 배우 기억(practice.memory)의 화면 규칙. 항목은 넷이고 성별·나이는 프로필로 옮겼다 —
 * 코치는 영상이나 말투에서 그것을 추론하지 않는다. 배우가 직접 적거나 고친 값은 코치가 덮지
 * 않으므로 "내가 적은 값"을 표시한다. 값은 1,000자까지다.
 */
export const MEMORY_FIELDS = ['goal', 'blockage', 'speech_self', 'speech_actual'] as const;

export type MemoryFieldName = (typeof MEMORY_FIELDS)[number];

export const MEMORY_VALUE_MAX = 1_000;

export function memoryValueTooLong(value: string): boolean {
  return value.trim().length > MEMORY_VALUE_MAX;
}
