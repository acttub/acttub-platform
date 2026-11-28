// useFrameworks 로 파드를 프레임워크로 묶을 때 나는
// "include of non-modular header inside framework module" 컴파일 에러를 막는다.
// Podfile의 post_install 훅에 CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES=YES를 주입한다.
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// RNFB 타깃에 걸던 CLANG_ENABLE_MODULES=NO 는 정적 프레임워크 때의 우회였다. RNFB 27 은 Swift 가 섞이고
// Firebase 를 SPM 모듈로 가져오므로 모듈을 끄면 안 된다(동적 프레임워크로 바꾸며 뺐다).
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
