"use client";

/**
 * 자연스러운 음성을 켜는 자리.
 *
 * 화면에 들어오면 묻지 않고 바로 모델을 받는다 — 기기 음성이 너무 딱딱해 실제로 쓸 만하지 않아서
 * 받을지 말지를 사람에게 넘기지 않기로 했다(2026-08-27). 용량도 보이지 않는다. 진행 막대와
 * 라이선스 고지만 보이고, 다 받기 전에는 부모(배역 화면)가 시작 버튼을 잠근다(onReady).
 * 받다가 실패하면 그때만 기기 음성으로 떨어지고 다시 시도 버튼을 둔다 — 그때는 시작할 수 있다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { enableSupertonic, getEngine, isRemoteOnly, ttsSupported, waitForVoices, type Engine } from "@/lib/reading/audio/tts";
import { type LoadProgress } from "@/lib/reading/audio/supertonic/engine";
import { MODEL_ATTRIBUTION } from "@/lib/reading/audio/supertonic/models";

type Phase = "받는중" | "켜짐" | "실패";

export function VoiceSetup({
  onEngineChange,
  onReady,
}: {
  onEngineChange?: (e: Engine) => void;
  /** 리딩을 시작해도 되는가 — 다 받았거나(켜짐), 실패해서 기기 음성으로 가기로 했을 때 true */
  onReady?: (ready: boolean) => void;
} = {}) {
  // 부모가 매 렌더마다 새 함수를 넘겨도 효과가 다시 돌지 않게 ref 로 잡아 둔다.
  const notify = useRef(onEngineChange);
  const ready = useRef(onReady);
  useEffect(() => {
    notify.current = onEngineChange;
    ready.current = onReady;
  });

  // 이미 켜져 있으면(같은 탭에서 두 번째 진입) 바로 켜짐, 아니면 받는 중으로 시작한다 — effect 안에서 setState 하지 않는다.
  const [phase, setPhase] = useState<Phase>(() => (getEngine() === "supertonic" ? "켜짐" : "받는중"));
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  // 지원 여부는 그리기 전에 알 수 있다.
  const [deviceNote, setDeviceNote] = useState<string | null>(() =>
    ttsSupported() ? null : "이 브라우저는 기기 음성을 지원하지 않아요.",
  );

  /** 받기. 끝나면 켜짐, 실패하면 기기 음성으로 — 어느 쪽이든 그때부터 시작할 수 있다. */
  const download = useCallback(async (alive: () => boolean) => {
    try {
      await enableSupertonic(setProgress);
      if (!alive()) return;
      setPhase("켜짐");
      notify.current?.("supertonic");
      ready.current?.(true);
    } catch {
      if (!alive()) return;
      setPhase("실패");
      notify.current?.("device");
      ready.current?.(true);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    // 그리기가 끝난 다음 틱에 받기 시작한다 — 효과 안에서 곧바로 상태를 건드리지 않기 위해서다.
    const kick = setTimeout(() => {
      if (!alive) return;
      if (getEngine() === "supertonic") ready.current?.(true);
      else void download(() => alive);
    }, 0);
    return () => {
      alive = false;
      clearTimeout(kick);
    };
  }, [download]);

  const retry = () => {
    setPhase("받는중");
    ready.current?.(false);
    void download(() => true);
  };

  // 기기 음성으로 읽게 될 경우에 대비해 미리 알려 준다.
  // 목록은 크롬에서 늦게 채워지므로 기다렸다가 확인한다.
  useEffect(() => {
    if (!ttsSupported()) return;
    let alive = true;
    void waitForVoices().then((v) => {
      if (!alive) return;
      if (v.length === 0) setDeviceNote("기기에 한국어 음성이 없어요.");
      else if (isRemoteOnly()) setDeviceNote("기기 음성으로 읽으면 대사가 브라우저 음성 서비스로 전달돼요.");
    });
    return () => {
      alive = false;
    };
  }, []);


  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 text-sm">
      {phase === "켜짐" ? (
        <p className="text-neutral-700">자연스러운 음성으로 읽어요. 대사는 기기 밖으로 나가지 않아요.</p>
      ) : phase === "받는중" ? (
        <>
          <p className="text-neutral-700">상대 목소리를 준비하고 있어요. 처음 한 번만 걸려요.</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200">
            <div
              className="h-full bg-neutral-800 transition-[width]"
              style={{ width: `${Math.round((progress?.ratio ?? 0) * 100)}%` }}
            />
          </div>
        </>
      ) : (
        <>
          <p className="text-red-600">음성을 준비하지 못했어요. 기기 음성으로 진행할게요.</p>
          {deviceNote && <p className="mt-1 text-neutral-500">{deviceNote}</p>}
          <button
            onClick={retry}
            className="mt-3 rounded-xl bg-neutral-900 px-4 py-2 text-white"
          >
            다시 시도
          </button>
        </>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-neutral-400">
        음성 모델 {MODEL_ATTRIBUTION.name} · {MODEL_ATTRIBUTION.author} · {MODEL_ATTRIBUTION.license}
      </p>
    </div>
  );
}
