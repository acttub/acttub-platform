/**
 * 대본 리딩에서 음성 인식(내 차례)을 켤 때의 iOS 오디오 설정(SOMA-710).
 *
 * <p>expo-speech-recognition 은 따로 주지 않으면 `playAndRecord` + `measurement` 모드로 켠다. measurement 는 iOS 의
 * 재생 보정과 마이크 자동 음량을 꺼서 상대역 목소리와 녹음이 크게 작아지고, 인식이 끝나도 되돌리지 않는다. 그래서
 * 일반(default) 모드로 켜고, 끝나면 일반 재생으로 되돌린다(ios-audio-restore). 안드로이드는 이 값을 쓰지 않는다.
 *
 * <p>값은 라이브러리 상수(AVAudioSessionCategory 등)와 같은 글자다 — 테스트가 네이티브 모듈 없이 읽도록 글자로 둔다.
 */
export const READING_STT_IOS_CATEGORY: {
  category: 'playAndRecord';
  categoryOptions: ('defaultToSpeaker' | 'allowBluetooth')[];
  mode: 'default';
} = {
  category: 'playAndRecord',
  categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
  mode: 'default',
};
