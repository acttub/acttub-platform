/**
 * 회차 화면(D17·D18·D19, 대본 상세)이 보여 주는 말(reading.cast·reading.session). 순수 함수라 화면 없이
 * 테스트한다. 연기를 가르지 않는다 — 잘했는지 말하지 않고 무엇이 진행 중이고 다음이 누구 차례인지만 말한다.
 */
import type { ReadingAdvance, ReadingMode, SessionStatus } from "@/lib/reading/api-types";

/** 시작 화면의 녹음 안내. "소리는 어디에도 안 나가요"는 없앴다(처리방침). */
export const RECORD_NOTICE = "내 차례 녹음은 내 계정에 저장돼요";
/** 60초 무발화. 넘기지 않고 계속 기다린다. */
export const NO_SPEECH_NOTICE = "다음을 눌러 넘길 수 있어요";
/** 마이크 권한 거부 */
export const MIC_DENIED_NOTICE = "마이크를 허용하면 말이 끝나면 자동으로 넘어가요";
/** 배우가 기기 음성을 고를 때 함께 보이는 한 줄 */
export const DEVICE_VOICE_NOTICE = "기기 음성으로 읽으면 대사가 브라우저·OS 음성 서비스로 전달될 수 있어요.";
/** 상대역 음성 모델 용량(Supertonic 3 fp32). 웹은 바로 받되 용량을 함께 보여 준다. */
export const VOICE_MODEL_SIZE = "약 380MB";

export function exitConfirmCopy(lastDialogueNo: number): string {
  const progress = lastDialogueNo > 0 ? `${lastDialogueNo}번 대사까지 진행한 걸로` : "아직 진행하지 않은 걸로";
  return `지금 나가면 ${progress} 저장돼요. 상세에서 이어서 할 수 있어요.`;
}

export function sessionStatusLabel(status: SessionStatus): string {
  return status === "in_progress" ? "진행 중" : status === "completed" ? "완료" : "중단";
}

export function resumeLabel(progress: { done: number; total: number }): string {
  return `이어서 연습 · ${progress.done} / ${progress.total}`;
}

export function myCharactersLabel(names: string[]): string {
  return names.length === 0 ? "배역 미선택" : names.join(", ");
}

/** 가이드(R03.0). 녹음 끔·수동 넘김·quiz 에 맞게 갈라 "항상 자동 녹음·자동 다음"을 약속하지 않는다. */
export function guideCopy(setup: { mode: ReadingMode; advance: ReadingAdvance; record: boolean }): string[] {
  const lines: string[] = [];
  if (setup.mode === "quiz") {
    lines.push("내 차례엔 대사가 가려지고, 말한 것을 원문과 맞춰 봐요.");
    lines.push("맞지 않으면 다시·넘어가기·원문 보기를 고를 수 있어요.");
  } else {
    lines.push("상대 대사는 기기가 읽고 내 대사에서 멈춰 기다려요.");
  }
  if (setup.advance === "silence") lines.push("내 차례에 말이 끝나면 자동으로 넘어가요. 다음을 눌러도 돼요.");
  else lines.push("내 차례가 끝나면 다음을 눌러 넘겨요.");
  if (setup.record) lines.push("내 차례 녹음은 내 계정에 저장돼요. 회차 상세에서 다시 들을 수 있어요.");
  lines.push("나가도 진행 위치가 남아 상세에서 이어서 할 수 있어요.");
  return lines;
}

const GUIDE_KEY = "acttub.reading.guide_seen";

function store(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 가이드는 기기당 처음 한 번만 보여 준다. */
export function guideSeen(): boolean {
  try {
    return store()?.getItem(GUIDE_KEY) === "1";
  } catch {
    return true;
  }
}

export function markGuideSeen(): void {
  try {
    store()?.setItem(GUIDE_KEY, "1");
  } catch {
    /* 저장이 막힌 환경이면 매번 보여 준다 */
  }
}
