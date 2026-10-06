// expo-audio 는 라이브러리 매니페스트에 백그라운드 재생·녹음용 포그라운드 서비스 두 개와
// FOREGROUND_SERVICE_MEDIA_PLAYBACK 권한을 기본으로 넣는다. 우리 앱은 잠금 화면 컨트롤·백그라운드 재생·
// 백그라운드 녹음을 쓰지 않는다(리딩 음성과 녹음은 앱이 화면에 있을 때만). 그대로 두면 Play 가
// 「포그라운드 서비스 권한」 선언(시연 동영상 필수)을 요구하고 업데이트 출시를 막으므로 병합 매니페스트에서 뺀다.
const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

const REMOVED_PERMISSIONS = ['android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'];
const REMOVED_SERVICES = [
  'expo.modules.audio.service.AudioControlsService',
  'expo.modules.audio.service.AudioRecordingService',
];

function withRemoveAudioForegroundService(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';

    manifest['uses-permission'] = (manifest['uses-permission'] ?? []).filter(
      (p) => !REMOVED_PERMISSIONS.includes(p.$['android:name']),
    );
    for (const name of REMOVED_PERMISSIONS) {
      manifest['uses-permission'].push({ $: { 'android:name': name, 'tools:node': 'remove' } });
    }

    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.service = (app.service ?? []).filter((s) => !REMOVED_SERVICES.includes(s.$['android:name']));
    for (const name of REMOVED_SERVICES) {
      app.service.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
    }
    return cfg;
  });
}

module.exports = withRemoveAudioForegroundService;
module.exports.REMOVED_PERMISSIONS = REMOVED_PERMISSIONS;
module.exports.REMOVED_SERVICES = REMOVED_SERVICES;
