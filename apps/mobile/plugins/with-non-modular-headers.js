// RNFirebase + useFrameworks(static) 조합에서 나는
// "include of non-modular header inside framework module 'RNFBApp...'" 컴파일 에러 해결.
// Podfile의 post_install 훅에 CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES=YES를 주입한다.
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SNIPPET = `
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'
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
