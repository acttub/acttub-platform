import { setAudioModeAsync } from 'expo-audio';
import { Platform } from 'react-native';

/**
 * 리딩은 배경에서 재생·녹음하지 않는다 — 백그라운드 재생(SOMA-802)을 1.1.1 출시 전에 iOS·안드로이드 모두 뺐다(11/3 사용자 결정).
 * expo-audio 는 setAudioModeAsync 를 부를 때마다 이 값을 새로 받으므로 리딩의 모든 호출에 싣는다.
 */
const background = () => ({ shouldPlayInBackground: false, allowsBackgroundRecording: false });

/** 리딩을 시작할 때 부른다. 실패해도 리딩은 계속한다(배경에서 멈출 뿐이다). */
export function keepReadingInBackground(): void {
  void setAudioModeAsync({ playsInSilentMode: true, ...background() }).catch(() => {});
}

/**
 * 음성 인식이 끝나면 iOS 오디오를 일반 재생으로 되돌린다(SOMA-710). 인식기가 바꿔 둔 녹음용 설정이 남으면 다음
 * 상대역 목소리가 작게 나온다. 실패해도 리딩은 계속한다.
 */
export function restorePlaybackAudio(): void {
  if (Platform.OS !== 'ios') return;
  void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false, ...background() }).catch(() => {});
}
