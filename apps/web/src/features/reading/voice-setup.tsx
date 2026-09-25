"use client";

/**
 * 상대역 목소리를 준비하는 자리(reading.cast).
 *
 * 화면에 들어오면 묻지 않고 바로 모델을 받되 용량(약 380MB)을 함께 보여 준다. 다 받기 전에는 부모(배역
 * 화면)가 시작 버튼을 잠근다. 받지 못하면(내려받기 실패, 저장 공간 부족) **자동으로 다른 음성으로 바꾸지
 * 않는다.** 셋을 준다 — "다시 시도", "기기 음성으로 읽기"(브라우저·OS 음성 서비스로 대사가 전달될 수 있다는
 * 한 줄과 함께, 배우가 고른 때만), "글로 보기"(상대 대사를 소리 없이 글로 보여 주고 버튼으로 넘김). 기본은
 * 글로 보기다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { enableSupertonic, getEngine, ttsSupported, waitForVoices } from "@/lib/reading/audio/tts";
import { type LoadProgress } from "@/lib/reading/audio/supertonic/engine";
import { MODEL_ATTRIBUTION } from "@/lib/reading/audio/supertonic/models";
import type { PartnerVoice } from "@/features/reading/hooks/useRehearsalRunner";
import { DEVICE_VOICE_NOTICE, VOICE_MODEL_SIZE } from "@/features/reading/session-copy";

type Phase = "받는중" | "켜짐" | "실패";

export const VOICE_FAILED_COPY = "상대 목소리를 준비하지 못했어요. 어떻게 할지 골라 주세요.";

export function VoiceSetup({
  onChange,
}: {
  /** 시작해도 되는지와 상대 대사를 어떻게 낼지. ready 가 false 면 부모가 시작 버튼을 잠근다. */
  onChange: (state: { ready: boolean; partnerVoice: PartnerVoice }) => void;
}) {
  const notify = useRef(onChange);
  useEffect(() => {
    notify.current = onChange;
  });

  // 이미 켜져 있으면(같은 탭에서 두 번째 진입) 바로 켜짐, 아니면 받는 중으로 시작한다 — effect 안에서 setState 하지 않는다.
  const [phase, setPhase] = useState<Phase>(() => (getEngine() === "supertonic" ? "켜짐" : "받는중"));
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  /** 실패했을 때 배우가 고른 것. 기본은 글로 보기. */
  const [choice, setChoice] = useState<Exclude<PartnerVoice, "supertonic">>("text");
  const [deviceNote, setDeviceNote] = useState<string | null>(null);
  const deviceAvailable = ttsSupported();

  const download = useCallback(async (alive: () => boolean) => {
    try {
      await enableSupertonic(setProgress);
      if (!alive()) return;
      setPhase("켜짐");
      notify.current({ ready: true, partnerVoice: "supertonic" });
    } catch {
      if (!alive()) return;
      setPhase("실패");
      // 자동으로 바꾸지 않는다. 배우가 고를 때까지 기본은 글로 보기이고 그대로 시작할 수 있다.
      notify.current({ ready: true, partnerVoice: "text" });
    }
  }, []);

  useEffect(() => {
    let alive = true;
    // 그리기가 끝난 다음 틱에 받기 시작한다 — 효과 안에서 곧바로 상태를 건드리지 않기 위해서다.
    const kick = setTimeout(() => {
      if (!alive) return;
      if (getEngine() === "supertonic") notify.current({ ready: true, partnerVoice: "supertonic" });
      else {
        notify.current({ ready: false, partnerVoice: "supertonic" });
        void download(() => alive);
      }
    }, 0);
    return () => {
      alive = false;
      clearTimeout(kick);
    };
  }, [download]);

  const retry = () => {
    setPhase("받는중");
    notify.current({ ready: false, partnerVoice: "supertonic" });
    void download(() => true);
  };

  const choose = (next: Exclude<PartnerVoice, "supertonic">) => {
    setChoice(next);
    notify.current({ ready: true, partnerVoice: next });
  };

  // 기기 음성을 고를 수 있는지 미리 본다. 목록은 크롬에서 늦게 채워지므로 기다렸다가 확인한다.
  useEffect(() => {
    if (!deviceAvailable) return;
    let alive = true;
    void waitForVoices().then((v) => {
      if (!alive) return;
      if (v.length === 0) setDeviceNote("기기에 한국어 음성이 없어요.");
    });
    return () => {
      alive = false;
    };
  }, [deviceAvailable]);

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 text-sm">
      {phase === "켜짐" ? (
        <p className="text-neutral-700">자연스러운 음성으로 읽어요. 대사는 기기 밖으로 나가지 않아요.</p>
      ) : phase === "받는중" ? (
        <>
          <p className="text-neutral-700">상대 목소리를 준비하고 있어요. 처음 한 번만 받아요({VOICE_MODEL_SIZE}).</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200">
            <div className="h-full bg-neutral-800 transition-[width]" style={{ width: `${Math.round((progress?.ratio ?? 0) * 100)}%` }} />
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-red-600">{VOICE_FAILED_COPY}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={retry} className="rounded-xl bg-neutral-900 px-3.5 py-2 text-white text-[13px] font-bold">
              다시 시도
            </button>
            <button
              type="button"
              onClick={() => choose("text")}
              aria-pressed={choice === "text"}
              className={`rounded-xl px-3.5 py-2 text-[13px] font-bold border ${choice === "text" ? "bg-blue-soft border-blue text-blue" : "border-line text-ink-3"}`}
            >
              글로 보기
            </button>
            <button
              type="button"
              onClick={() => choose("device")}
              disabled={!deviceAvailable}
              aria-pressed={choice === "device"}
              className={`rounded-xl px-3.5 py-2 text-[13px] font-bold border disabled:opacity-40 ${choice === "device" ? "bg-blue-soft border-blue text-blue" : "border-line text-ink-3"}`}
            >
              기기 음성으로 읽기
            </button>
          </div>
          <p className="text-neutral-500 text-[12px]">
            {choice === "device" ? DEVICE_VOICE_NOTICE : "글로 보기는 상대 대사를 소리 없이 보여 주고 다음을 눌러 넘겨요."}
            {deviceNote && ` ${deviceNote}`}
          </p>
        </div>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-neutral-400">
        음성 모델 {MODEL_ATTRIBUTION.name} · {MODEL_ATTRIBUTION.author} · {MODEL_ATTRIBUTION.license}
      </p>
    </div>
  );
}
