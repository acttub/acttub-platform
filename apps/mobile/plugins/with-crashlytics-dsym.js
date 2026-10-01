// iOS 크래시 스택을 읽으려면 릴리스 빌드의 dSYM 을 Crashlytics 에 올려야 한다. @react-native-firebase/crashlytics
// 의 Expo 플러그인은 안드로이드(R8 매핑 업로드)만 맡고 iOS 빌드 단계는 넣지 않으므로 여기서 더한다.
// Firebase 가 안내하는 run 스크립트와 입력 파일 그대로다.
const { withXcodeProject } = require('@expo/config-plugins');

const PHASE_NAME = '[Crashlytics] Upload dSYM';

module.exports = function withCrashlyticsDsym(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const target = project.getFirstTarget().uuid;
    const phases = project.hash.project.objects.PBXShellScriptBuildPhase ?? {};
    const exists = Object.values(phases).some((phase) => typeof phase === 'object' && phase.name === `"${PHASE_NAME}"`);
    if (!exists) {
      project.addBuildPhase([], 'PBXShellScriptBuildPhase', PHASE_NAME, target, {
        shellPath: '/bin/sh',
        shellScript: '"${PODS_ROOT}/FirebaseCrashlytics/run"',
        inputPaths: [
          '"${DWARF_DSYM_FOLDER_PATH}/${DWARF_DSYM_FILE_NAME}"',
          '"${DWARF_DSYM_FOLDER_PATH}/${DWARF_DSYM_FILE_NAME}/Contents/Resources/DWARF/${PRODUCT_NAME}"',
          '"${DWARF_DSYM_FOLDER_PATH}/${DWARF_DSYM_FILE_NAME}/Contents/Info.plist"',
          '"$(TARGET_BUILD_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)/GoogleService-Info.plist"',
          '"$(TARGET_BUILD_DIR)/$(EXECUTABLE_PATH)"',
        ],
      });
    }
    return cfg;
  });
};
