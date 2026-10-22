import { setAudioModeAsync } from 'expo-audio';
import { Platform } from 'react-native';

/**
 * 리딩 중에는 앱이 배경으로 가도 expo-audio 가 재생·녹음을 멈추지 않게 한다(SOMA-802). expo-audio 는 setAudioModeAsync 를
 * 부를 때마다 이 값을 새로 받으므로 리딩의 모든 호출에 싣는다. 안드로이드의 배경 녹음은 리딩 서비스(modules/reading-live)가
 * 맡으므로 expo-audio 녹음 서비스(매니페스트에서 뺐다)를 켜지 않는다.
 */
const background = () => ({ shouldPlayInBackground: true, allowsBackgroundRecording: Platform.OS === 'ios' });

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
