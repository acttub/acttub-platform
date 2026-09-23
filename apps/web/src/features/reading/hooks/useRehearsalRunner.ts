"use client";

/**
 * 상태머신 + TTS + 마이크를 잇는 러너.
 *  ai  → 상대 대사를 읽고 끝나면 advance. partnerVoice 가 text 면 읽지 않고 버튼을 기다린다(글로 보기).
 *        읽지 못하면(모델 실패) 자동으로 다른 음성으로 바꾸지 않고 그 줄도 글로 보기가 된다(reading.cast).
 *  me  → myTurn 이 "silence" 면 마이크를 켜고 말이 끝나면 advance(1.8초 침묵). 60초 무발화면 넘기지 않고
 *        알리기만 한다. "manual" 이면 버튼을, "wait"(암기 대조)면 화면이 next() 를 부를 때까지 기다린다.
 * 상태가 바뀌면 진행 중이던 TTS·마이크는 항상 정리한다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { startListening, type MicListener } from "@/lib/reading/audio/mic";
import { cancelSpeech, clearPrefetch, prefetch, queuePrefetch, setPrefetchPaused, speakWithEngine, unlockTts, type RoleVoice } from "@/lib/reading/audio/tts";
import { DEFAULT_VAD } from "@/lib/reading/audio/vad";
import {
  advance,
  begin,
  createRehearsal,
  pause,
  resume,
  type RehearsalConfig,
  type RehearsalState,
} from "@/lib/reading/rehearsal/machine";
import type { DialogueLine } from "@/lib/reading/script/parse";

export type MyTurnMode = "silence" | "manual" | "wait";
/** 상대 대사를 어떻게 낼지. supertonic 이 기본, device 는 배우가 고른 기기 음성, text 는 소리 없이 글로. */
export type PartnerVoice = "supertonic" | "device" | "text";

export interface RunnerOptions {
  myTurn: MyTurnMode;
  partnerVoice: PartnerVoice;
  styleFor: (role: string) => RoleVoice;
}

const GAP_BEFORE_AI_MS = 350;
/** 미리 만들어 둘 상대 대사 수. 캐시(24줄)를 넘지 않게 잡는다. */
const PREFETCH_AHEAD = 6;
/** 시작 전에 기다려서 만들어 두는 상대 대사 수 — 첫 대사부터 끊기지 않게 */
const WARMUP_LINES = 2;
/** 워밍업을 이보다 오래 기다리지는 않는다 — 아주 느린 기기에서 시작 버튼이 죽은 듯 보이면 안 된다 */
const WARMUP_TIMEOUT_MS = 25000;
const GAP_BEFORE_MIC_MS = 250;

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

export function useRehearsalRunner(cfg: RehearsalConfig, opts: RunnerOptions) {
  const [state, setState] = useState<RehearsalState>(() => createRehearsal(cfg));
  const [volume, setVolume] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [myTurn, setMyTurn] = useState<MyTurnMode>(opts.myTurn);
  /** 60초 동안 아무 말이 없었다. 넘기지 않고 알리기만 한다. 줄이 바뀌면 사라진다. */
  const [noSpeech, setNoSpeech] = useState(false);
  /** 이 상대 줄을 소리로 내지 못했다(또는 글로 보기). 화면이 "다음"으로 넘긴다. */
  const [voiceFailed, setVoiceFailed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const micRef = useRef<MicListener | null>(null);
  const styleForRef = useRef(opts.styleFor);
  const partnerVoice = opts.partnerVoice;
  useEffect(() => {
    styleForRef.current = opts.styleFor;
  });

  const cleanup = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    micRef.current?.stop();
    micRef.current = null;
    cancelSpeech();
  }, []);

  // 다음에 나올 상대 대사를 미리 합성해 둔다. 신경망 합성은 한 줄에 1~2초가 걸려서,
  // 미리 해 두지 않으면 내 차례가 끝날 때마다 침묵이 생긴다. 결과는 엔진 안에 남는다.
  //
  // 내 차례에만 한다. 상대가 읽는 동안에 돌리면 합성과 재생이 같은 자원을 다투어
  // 소리가 끊긴다. 내 차례는 어차피 기다리는 시간이라 여기서 하는 편이 맞다.
  //
  // 느린 기기는 한 줄 합성이 재생보다 오래 걸려서(RTF > 1) 한 줄만 미리 만들면 못 따라잡는다.
  // 앞의 몇 줄을 순서대로 큐에 넣어 두고, 상대가 읽는 동안에는 큐를 멈춘다.
  useEffect(() => {
    if (state.status === "idle" || state.status === "done" || partnerVoice !== "supertonic") return;
    const upcoming = state.lines
      .slice(state.index + 1, state.end + 1)
      .filter((l): l is DialogueLine => l.type === "dialogue" && !state.myRoles.includes(l.role))
      .slice(0, PREFETCH_AHEAD)
      .map((l) => ({ text: l.text, voice: styleForRef.current(l.role) }));
    queuePrefetch(upcoming);
    setPrefetchPaused(state.status === "ai");
  }, [state, partnerVoice]);

  useEffect(() => () => clearPrefetch(), []);

  useEffect(() => {
    cleanup();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNoSpeech(false);
    setVoiceFailed(false);
    if (state.status === "ai") {
      if (partnerVoice === "text") {
        // 글로 보기 — 소리 없이 보여 주고 버튼으로 넘긴다.
        setVoiceFailed(true);
        return cleanup;
      }
      const line = state.lines[state.index] as DialogueLine;
      const ac = new AbortController();
      abortRef.current = ac;
      (async () => {
        await delay(GAP_BEFORE_AI_MS, ac.signal);
        if (ac.signal.aborted) return;
        const spoken = await speakWithEngine(line.text, styleForRef.current(line.role), partnerVoice, ac.signal);
        if (ac.signal.aborted) return;
        if (!spoken) {
          // 자동으로 다른 음성으로 바꾸지 않는다. 이 줄은 글로 보고 배우가 넘긴다.
          setVoiceFailed(true);
          return;
        }
        setState((s) => (s.status === "ai" ? advance(s) : s));
      })();
    } else if (state.status === "me" && myTurn === "silence") {
      const ac = new AbortController();
      abortRef.current = ac;
      (async () => {
        await delay(GAP_BEFORE_MIC_MS, ac.signal);
        if (ac.signal.aborted) return;
        try {
          const mic = await startListening(DEFAULT_VAD, {
            onLevel: setVolume,
            onEvent: (ev) => {
              if (ev === "speech_end") {
                setState((s) => (s.status === "me" ? advance(s) : s));
              } else if (ev === "timeout") {
                // 아무 말 없이 60초 — 넘기지 않고 안내하며 계속 기다린다(reading.session).
                setNoSpeech(true);
              } else if (ev === "speech_start") {
                setNoSpeech(false);
              }
            },
          });
          if (ac.signal.aborted) {
            mic.stop();
            return;
          }
          micRef.current = mic;
        } catch {
          setMicError("마이크를 쓸 수 없어서 버튼으로 넘기는 방식으로 진행해요.");
          setMyTurn("manual");
        }
      })();
    }
    return cleanup;
  }, [state, myTurn, partnerVoice, cleanup]);

  const [preparing, setPreparing] = useState(false);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const start = useCallback(async () => {
    unlockTts();
    if (myTurn === "silence") {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
      } catch {
        setMicError("마이크 권한이 없어서 버튼으로 넘기는 방식으로 진행해요.");
        setMyTurn("manual");
      }
    }
    // 첫 상대 대사 몇 줄은 만들어 두고 시작한다. 느린 기기에서 첫 줄부터 끊기지 않게.
    if (partnerVoice === "supertonic") {
      setPreparing(true);
      try {
        const s = stateRef.current;
        const firstLines = s.lines
          .slice(s.index, s.end + 1)
          .filter((l): l is DialogueLine => l.type === "dialogue" && !s.myRoles.includes(l.role))
          .slice(0, WARMUP_LINES);
        const warm = (async () => {
          for (const l of firstLines) await prefetch(l.text, styleForRef.current(l.role));
        })();
        await Promise.race([warm, new Promise<void>((r) => setTimeout(r, WARMUP_TIMEOUT_MS))]);
      } finally {
        setPreparing(false);
      }
    }
    setState((s) => begin(s));
  }, [myTurn, partnerVoice]);

  const togglePause = useCallback(() => {
    setState((s) => (s.status === "paused" ? resume(s) : pause(s)));
  }, []);

  /** 자동과 버튼이 겹쳐도 한 줄만 넘어간다 — 상태 갱신이 한 줄에 한 번만 advance 한다. */
  const next = useCallback(() => {
    setState((s) => (s.status === "paused" ? advance({ ...s, status: s.resumeTo ?? "ai" }) : advance(s)));
  }, []);

  const stop = useCallback(() => {
    cleanup();
  }, [cleanup]);

  return { state, volume, micError, myTurn, noSpeech, voiceFailed, preparing, start, togglePause, next, stop };
}
