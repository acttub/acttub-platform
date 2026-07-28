// RNFirebase 공식 fix: useFrameworks(static)에서 Firebase 파드를 정적 프레임워크로 링크한다.
// Podfile 최상단(첫 `require` 이후, target 블록 전)에 전역 `$RNFirebaseAsStaticFramework = true`를
// 주입하지 않으면, useFrameworks static + New Architecture 조합에서
// "RCTBridgeModule must be imported from module before required" / non-modular header 에러로
// Xcode 컴파일이 실패한다. (기존 with-non-modular-headers 플러그인과 병행 사용)
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const FLAG = '$RNFirebaseAsStaticFramework = true';

module.exports = function withRNFirebaseStatic(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfile, 'utf8');
      if (!contents.includes(FLAG)) {
        // 첫 줄(require 'json' 등) 뒤에 전역 플래그를 넣는다.
        contents = `${FLAG}\n${contents}`;
        fs.writeFileSync(podfile, contents);
      }
      return cfg;
    },
  ]);
};
