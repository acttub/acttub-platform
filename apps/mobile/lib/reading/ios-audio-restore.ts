import { setAudioModeAsync } from 'expo-audio';
import { Platform } from 'react-native';

/**
 * 배경 재생·녹음은 끈다. 1.0.2 에서 iOS UIBackgroundModes audio 를 뺐다(App Review 2.5.4 — 배경 오디오 기능을 못 찾았다는
 * 지적). 안드로이드도 리딩 포그라운드 서비스를 빼서(1.0.0) 두 플랫폼 모두 화면을 벗어나면 리딩이 멈춘다. expo-audio 는
 * setAudioModeAsync 를 부를 때마다 이 값을 새로 받으므로 리딩의 모든 호출에 싣는다.
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
