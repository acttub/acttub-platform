// RNFirebase + useFrameworks(static) 조합에서 나는
// "include of non-modular header inside framework module 'RNFBApp...'" 컴파일 에러 해결.
// Podfile의 post_install 훅에 CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES=YES를 주입한다.
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// RNFBAnalytics는 RNFBApp(정적 프레임워크 모듈)을 의존하면서 `#import <React/RCTBridgeModule.h>`를
// 텍스트로 재인클루드해 "declaration of 'RCTBridgeModule' must be imported from module
// 'RNFBApp.RNFBAppModule' before it is required" 에러가 난다. 이건 non-modular 플래그로는 안 잡히고
// 해당 RNFB 타겟에서 CLANG_ENABLE_MODULES=NO(ObjC @import만 끔, Swift 브릿징엔 무관)로 해결한다.
const SNIPPET = `
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'
        if ['RNFBApp', 'RNFBAnalytics'].include?(target.name)
          config.build_settings['CLANG_ENABLE_MODULES'] = 'NO'
        end
      end
    end`;

module.exports = function withNonModularHeaders(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfile, 'utf8');
      if (!contents.includes('CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES')) {
        contents = contents.replace(/post_install do \|installer\|/, (m) => m + SNIPPET);
        fs.writeFileSync(podfile, contents);
      }
      return cfg;
    },
  ]);
};
