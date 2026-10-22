// 위젯 확장(Live Activity, SOMA-802)을 앱에 넣는 「Embed Foundation Extensions」 단계가 Crashlytics dSYM 업로드 같은
// 실행 스크립트 뒤에 있으면 Xcode 가 빌드 순환(Cycle inside Acttub)으로 멈춘다. 그 단계를 리소스 복사 바로 뒤로 옮긴다.
// 그 단계는 @bacons/apple-targets 가 자기 Xcode mod 로 넣으므로 같은 mod 를 쓴다. mod 는 나중에 등록한 것이 먼저 돌므로
// app.json 에서 이 플러그인을 @bacons/apple-targets 보다 앞에 둔다(그래야 단계가 생긴 뒤에 돈다).
const { withXcodeProjectBeta } = require('@bacons/apple-targets/build/with-bacons-xcode');

const EMBED = 'Embed Foundation Extensions';

/** 앱 타깃의 빌드 단계 목록을 그 자리에서 고친다. */
function embedExtensionsFirst(phases) {
  const embed = phases.findIndex((p) => p.isa === 'PBXCopyFilesBuildPhase' && p.props.name === EMBED);
  const resources = phases.findIndex((p) => p.isa === 'PBXResourcesBuildPhase');
  if (resources >= 0 && embed > resources + 1) {
    const [phase] = phases.splice(embed, 1);
    phases.splice(resources + 1, 0, phase);
  }
}

module.exports = function withEmbedExtensionsFirst(config) {
  return withXcodeProjectBeta(config, (cfg) => {
    embedExtensionsFirst(cfg.modResults.rootObject.getMainAppTarget('ios')?.props.buildPhases ?? []);
    return cfg;
  });
};
module.exports.embedExtensionsFirst = embedExtensionsFirst;
