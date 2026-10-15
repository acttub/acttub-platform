import { setAudioModeAsync } from 'expo-audio';
import { Platform } from 'react-native';

/**
 * 음성 인식이 끝나면 iOS 오디오를 일반 재생으로 되돌린다(SOMA-710). 인식기가 바꿔 둔 녹음용 설정이 남으면 다음
 * 상대역 목소리가 작게 나온다. 실패해도 리딩은 계속한다.
 */
export function restorePlaybackAudio(): void {
  if (Platform.OS !== 'ios') return;
  void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
}
