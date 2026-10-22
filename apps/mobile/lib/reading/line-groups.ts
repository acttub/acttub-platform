/**
 * 같은 배역 연속 대사 묶기(SOMA-806, reading.session 「같은 배역 연속 대사」) — 순수 함수.
 *
 * 저장된 줄은 그대로 두고 화면이 그릴 때마다 묶는다(배역이 잘못 나뉘면 줄 단위로 고쳐야 해서). 같은 배역의 대사 줄이 연달아
 * 나오면 한 묶음이고, 사이에 지문·장면이 끼면 끊는다. 배역 이름은 대본 안에서 유일해 이름이 같으면 배역 id 도 같다 — 묶음 배역
 * 「민재, 서연」과 「민재」는 다른 배역이라 묶지 않는다. 독백은 서버가 문장마다 나눠 둔 것이 의도라 묶지 않는다.
 */
import type { ScriptLine } from './types.ts';

/** 묶음의 첫 줄·끝 줄 인덱스(둘 다 포함). 지문·장면 줄과 묶이지 않은 대사는 start === end 다. */
export type LineGroup = { start: number; end: number };

/** 모든 줄을 순서대로 덮는 묶음 목록. */
export function lineGroups(lines: ScriptLine[], opts: { monologue: boolean }): LineGroup[] {
  const groups: LineGroup[] = [];
  lines.forEach((line, i) => {
    const prev = lines[i - 1];
    const last = groups[groups.length - 1];
    const joins =
      !opts.monologue && last && line.type === 'dialogue' && prev?.type === 'dialogue' && !!line.role && prev.role === line.role;
    if (joins) last.end = i;
    else groups.push({ start: i, end: i });
  });
  return groups;
}
