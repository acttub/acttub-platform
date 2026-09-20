// 스플래시 아이콘을 런처와 같은 모양의 적응형 아이콘으로, 단 고해상도로 쓰게 만든다.
//
// 왜 적응형이어야 하나 — expo-splash-screen 은 windowSplashScreenAnimatedIcon 으로
// 평범한 PNG 한 장(@drawable/splashscreen_logo)을 넣는다. 삼성 One UI 는 적응형이
// 아닌 비트맵이 오면 자기가 만든 배경(그라데이션 스쿼클) 안에 그 비트맵을 축소해
// 끼워 넣는다. 그래서 우리 파란 타일이 액자처럼 한 겹 더 감싸져 안쪽 경계가 드러났다.
// 적응형이면 시스템이 배경·전경 두 층에 기기 마스크만 씌우므로 경계가 생기지 않는다.
//
// 왜 런처 아이콘(@mipmap/ic_launcher)을 그대로 쓰면 안 되나 — 런처용 층은 xxxhdpi
// 기준 432px 라 런처 크기(108dp)엔 충분해도 스플래시엔 모자란다. 갤럭시 S24 에서
// 스플래시 아이콘은 화면에 481px 로 그려지는데, 432px 중 실제로 보이는 안전영역은
// 그 3분의 2인 288px 뿐이라 1.6배 늘어나 뭉개졌다.
// 그래서 같은 그림을 1024px 원본 그대로 drawable-nodpi 에 넣어 스플래시 전용
// 적응형 아이콘을 따로 만든다 — 보이는 부분이 683px 라 481px 로 줄여 그려져 또렷하다.
//
// 주의: expo-splash-screen 이 Theme.App.SplashScreen 스타일 블록을 통째로 다시 쓴다.
// 플러그인 동작은 등록의 역순으로 실행되므로, 이 플러그인은 app.json 플러그인 목록
// 맨 앞에 둬야 마지막에 적용된다.
const { withAndroidStyles, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SPLASH_STYLE = 'Theme.App.SplashScreen';
const ICON_ITEM = 'windowSplashScreenAnimatedIcon';
const ICON_REF = '@drawable/splash_icon';

// 적응형 아이콘을 못 읽는 API 24~25 용 대체본. 그 버전엔 안드로이드 12 스플래시가
// 아예 없어 실제로 쓰이진 않지만, 리소스가 비면 빌드가 깨지므로 채워 둔다.
const FALLBACK_DIR = 'drawable-xxxhdpi';
const ADAPTIVE_DIR = 'drawable-anydpi-v26';
const LAYER_DIR = 'drawable-nodpi';

const ADAPTIVE_XML = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/splash_icon_bg"/>
    <foreground android:drawable="@drawable/splash_icon_fg"/>
</adaptive-icon>
`;

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

module.exports = function withSplashAdaptiveIcon(config) {
  config = withDangerousMod(config, [
    'android',
    (cfg) => {
      const { projectRoot, platformProjectRoot } = cfg.modRequest;
      const res = path.join(platformProjectRoot, 'app', 'src', 'main', 'res');
      const asset = (name) => path.join(projectRoot, 'assets', 'images', name);

      copy(asset('android-icon-foreground.png'), path.join(res, LAYER_DIR, 'splash_icon_fg.png'));
      copy(asset('android-icon-background.png'), path.join(res, LAYER_DIR, 'splash_icon_bg.png'));
      copy(asset('icon.png'), path.join(res, FALLBACK_DIR, 'splash_icon.png'));

      const xml = path.join(res, ADAPTIVE_DIR, 'splash_icon.xml');
      fs.mkdirSync(path.dirname(xml), { recursive: true });
      fs.writeFileSync(xml, ADAPTIVE_XML);

      console.log('[with-splash-adaptive-icon] 스플래시 전용 고해상도 적응형 아이콘을 넣었다.');
      return cfg;
    },
  ]);

  return withAndroidStyles(config, (cfg) => {
    const styles = cfg.modResults?.resources?.style ?? [];
    let patched = false;
    for (const style of styles) {
      if (style?.$?.name !== SPLASH_STYLE) continue;
      for (const item of style.item ?? []) {
        if (item?.$?.name !== ICON_ITEM) continue;
        item._ = ICON_REF;
        patched = true;
      }
    }
    if (!patched) {
      console.warn(`[with-splash-adaptive-icon] ${SPLASH_STYLE}/${ICON_ITEM} 을 찾지 못했다 — 스플래시가 그대로일 수 있다.`);
    } else {
      console.log(`[with-splash-adaptive-icon] 스플래시 아이콘을 ${ICON_REF} 로 바꿨다.`);
    }
    return cfg;
  });
};
