"use client";

/**
 * 읽어주기(D18)·암기 대조가 함께 쓰는 조각 — 상단(나가기·진행), 지난 대사, 가리기 토글, 나가기 확인,
 * 가이드(R03.0), 목소리 준비 안내. 두 화면이 실제로 공유하는 것만 둔다.
 */
import { useEffect, useState, type ReactNode } from "react";
import { getEngine } from "@/lib/reading/audio/tts";
import type { ReadingAdvance, ReadingMode } from "@/lib/reading/api-types";
import { progress, type RehearsalState } from "@/lib/reading/rehearsal/machine";
import { dialogueNumbers, type DialogueLine, type ScriptLine } from "@/lib/reading/script/parse";
import { isMasked, MASK_MODES, maskLabel, saveMask, type MaskMode } from "@/lib/reading/session/mask";
import type { PartnerVoice } from "@/features/reading/hooks/useRehearsalRunner";
import { exitConfirmCopy, guideCopy, guideSeen, markGuideSeen, NO_SPEECH_NOTICE } from "@/features/reading/session-copy";
import { Button, Icon } from "@/features/reading/ui";
import { VoiceSetup } from "@/features/reading/voice-setup";

export const MASKED_TEXT = "· · ·";

/** 리딩·암기 대조 공통 상단: 나가기 · 상태 알약 · 진행 */
export function RunHeader({ onExit, pill, right, progressRatio, children }: { onExit: () => void; pill: ReactNode; right: string; progressRatio: number; children?: ReactNode }) {
  return (
    <div className="bg-surface md:bg-transparent">
      <div className="h-12 md:h-14 flex items-center justify-between gap-2 px-4 md:px-5 md:border-b md:border-line-soft">
        <button type="button" onClick={onExit} className="flex items-center gap-1 text-[13px] font-bold text-ink-3">
          <Icon name="x" size={16} /> 나가기
        </button>
        {pill}
        <span className="flex items-center gap-2">
          {children}
          <span className="text-[12.5px] font-bold text-ink-4 tabular-nums">{right}</span>
        </span>
      </div>
      <div className="px-4 md:hidden">
        <div className="h-1 rounded-full bg-line overflow-hidden">
          <div className="h-full bg-blue transition-[width] duration-500" style={{ width: `${progressRatio * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

export function PastLine({ line, mine, masked }: { line: DialogueLine; mine: boolean; masked: boolean }) {
  return (
    <p className="script-text flex gap-2 text-[13px] md:text-[14px] text-ink-4 leading-relaxed">
      <span className={`shrink-0 font-extrabold ${mine ? "text-me-soft" : "text-partner-soft"}`}>{line.role}</span>
      <span className={masked ? "blur-line" : ""}>{masked ? MASKED_TEXT : line.text}</span>
    </p>
  );
}

/** 가리기 셋을 순환하는 헤더 버튼. 기기가 대본마다 마지막 값을 기억한다. */
export function MaskToggle({ scriptId, mask, onChange }: { scriptId: string; mask: MaskMode; onChange: (m: MaskMode) => void }) {
  const next = () => {
    const i = MASK_MODES.findIndex((m) => m.value === mask);
    const m = MASK_MODES[(i + 1) % MASK_MODES.length].value;
    saveMask(scriptId, m);
    onChange(m);
  };
  return (
    <button type="button" onClick={next} aria-label={`가리기: ${maskLabel(mask)}`} className="flex items-center gap-1 text-[12px] font-bold text-ink-3">
      <Icon name="eye-off" size={14} /> {maskLabel(mask)}
    </button>
  );
}

/** 본문에 가리기를 적용한 줄 목록(옆 대본 보기용). 배역 이름·지문·장면은 남는다. */
export function maskedLines(lines: ScriptLine[], myRoles: string[], mask: MaskMode, mode: ReadingMode, revealedIndex: number): ScriptLine[] {
  return lines.map((l, i) =>
    l.type === "dialogue" && isMasked(mask, { mine: myRoles.includes(l.role), mode, revealed: i === revealedIndex })
      ? { ...l, text: MASKED_TEXT }
      : l,
  );
}

/** 나가기 확인의 "N번 대사" — 구간 안에서 마지막으로 지난 대사의 대본 전체 번호 */
export function lastDoneDialogueNo(state: RehearsalState): number {
  const nos = dialogueNumbers(state.lines);
  for (let i = state.index - 1; i >= state.start; i--) {
    if (state.lines[i]?.type === "dialogue") return nos[i] ?? 0;
  }
  return 0;
}

export function ExitConfirm({ state, onStay, onLeave }: { state: RehearsalState; onStay: () => void; onLeave: () => void }) {
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-4">
      <div className="w-full md:max-w-[420px] bg-surface rounded-[18px] p-5 flex flex-col gap-3">
        <p className="text-[15px] font-black">리딩을 나갈까요?</p>
        <p className="text-[13px] text-ink-sub leading-relaxed">{exitConfirmCopy(lastDoneDialogueNo(state))}</p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onStay}>
            계속하기
          </Button>
          <Button className="flex-1" onClick={onLeave}>
            나가기
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 가이드(R03.0). 기기당 처음 한 번, 시작 전에 보여 준다. 문구는 녹음·넘김·방식에 맞게 갈린다. */
export function GuideCard({ setup, onDismiss }: { setup: { mode: ReadingMode; advance: ReadingAdvance; record: boolean }; onDismiss: () => void }) {
  return (
    <div className="w-full md:max-w-[640px] rounded-[16px] bg-blue-mist border border-blue-line p-4 flex flex-col gap-2">
      <p className="text-[13px] font-black text-blue">처음 하는 리딩이에요</p>
      <ul className="flex flex-col gap-1 text-[13px] text-ink-3 leading-relaxed list-disc pl-4">
        {guideCopy(setup).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <Button size="sm" variant="secondary" className="self-end" onClick={onDismiss}>
        알겠어요
      </Button>
    </div>
  );
}

export function useGuide(): [boolean, () => void] {
  const [show, setShow] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(!guideSeen());
  }, []);
  return [
    show,
    () => {
      markGuideSeen();
      setShow(false);
    },
  ];
}

/**
 * 시작 전 상대 목소리 준비. 배역 화면이 이미 받았으면 곧바로 준비된 것이고, 새 탭에서 이어할 때는 여기서
 * 받는다. 실패하면 셋(다시 시도·기기 음성·글로 보기)을 주고 자동으로 바꾸지 않는다.
 */
export function useVoiceReady(initial: PartnerVoice, hasPartners: boolean) {
  const [voice, setVoice] = useState<{ ready: boolean; partnerVoice: PartnerVoice }>(() => ({
    ready: !hasPartners || initial !== "supertonic" || getEngine() === "supertonic",
    partnerVoice: initial,
  }));
  const needsSetup = hasPartners && initial === "supertonic" && getEngine() !== "supertonic";
  return { ...voice, setVoice, needsSetup };
}

export function VoiceGate({ show, onChange }: { show: boolean; onChange: (v: { ready: boolean; partnerVoice: PartnerVoice }) => void }) {
  if (!show) return null;
  return (
    <div className="w-full md:max-w-[640px]">
      <VoiceSetup onChange={onChange} />
    </div>
  );
}

/** 상대 줄을 소리로 내지 못했거나 글로 보기 — 읽은 것으로 자동 처리하지 않고 배우가 넘긴다 */
export function VoiceFailedNote({ partnerVoice }: { partnerVoice: PartnerVoice }) {
  return (
    <p className="text-[12px] text-warn font-bold text-center">
      {partnerVoice === "text" ? "상대 대사는 글로 보여요. 읽었으면 다음을 눌러요." : "상대 목소리를 내지 못했어요. 글로 읽고 다음을 눌러요."}
    </p>
  );
}

export function NoSpeechNote() {
  return <p className="text-[12px] text-ink-3 font-bold text-center">{NO_SPEECH_NOTICE}</p>;
}

export function progressLabel(state: RehearsalState, elapsedMs: number): string {
  const p = progress(state);
  const s = Math.floor(elapsedMs / 1000);
  return `${p.done} / ${p.total} · ${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
