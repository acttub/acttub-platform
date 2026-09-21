// app.json 의 `locales` 는 아이폰 권한 안내를 기기 말에 맞추려고 넣은 것이다 (SOMA-544).
//
// 그런데 expo 는 그 파일의 <b>모든 열쇠를 안드로이드 문자열 자원으로도</b> 적는다
// (`@expo/config-plugins` 의 android/Locales.js — `values-b+en/strings.xml` 등).
// 우리가 넣은 것은 전부 아이폰 전용 Info.plist 열쇠라, 안드로이드에는 기본 언어 쪽
// 짝이 없는 번역만 남는다. 그러면 릴리스 빌드의 린트가 ExtraTranslation 을 치명으로
// 보고 `:app:lintVitalRelease` 에서 빌드를 멈춘다.
//
// 그래서 안드로이드 쪽에 새겨진 아이폰 전용 열쇠만 걷어낸다. 나중에 누가 이 파일에
// 안드로이드에도 쓰이는 열쇠(app_name 같은)를 넣으면 그것은 건드리지 않는다.
//
// ⚠ CI 는 안드로이드 릴리스를 만들지 않아 이 실패를 잡지 못한다. 릴리스 빌드를
// 직접 돌려야 드러난다.
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/** 아이폰 Info.plist 전용 열쇠. 안드로이드 자원으로는 뜻이 없다. */
const IOS_ONLY = /^(NS[A-Za-z]+UsageDescription|ITSAppUsesNonExemptEncryption|CFBundle[A-Za-z]+)$/;

function stripIosKeys(file) {
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(
    /^\s*<string name="([^"]+)">[\s\S]*?<\/string>\s*$/gm,
    (line, name) => (IOS_ONLY.test(name) ? '' : line),
  );
  if (after === before) return false;
  // 남은 문자열이 없으면 파일째로 지운다 — 빈 자원 폴더는 aapt 가 싫어한다.
  if (!/<string\s/.test(after)) {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
    return true;
  }
  fs.writeFileSync(file, after.replace(/\n{3,}/g, '\n\n'));
  return true;
}

module.exports = function withIosOnlyLocales(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const res = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
      let cleaned = 0;
      for (const entry of fs.existsSync(res) ? fs.readdirSync(res) : []) {
        if (!entry.startsWith('values-b+')) continue;
        const file = path.join(res, entry, 'strings.xml');
        if (fs.existsSync(file) && stripIosKeys(file)) cleaned += 1;
      }
      if (cleaned) {
        console.log(`[with-ios-only-locales] 안드로이드에서 아이폰 전용 문구를 걷어냈다 (${cleaned}곳).`);
      }
      return cfg;
    },
  ]);
};
