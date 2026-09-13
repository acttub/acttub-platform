/**
 * 리딩 내 차례용 마이크 자동넘김 (SOMA-527).
 * active=true 인 동안 음성 인식을 켜고, 말이 끝나(무음)면 onDone 을 불러 다음 줄로 넘긴다.
 * 내용 대조는 하지 않는다 — "다 읽었는가(발화 종료)"만 본다(디자인: "말이 끝나면 자동으로 넘어가요").
 */
import { useEffect, useRef } from 'react';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

let permissionAsked = false;

export function useMicAutoAdvance(
  active: boolean,
  onDone: () => void,
  onHeard?: (text: string) => void,
): void {
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const heardRef = useRef(onHeard);
  heardRef.current = onHeard;
  const running = useRef(false);

  useSpeechRecognitionEvent('result', (e: any) => {
    const t = e?.results?.[0]?.transcript;
    if (t) heardRef.current?.(t);
  });
  const finish = () => {
    if (running.current) {
      running.current = false;
      doneRef.current?.();
    }
  };
  useSpeechRecognitionEvent('end', finish);
  useSpeechRecognitionEvent('error', finish);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        if (!permissionAsked) {
          await ExpoSpeechRecognitionModule.requestPermissionsAsync();
          permissionAsked = true;
        }
        if (cancelled) return;
        running.current = true;
        ExpoSpeechRecognitionModule.start({
          lang: 'ko-KR',
          interimResults: true,
          continuous: false,
        });
      } catch {
        running.current = false;
      }
    }
    if (active) void start();
    return () => {
      cancelled = true;
      if (running.current) {
        running.current = false;
        try {
          ExpoSpeechRecognitionModule.abort();
        } catch {}
      }
    };
  }, [active]);
}
