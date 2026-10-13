// 안드로이드 앱 메모리 한도를 넓힌다(SOMA-699). 연습·리딩(폰 목소리)·챌린지 영상·촬영을 한 번에 오래 쓰면 기본 한도
// (S25 기준 256MB)를 채워 꺼졌다. 쌓이는 곳을 줄이는 수정(lib/video-memory.ts)과 함께 두는 응급처치다.
const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

function withLargeHeap(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.$['android:largeHeap'] = 'true';
    return cfg;
  });
}

module.exports = withLargeHeap;
