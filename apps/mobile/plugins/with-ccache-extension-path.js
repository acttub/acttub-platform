// ccache(app.json ios.ccacheEnabled)를 켜면 React Native 가 앱 프로젝트 전체의 CC·LD 를
// "$(REACT_NATIVE_PATH)/scripts/xcode/ccache-clang.sh" 로 바꾸고 REACT_NATIVE_PATH 를 "${PODS_ROOT}/.." 로 둔다.
// 위젯 확장(targets/reading-live-widget)은 Pods 를 안 써서 PODS_ROOT 가 비고, 링크가
// "/../../node_modules/react-native/scripts/xcode/ccache-clang.sh" 를 못 찾아 실패한다(SOMA-1078).
// 앱 프로젝트에서만 PROJECT_DIR(ios/) 기준 경로로 바꾼다. Pods 프로젝트는 PODS_ROOT 가 있어 그대로 둔다.
// react_native_post_install 뒤에 돌아야 해서 post_install 이 아니라 post_integrate 에 둔다.
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARK = '# with-ccache-extension-path';
const SNIPPET = `
${MARK}
post_integrate do |installer|
  installer.aggregate_targets.map(&:user_project).uniq(&:path).each do |project|
    project.build_configurations.each do |config|
      config.build_settings['REACT_NATIVE_PATH'] = '$(PROJECT_DIR)/../node_modules/react-native'
    end
    project.save
  end
end
`;

module.exports = function withCcacheExtensionPath(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      const contents = fs.readFileSync(podfile, 'utf8');
      if (!contents.includes(MARK)) fs.writeFileSync(podfile, contents + SNIPPET);
      return cfg;
    },
  ]);
};
