/**
 * 코칭 촬영 화면에 띄울 대본. 「내 대본으로 찍기」·대본 만들기 「지금 찍을래요」가 카메라를 열기 직전에 넣고,
 * 촬영 화면이 처음 그릴 때 꺼내며 비운다 — 다른 길로 연 카메라에 지난 대본이 남지 않는다.
 */
export type RecordScriptLine = { kind: 'dialogue' | 'direction' | 'scene'; speaker: string | null; text: string; mine: boolean };
export type RecordScript = { title: string; lines: RecordScriptLine[] };

let pending: RecordScript | null = null;

export function setRecordScript(script: RecordScript | null): void {
  pending = script && script.lines.length > 0 ? script : null;
}

/** 꺼내며 비운다. */
export function takeRecordScript(): RecordScript | null {
  const script = pending;
  pending = null;
  return script;
}

/** 리딩 대본(서버 상세)을 촬영 카드 모양으로 바꾼다. 내 배역 이름의 대사는 mine 이다. */
export function recordScriptFromDetail(
  detail: {
    title: string;
    characters: readonly { id: string; name: string }[];
    lines: readonly { kind: 'dialogue' | 'direction' | 'scene'; character_id: string | null; text: string }[];
  },
  myNames: readonly string[],
): RecordScript {
  const names = new Map(detail.characters.map((c) => [c.id, c.name]));
  return {
    title: detail.title,
    lines: detail.lines.map((line) => {
      const speaker = line.character_id ? (names.get(line.character_id) ?? null) : null;
      return { kind: line.kind, speaker, text: line.text, mine: speaker !== null && myNames.includes(speaker) };
    }),
  };
}

/** 대본 만들기 결과(줄마다 인물 이름)를 촬영 카드 모양으로 바꾼다. */
export function recordScriptFromCocreated(
  script: { title: string; lines: readonly { kind: 'dialogue' | 'direction' | 'scene'; character?: string | null; text: string }[] },
  myName: string,
): RecordScript {
  return {
    title: script.title,
    lines: script.lines.map((line) => {
      const speaker = line.kind === 'dialogue' ? (line.character ?? null) : null;
      return { kind: line.kind, speaker, text: line.text, mine: speaker !== null && speaker === myName };
    }),
  };
}
