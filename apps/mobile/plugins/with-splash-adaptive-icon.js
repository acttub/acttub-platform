// 스플래시 아이콘을 런처와 같은 적응형 아이콘으로 쓰게 만든다.
//
// expo-splash-screen 은 windowSplashScreenAnimatedIcon 으로 평범한 PNG 한 장
// (@drawable/splashscreen_logo) 을 넣는다. 삼성 One UI 는 적응형이 아닌 비트맵이 오면
// 자기가 만든 배경(그라데이션 스쿼클) 안에 그 비트맵을 축소해 끼워 넣는다. 그래서
// 우리 파란 타일이 액자처럼 한 겹 더 감싸져 안쪽 경계가 그대로 드러났다.
// (런처 아이콘은 적응형이라 시스템이 마스크만 씌우고 끝이라 경계가 없다.)
//
// @mipmap/ic_launcher 로 바꾸면 스플래시도 배경·전경 두 층을 그대로 받아
// 기기 마스크만 적용된다 — 런처 아이콘과 똑같이 보인다.
const { withAndroidStyles } = require('@expo/config-plugins');

const SPLASH_STYLE = 'Theme.App.SplashScreen';
const ICON_ITEM = 'windowSplashScreenAnimatedIcon';
const ADAPTIVE_ICON = '@mipmap/ic_launcher';

module.exports = function withSplashAdaptiveIcon(config) {
  return withAndroidStyles(config, (cfg) => {
    const styles = cfg.modResults?.resources?.style ?? [];
    let patched = false;
    for (const style of styles) {
      if (style?.$?.name !== SPLASH_STYLE) continue;
      for (const item of style.item ?? []) {
        if (item?.$?.name !== ICON_ITEM) continue;
        item._ = ADAPTIVE_ICON;
        patched = true;
      }
    }
    if (!patched) {
      console.warn(`[with-splash-adaptive-icon] ${SPLASH_STYLE}/${ICON_ITEM} 을 찾지 못했다 — 스플래시가 그대로일 수 있다.`);
    } else {
      console.log(`[with-splash-adaptive-icon] 스플래시 아이콘을 ${ADAPTIVE_ICON} 로 바꿨다.`);
    }
    return cfg;
  });
};
