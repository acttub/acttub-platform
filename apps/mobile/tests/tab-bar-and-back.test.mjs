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

test('탭바: pen 「하단 탭 바」 — iOS·안드로이드 모두 바닥에 붙은 전체 폭 막대(높이 61.5, 위 1px 줄)', () => {
  // 모양은 공통 부품 components/ui/tab-bar 에 있다(SOMA-770).
  const tabs = read('components/ui/tab-bar.tsx');
  assert.match(read('app/(tabs)/_layout.tsx'), /tabBarStyle,/);
  assert.doesNotMatch(tabs, /Platform\.OS/);
  assert.match(tabs, /left: 0,\s*right: 0,\s*bottom: 0,/);
  assert.match(tabs, /TAB_BAR_HEIGHT = 61\.5/);
  assert.match(tabs, /height: TAB_BAR_HEIGHT \+ insets\.bottom/);
  assert.match(tabs, /borderTopWidth: 1,\s*borderTopColor: palette\.bgSoft/);
  // 고른 탭만 아이콘(22) 아래 이름(12/700)을 보인다
  assert.match(tabs, /<Ionicons size=\{22\}/);
  assert.match(tabs, /focused && <Text style=\{\[styles\.tabLabel/);
  assert.match(tabs, /tabLabel: \{ fontSize: 12, fontWeight: '700', lineHeight: 15 \}/);
});

test('안드로이드는 네이티브 뒤로 버튼에 꺾쇠 그림만 씌우고 헤더에 직접 만든 버튼을 넣지 않는다 — 넣으면 화면을 닫을 때 앱이 꺼졌다(SOMA-665)', () => {
  const root = read('app/_layout.tsx');
  // 예시 코치 화면처럼 뒤로 가기를 붙잡았다 다시 보내는 화면이 닫힐 때, 안드로이드 헤더(react-native-screens)가 직접 만든
  // 뒤로 버튼을 두 번 붙이려다 앱이 꺼졌다. 숨기기만 하는 1차 수정으로는 폰 뒤로 키 경로가 여전히 꺼졌다.
  const android = root.slice(root.indexOf(': {', root.indexOf("Platform.OS === 'ios'\n            ? {")));
  assert.match(android, /headerBackIcon: \{ type: 'image', source: require\('@\/assets\/images\/header-back\.png'\) \}/);
  assert.doesNotMatch(android.slice(0, android.indexOf('}>')), /headerLeft/);
});
