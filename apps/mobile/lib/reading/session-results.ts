/**
 * 완료 화면(R9.23)·다르게 말한 대사 전체(R9.26, reading.session)의 집계. 점수·등급·칭찬은 없다.
 * 「원문과 다르게 말한 대사」는 서버가 말한 것을 원문과 비교해 완료 저장 응답·회차 상세의 different_lines 로 준다.
 * 화면은 그 어절 표시대로 원문을 노랗게 칠하고 아래에 말한 것을 보인다(components/diff-text).
 */
import { errorCode } from '../api-request.ts';
import type { ScriptLine } from './parse.ts';
import type { DifferentLine, ProgressBody, ProgressResponse, SessionDetail } from './types.ts';

/**
 * 완료 화면 「원문과 다르게 말한 대사」 칸. waiting 은 완료 저장 응답을 기다리는 중, later 는 저장이 닿지 않아(끊김)
 * 진행 저장 큐가 다시 보내는 중이다 — 닿으면 ready 가 되고, 화면을 떠났으면 회차 상세에서 본다.
 */
export type DifferentView = { kind: 'waiting' } | { kind: 'later' } | { kind: 'ready'; lines: DifferentLine[] };

/**
 * 진행 저장 send 를 감싸 완료 저장(complete)의 결과를 알린다. 응답이 오면 그 different_lines, 실패하면 later 이고 오류는
 * 그대로 던져 큐가 다시 보낸다. 409 session_closed 는 앞선 완료가 닿았는데 응답만 잃은 것이라 회차 상세의 것을 쓴다.
 */
export function reportCompletion(
  send: (body: ProgressBody) => Promise<ProgressResponse>,
  deps: { fetchDetail: () => Promise<Pick<SessionDetail, 'different_lines'> | null>; onView: (view: DifferentView) => void },
): (body: ProgressBody) => Promise<ProgressResponse> {
  return async (body) => {
    if (!body.complete) return send(body);
    try {
      const saved = await send(body);
      deps.onView({ kind: 'ready', lines: saved.different_lines });
      return saved;
    } catch (error) {
      if (errorCode(error) === 'session_closed') {
        void deps.fetchDetail().then((detail) => deps.onView(detail ? { kind: 'ready', lines: detail.different_lines } : { kind: 'later' }));
      } else {
        deps.onView({ kind: 'later' });
      }
      throw error;
    }
  };
}

/** R9.26 「대본 흐름」의 한 줄 — 구간 대본 전체를 위에서 아래로, 다르게 말한 내 줄만 different 가 있다. */
export type FlowRow = { lineId: string; line: ScriptLine; mine: boolean; different: DifferentLine | null };

export function flowRows(input: {
  lines: ScriptLine[];
  lineIds: string[];
  startIndex: number;
  endIndex: number;
  myRoles: string[];
  different: DifferentLine[];
}): FlowRow[] {
  const different = new Map(input.different.map((d) => [d.line_id, d] as const));
  const rows: FlowRow[] = [];
  for (let i = Math.max(0, input.startIndex); i <= input.endIndex && i < input.lines.length; i++) {
    const line = input.lines[i];
    const lineId = input.lineIds[i];
    const mine = line.type === 'dialogue' && input.myRoles.includes(line.role);
    rows.push({ lineId, line, mine, different: different.get(lineId) ?? null });
  }
  return rows;
}

/** 읽은 대사 — 구간 안 대사 줄 수(모든 배역). 부분 구간을 대본 전체 완료로 말하지 않는다. */
export function readDialogueCount(lines: ScriptLine[], startIndex: number, endIndex: number): number {
  let n = 0;
  for (let i = Math.max(0, startIndex); i <= endIndex && i < lines.length; i++) if (lines[i].type === 'dialogue') n += 1;
  return n;
}

/** 대본 흐름(실행·회차 상세·전체 보기)의 지문. 나눌 때 괄호를 떼어 저장하므로 보일 때 다시 싼다. */
export function directionLabel(text: string): string {
  return /^[(（].*[)）]$/.test(text.trim()) ? text : `(${text})`;
}
