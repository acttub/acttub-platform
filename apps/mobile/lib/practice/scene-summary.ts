/**
 * 분석 대기·연습 노트의 「분석에 쓰는 내용」 줄(SOMA-740).
 *
 * 준비 화면은 연습 제목과 막힌 곳만 받는다. 상황·인물·목표 칸은 없으므로 비어 있는 것은
 * 「적지 않았어요」로 보이지 않고 줄 자체를 뺀다. 예전 연습처럼 값이 있으면 그대로 보인다.
 */
export type SummaryRow = { key: 'title' | 'situation' | 'character' | 'goal' | 'blockage'; value: string };

export function summaryRows(input: {
  title?: string | null;
  scene: { situation: string; character: string; goal: string };
  blockageKind?: string | null;
}): SummaryRow[] {
  const rows: SummaryRow[] = [];
  const push = (key: SummaryRow['key'], value: string | null | undefined) => {
    const text = value?.trim();
    if (text) rows.push({ key, value: text });
  };
  push('title', input.title);
  push('situation', input.scene.situation);
  push('character', input.scene.character);
  push('goal', input.scene.goal);
  push('blockage', input.blockageKind);
  return rows;
}
