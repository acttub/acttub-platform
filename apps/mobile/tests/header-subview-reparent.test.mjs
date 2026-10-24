import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('안드로이드 헤더 오른쪽 버튼을 다시 붙일 때 옛 부모에서 먼저 떼어 앱이 꺼지지 않는다(SOMA-822)', () => {
  // Crashlytics: ScreenStackHeaderConfig.onUpdate 에서 「The specified child already has a parent」로 꺼졌다.
  // 0.1.3~0.1.5, /coach 와 /reading/detail 처럼 headerRight 를 쓰는 화면으로 돌아올 때. 라이브러리 최신판(4.30)도 그대로라 패치로 막는다.
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.postinstall ?? '', /patch-package/);
  assert.ok(pkg.devDependencies?.['patch-package'] ?? pkg.dependencies?.['patch-package']);
  const version = pkg.dependencies['react-native-screens'].replace(/^[~^]/, '');
  const name = readdirSync(new URL('../patches/', import.meta.url)).find((f) => f.startsWith('react-native-screens+'));
  assert.equal(name, `react-native-screens+${version}.patch`);
  const patch = read(`patches/${name}`);
  assert.match(patch, /ScreenStackHeaderConfig\.kt/);
  assert.match(patch, /\+\s*\(view\.parent as\? android\.view\.ViewGroup\)\?\.removeView\(view\)\n\s+toolbar\.addView\(view\)/);
});
