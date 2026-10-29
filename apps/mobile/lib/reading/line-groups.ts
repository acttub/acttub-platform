/**
 * 같은 배역 연속 대사 묶기(SOMA-806, reading.session 「같은 배역 연속 대사」) — 순수 함수.
 *
 * 저장된 줄은 그대로 두고 화면이 그릴 때마다 묶는다(배역이 잘못 나뉘면 줄 단위로 고쳐야 해서). 같은 배역의 대사 줄이 연달아
 * 나오면 한 묶음이고, 사이에 지문·장면이 끼면 끊는다. 배역 이름은 대본 안에서 유일해 이름이 같으면 배역 id 도 같다 — 묶음 배역
 * 「민재, 서연」과 「민재」는 다른 배역이라 묶지 않는다. 독백은 서버가 문장마다 나눠 둔 것이 의도라 묶지 않는다.
 * 같은 배역이 10줄을 넘게 이어 말하면 10줄씩 끊는다 — 말풍선 하나가 화면을 넘지 않게(SOMA-934).
 */
import type { ScriptLine } from './types.ts';

/** 묶음의 첫 줄·끝 줄 인덱스(둘 다 포함). 지문·장면 줄과 묶이지 않은 대사는 start === end 다. */
export type LineGroup = { start: number; end: number };

/** 한 묶음(말풍선·한 차례)에 담는 최대 대사 수 — 넘으면 10줄씩 끊는다(SOMA-934, 독백 말풍선과 같은 수). */
export const MAX_GROUP_LINES = 10;

/** 모든 줄을 순서대로 덮는 묶음 목록. */
export function lineGroups(lines: ScriptLine[], opts: { monologue: boolean; maxLines?: number }): LineGroup[] {
  // 묶음 상한은 회차 응답 chunk_lines(서버 설정, SOMA-938)를 받고, 없거나 이상하면 10.
  const max = opts.maxLines && opts.maxLines >= 1 ? opts.maxLines : MAX_GROUP_LINES;
  const groups: LineGroup[] = [];
  lines.forEach((line, i) => {
    const prev = lines[i - 1];
    const last = groups[groups.length - 1];
    const joins =
      !opts.monologue &&
      last &&
      last.end - last.start + 1 < max &&
      line.type === 'dialogue' &&
      prev?.type === 'dialogue' &&
      !!line.role &&
      prev.role === line.role;
    if (joins) last.end = i;
    else groups.push({ start: i, end: i });
  });
  return groups;
}
