import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { useEffect, useRef, useState } from 'react';

import { speechLocale } from '@/lib/i18n';
import { SILENCE_MS, advanceDecision, mergeTranscript } from '@/lib/reading/auto-advance';

/**
 * 내 차례에 듣고 있다가, 말이 끝나면 스스로 다음 줄로 넘긴다 (SOMA-549).
 *
 * <p>받아쓰기는 기기 안에서 돈다(OS 음성인식) — 외부로 나가는 것도, 돈이 드는 것도 없다.
 * 마이크 권한은 리딩이 이미 녹음으로 받았으므로 새로 묻지 않는다. 거절돼 있으면 조용히
 * 듣지 않고, 사용자는 지금처럼 다음 버튼으로 넘긴다.
 *
 * <p>판정(언제 끝난 것으로 볼지)은 {@code lib/reading/auto-advance} 에 있다. 여기서는 듣기를
 * 켜고 끄고, 들은 말을 모으고, 조용해지면 판정을 다시 묻는 일만 한다.
 */
export function useMicAutoAdvance({
  active,
  enabled,
  onAdvance,
}: {
  /** 지금이 내 차례인가. 아니면 듣지 않는다. */
  active: boolean;
  /** 사용자가 이 기능을 켜 두었는가. */
  enabled: boolean;
  onAdvance: () => void;
}) {
  const [heard, setHeard] = useState('');
  const [listening, setListening] = useState(false);
  const lastHeardAt = useRef<number | null>(null);
  const endedRef = useRef(false);
  const heardRef = useRef('');
  const firedRef = useRef(false);

  useSpeechRecognitionEvent('result', (event) => {
    const spoken = event.results?.[0]?.transcript ?? '';
    if (!spoken.trim()) return;
    heardRef.current = mergeTranscript(heardRef.current, spoken);
    lastHeardAt.current = Date.now();
    setHeard(heardRef.current);
  });
  useSpeechRecognitionEvent('end', () => {
    endedRef.current = true;
    setListening(false);
  });
  useSpeechRecognitionEvent('error', () => {
    endedRef.current = true;
    setListening(false);
  });

  // 내 차례가 되면 듣기 시작, 아니면 멈춘다. 줄이 바뀔 때마다 들은 말을 비운다.
  useEffect(() => {
    heardRef.current = '';
    lastHeardAt.current = null;
    endedRef.current = false;
    firedRef.current = false;
    setHeard('');

    if (!active || !enabled) {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {}
      setListening(false);
      return;
    }

    let alive = true;
    void (async () => {
      try {
        // 리딩이 이미 마이크를 받았다. 없으면 묻지 않고 그냥 듣지 않는다.
        const perm = await ExpoSpeechRecognitionModule.getPermissionsAsync();
        if (!alive || !perm.granted) return;
        ExpoSpeechRecognitionModule.start({
          lang: speechLocale(),
          interimResults: true,
          continuous: true,
        });
        setListening(true);
      } catch {}
    })();

    return () => {
      alive = false;
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {}
      setListening(false);
    };
  }, [active, enabled]);

  // 조용해졌는지 주기적으로 본다. 판정이 넘어가라고 하면 한 번만 넘긴다.
  useEffect(() => {
    if (!active || !enabled) return;
    const timer = setInterval(() => {
      if (firedRef.current) return;
      const decision = advanceDecision({
        heard: heardRef.current,
        lastHeardAt: lastHeardAt.current,
        now: Date.now(),
        ended: endedRef.current,
      });
      if (!decision.advance) return;
      firedRef.current = true;
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {}
      onAdvance();
    }, Math.max(200, Math.floor(SILENCE_MS / 4)));
    return () => clearInterval(timer);
  }, [active, enabled, onAdvance]);

  return { heard, listening };
}
