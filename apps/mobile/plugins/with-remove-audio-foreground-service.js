// expo-audio 는 라이브러리 매니페스트에 잠금 화면 컨트롤·백그라운드 녹음용 포그라운드 서비스 두 개를 기본으로 넣는다.
// 우리 앱은 그 둘을 쓰지 않는다. 리딩의 배경 재생·녹음은 modules/reading-live 의 서비스 하나가 맡고(SOMA-802),
// expo-audio 서비스가 남으면 알림이 두 개 뜨고 Play 선언 대상만 늘어 병합 매니페스트에서 뺀다.
// FOREGROUND_SERVICE_MEDIA_PLAYBACK 권한은 리딩 서비스가 쓰므로 남긴다.
const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

const REMOVED_SERVICES = [
  'expo.modules.audio.service.AudioControlsService',
  'expo.modules.audio.service.AudioRecordingService',
];

function withRemoveAudioForegroundService(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';

    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.service = (app.service ?? []).filter((s) => !REMOVED_SERVICES.includes(s.$['android:name']));
    for (const name of REMOVED_SERVICES) {
      app.service.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
    }
    return cfg;
  });
}

module.exports = withRemoveAudioForegroundService;
module.exports.REMOVED_SERVICES = REMOVED_SERVICES;
