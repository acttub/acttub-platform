/**
 * 리딩 Live Activity(잠금 화면·다이내믹 아일랜드) 위젯 확장(SOMA-802). 시작·갱신·종료는 앱의 modules/reading-live 가 한다.
 * ReadingActivityAttributes.swift 는 그 모듈과 같은 내용이어야 한다(tests/reading-live-activity.test.mjs).
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: 'widget',
  name: 'ReadingLiveWidget',
  displayName: 'Acttub',
  bundleIdentifier: '.readinglive',
  deploymentTarget: '16.4',
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit', 'AppIntents'],
};
