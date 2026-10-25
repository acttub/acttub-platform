import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// ActivityKit 은 앱(모듈)과 위젯 확장의 ActivityAttributes 를 타입 이름과 Codable 모양으로 잇는다. 한쪽만 고치면 카드가 비거나 갱신이 안 된다.
test('reading.live: 모듈과 위젯 확장의 Live Activity 상태 정의가 같다(SOMA-802)', () => {
  assert.equal(read('modules/reading-live/ios/ReadingActivityAttributes.swift'), read('targets/reading-live-widget/ReadingActivityAttributes.swift'));
});

test('reading.live: 모듈이 넘기는 필드가 Live Activity 상태에 모두 있다', () => {
  const attrs = read('targets/reading-live-widget/ReadingActivityAttributes.swift');
  const record = read('modules/reading-live/ios/ReadingLiveModule.swift');
  const fields = [...record.matchAll(/@Field var (\w+)/g)].map((m) => m[1]);
  assert.ok(fields.length > 0);
  for (const field of fields) assert.match(attrs, new RegExp(`var ${field}:`), field);
});

test('reading.live: 위젯 확장을 넣는 단계를 리소스 복사 바로 뒤로 옮겨 dSYM 스크립트와의 빌드 순환을 막는다', async () => {
  const { embedExtensionsFirst } = (await import('../plugins/with-embed-extensions-first.js')).default;
  const phase = (isa, name) => ({ isa, props: { name } });
  const phases = [
    phase('PBXSourcesBuildPhase'),
    phase('PBXResourcesBuildPhase'),
    phase('PBXShellScriptBuildPhase', '[Crashlytics] Upload dSYM'),
    phase('PBXCopyFilesBuildPhase', 'Embed Foundation Extensions'),
  ];
  embedExtensionsFirst(phases);
  assert.deepEqual(phases.map((p) => p.props.name ?? p.isa), [
    'PBXSourcesBuildPhase',
    'PBXResourcesBuildPhase',
    'Embed Foundation Extensions',
    '[Crashlytics] Upload dSYM',
  ]);
  // 이미 앞에 있거나 단계가 없으면 그대로 둔다.
  embedExtensionsFirst(phases);
  assert.equal(phases[2].props.name, 'Embed Foundation Extensions');
  const none = [phase('PBXResourcesBuildPhase')];
  embedExtensionsFirst(none);
  assert.equal(none.length, 1);
  // app.json 에서 @bacons/apple-targets 보다 앞에 있어야 그 단계가 생긴 뒤에 돈다.
  const plugins = JSON.parse(read('app.json')).expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
  assert.ok(plugins.indexOf('./plugins/with-embed-extensions-first.js') < plugins.indexOf('@bacons/apple-targets'));
});
