/**
 * 리딩을 화면 밖에서 보이는 모습(SOMA-802) — iOS Live Activity·Android Live Update 에 넘길 값. 순수 함수.
 *
 * 화면의 지금 줄 카드와 같은 정보만 싣는다: 장면, 진행(화면 위 카운터와 같은 K / N), 앞 줄(흐리게), 지금 줄(굵게), 차례 표시.
 * 다음 차례는 싣지 않는다. 지금 대사는 리딩 화면의 가리기를 따르고, 가렸으면 「대사 가림」이다. 지금 줄보다 앞의 대사는
 * 화면처럼 가리지 않는다.
 */
import { translate as t } from '../i18n.ts';
import type { MaskMode } from './store.ts';
import { isHidden, progressOf, type RunState } from './session-run.ts';
import type { ScriptScene } from './types.ts';

/** 차례 칩(화면의 지금 줄 위 작은 표시)의 아이콘과 글. bars 는 듣는 중 막대. */
export type TurnChip = { icon: 'volume-2' | 'pause' | 'book-open' | 'check' | 'mic-off' | 'bars' | 'mic'; label: string };

export function turnChip(input: {
  hold: 'tip' | 'mask_sheet' | null;
  paused: boolean;
  /** 다른 앱에 있는 동안 전화 등으로 끊겨 멈췄다(R9.18 변형). */
  interrupted: boolean;
  myTurn: boolean;
  textOnly: boolean;
  turnDone: boolean;
  turnNote: null | 'silence' | 'limit';
  listening: boolean;
}): TurnChip {
  if (input.hold === 'tip') return { icon: 'volume-2', label: t('reading.chipBeforeStart') };
  if (input.paused) return { icon: 'pause', label: t(input.interrupted ? 'reading.interruptedChip' : 'reading.pause') };
  if (!input.myTurn) {
    return input.textOnly ? { icon: 'book-open', label: t('reading.chipTextOnly') } : { icon: 'volume-2', label: t('reading.chipReading') };
  }
  if (input.turnDone && input.turnNote !== 'limit') return { icon: 'check', label: t('reading.spokenDone') };
  if (input.hold === 'mask_sheet') return { icon: 'pause', label: t('reading.chipHold') };
  if (input.turnNote === 'limit') return { icon: 'mic-off', label: t('reading.chipLimit') };
  if (input.listening) return { icon: 'bars', label: t('reading.listening') };
  return { icon: 'mic', label: t('reading.chipMicOpening') };
}

/** 지금 줄이 든 장면의 이름. 장면 제목이 없으면 「장면 N」, 장면 밖이면 대본 제목. */
export function sceneLabelAt(input: { title: string; scenes: readonly Pick<ScriptScene, 'no' | 'title' | 'start_line_id' | 'end_line_id'>[]; lineIds: readonly string[]; index: number }): string {
  const scene = input.scenes.find((s) => {
    const from = input.lineIds.indexOf(s.start_line_id);
    const to = input.lineIds.indexOf(s.end_line_id);
    return from >= 0 && to >= from && input.index >= from && input.index <= to;
  });
  if (!scene) return input.title;
  return scene.title ?? t('reading.rangeScene', { n: scene.no });
}

/** 네이티브 모듈에 넘기는 값. 글은 모두 여기서 만들고 네이티브는 놓기만 한다. */
export type LiveState = {
  scene: string;
  /** 「2 / 15」 — iOS 머리 줄. */
  progress: string;
  /** 「2/15」 — Android 머리 줄·상태 막대 칩. */
  shortProgress: string;
  /** 0~1, 다이내믹 아일랜드의 원형 진행. */
  fraction: number;
  /** 지금 배역의 첫 글자 — 아일랜드·칩의 동그라미. */
  initial: string;
  /** 「태오 · 내 차례 · 듣는 중」. */
  status: string;
  /** 「내 차례 · 태오」 — 아일랜드 펼침의 제목. */
  headline: string;
  /** 화면의 차례 칩 글(「듣는 중」) — 아일랜드 펼침의 둘째 줄 끝. */
  chipLabel: string;
  mine: boolean;
  paused: boolean;
  prevRole: string | null;
  prevText: string | null;
  text: string;
  pauseLabel: string;
};

/**
 * 지금 실행 상태를 밖에서 보일 값으로 바꾼다. 끝났거나 지금 줄이 대사가 아니면 null(보일 것이 없다).
 * chipLabel 은 화면의 차례 칩 글 — 밖의 차례 글이 화면과 같게 그것을 그대로 쓴다.
 */
export function liveStateOf(input: {
  run: RunState;
  maskMode: MaskMode;
  /** 내 차례를 끝내 가린 내 대사를 원문으로 펼쳤는가(화면의 revealed). */
  revealed: boolean;
  /** 대사 보기 시트의 「원문 보기」를 켰는가. */
  showOriginal: boolean;
  chipLabel: string;
  scene: string;
  labelOf: (role: string) => string;
}): LiveState | null {
  const { run } = input;
  const line = run.lines[run.index];
  if (run.status === 'done' || line?.type !== 'dialogue') return null;
  const mineOf = (role: string) => run.myRoles.includes(role);
  const mine = mineOf(line.role);
  const role = input.labelOf(line.role);
  const masked = t('reading.liveMasked');
  const hidden = isHidden({ maskMode: input.maskMode, line, isMine: mine }) && !input.revealed && !input.showOriginal;

  let prev: { role: string; text: string } | null = null;
  for (let i = run.index - 1; i >= run.startIndex; i--) {
    const l = run.lines[i];
    if (l?.type !== 'dialogue') continue;
    prev = { role: input.labelOf(l.role), text: l.text };
    break;
  }

  const { done, total } = progressOf(run);
  const myTurnLabel = t('reading.myTurn');
  return {
    scene: input.scene,
    progress: `${done} / ${total}`,
    shortProgress: `${done}/${total}`,
    fraction: total > 0 ? done / total : 0,
    initial: [...role][0] ?? '',
    status: mine ? `${role} · ${myTurnLabel} · ${input.chipLabel}` : `${role} · ${input.chipLabel}`,
    headline: mine ? `${myTurnLabel} · ${role}` : role,
    chipLabel: input.chipLabel,
    mine,
    paused: run.status === 'paused',
    prevRole: prev?.role ?? null,
    prevText: prev?.text ?? null,
    text: hidden ? masked : line.text,
    pauseLabel: t('reading.pause'),
  };
}
