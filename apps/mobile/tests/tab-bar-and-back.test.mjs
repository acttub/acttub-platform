import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('스택 화면의 뒤로 버튼은 설정 화면과 같은 꺾쇠 버튼이다(네이티브 뒤로 버튼 대신, SOMA-638)', () => {
  const root = read('app/_layout.tsx');
  // iOS 는 네이티브 헤더(버튼마다 유리 배경) 대신 설정 화면처럼 꺾쇠 옆에 제목을 붙인 헤더를 직접 그린다.
  assert.match(root, /headerBackVisible: false,\s*headerLeft: \(\) => <HeaderBack \/>,\s*header: \(props: NativeStackHeaderProps\) => <AppHeader \{\.\.\.props\} \/>,/);
  const header = read('components/app-header.tsx');
  assert.match(header, /options\.headerLeft\?\.\(/);
  assert.match(header, /options\.headerRight\?\.\(/);
  const back = read('components/header-back.tsx');
  assert.match(back, /name="chevron-left" size=\{24\}/);
  assert.match(back, /router\.back\(\)/);
  assert.match(back, /canGoBack\(\)/);
  // 노트 화면은 뒤로 버튼을 두지 않는다(원래대로).
  assert.match(read('app/report.tsx'), /headerLeft: \(\) => null/);
});

test('탭바: iOS 는 홈 인디케이터 바로 위에 뜬 알약, 안드로이드는 바닥에 붙은 전체 폭 막대', () => {
  // 모양은 공통 부품 components/ui/tab-bar 에 있다(SOMA-770).
  const tabs = read('components/ui/tab-bar.tsx');
  assert.match(read('app/(tabs)/_layout.tsx'), /tabBarStyle,/);
  assert.match(tabs, /const IOS = Platform\.OS === 'ios'/);
  assert.match(tabs, /bottom: Math\.max\(insets\.bottom - 14, 12\)/);
  // 안드로이드: 좌우·바닥 여백 없음, 둥근 모서리 없음, 시스템 내비게이션 칸만큼 아래를 채운다
  assert.match(tabs, /left: 0,\s*right: 0,\s*bottom: 0,/);
  assert.match(tabs, /height: 72 \+ insets\.bottom/);
  // iOS는 탭 이름 글자 없이 아이콘을 세로 가운데에 두고(SOMA-838), 안드로이드는 고른 탭에만 이름을 쓴다(10/25 사용자)
  assert.match(tabs, /\{!IOS && focused \? \(\s*<Text style=\{\[styles\.tabLabel, \{ color \}\]\}/);
  assert.match(read('components/haptic-tab.tsx'), /EXPO_OS === 'ios' \? \[props\.style, \{ justifyContent: 'center' \}\] : props\.style/);
});

test('안드로이드는 네이티브 뒤로 버튼에 꺾쇠 그림만 씌우고 헤더에 직접 만든 버튼을 넣지 않는다 — 넣으면 화면을 닫을 때 앱이 꺼졌다(SOMA-665)', () => {
  const root = read('app/_layout.tsx');
  // 예시 코치 화면처럼 뒤로 가기를 붙잡았다 다시 보내는 화면이 닫힐 때, 안드로이드 헤더(react-native-screens)가 직접 만든
  // 뒤로 버튼을 두 번 붙이려다 앱이 꺼졌다. 숨기기만 하는 1차 수정으로는 폰 뒤로 키 경로가 여전히 꺼졌다.
  const android = root.slice(root.indexOf(': {', root.indexOf("Platform.OS === 'ios'\n            ? {")));
  assert.match(android, /headerBackIcon: \{ type: 'image', source: require\('@\/assets\/images\/header-back\.png'\) \}/);
  assert.doesNotMatch(android.slice(0, android.indexOf('}>')), /headerLeft/);
});

test('탭끼리의 뒤로가기는 들어온 순서대로 돌아간다 — 기본값은 숨긴 탭(지난 연습)에서도 홈으로 보낸다', () => {
  assert.match(read('app/(tabs)/_layout.tsx'), /<Tabs\s+backBehavior="history"/);
});

test('탭 밖 화면은 탭으로 갈 때 replace 하지 않고 이미 있는 탭까지 내려간다 — replace 하면 탭 묶음이 하나 더 쌓여 뒤로가기가 엉뚱한 탭으로 간다', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const { join, relative } = await import('node:path');
  const base = new URL('..', import.meta.url).pathname;
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name)) files.push(relative(base, full));
    }
  };
  for (const dir of ['app', 'components', 'hooks']) walk(join(base, dir));
  // 탭 안(app/(tabs))끼리는 탭 이동이라 쌓이지 않는다.
  const offenders = files
    .filter((f) => !f.startsWith('app/(tabs)/'))
    .filter((f) => /router\.replace\(\s*['"`](\/|\/\(tabs\)(\/[a-z-]+)?|\/reading|\/challenges|\/coaching|\/profile)['"`]\s*\)/.test(read(f)));
  assert.deepEqual(offenders, []);
});
