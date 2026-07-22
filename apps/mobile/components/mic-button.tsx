import { MaterialIcons } from '@expo/vector-icons';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { palette } from '@/constants/palette';

export type MicButtonProps = {
  /** 인식 결과(중간·최종)로 입력창을 갱신한다. */
  onText: (text: string) => void;
  disabled?: boolean;
};

/**
 * 온디바이스 STT 마이크 버튼 — 누르면 듣기 시작, 다시 누르면 종료.
 * OS 음성인식(Android SpeechRecognizer / iOS Speech)만 사용하므로 외부 API 비용이 없다.
 */
export function MicButton({ onText, disabled }: MicButtonProps) {
  const [listening, setListening] = useState(false);

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript;
    if (transcript) onText(transcript);
  });
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('error', () => setListening(false));

  const toggle = async () => {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) return;
    ExpoSpeechRecognitionModule.start({
      lang: 'ko-KR',
      interimResults: true,
      continuous: false,
    });
    setListening(true);
  };

  return (
    <Pressable
      style={[styles.button, listening && styles.listening, disabled && styles.disabled]}
      onPress={toggle}
      disabled={disabled}>
      <MaterialIcons
        name={listening ? 'stop' : 'mic'}
        size={22}
        color={listening ? '#FFFFFF' : palette.blue}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: palette.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listening: { backgroundColor: palette.danger },
  disabled: { opacity: 0.4 },
});
