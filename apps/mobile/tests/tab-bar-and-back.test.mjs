import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('스택 화면의 뒤로 버튼은 설정 화면과 같은 꺾쇠 버튼이다(네이티브 뒤로 버튼 대신, SOMA-638)', () => {
  const root = read('app/_layout.tsx');
  assert.match(root, /headerBackVisible: false/);
  assert.match(root, /headerLeft: \(\) => <HeaderBack \/>/);
  // iOS 는 네이티브 헤더(버튼마다 유리 배경) 대신 설정 화면처럼 꺾쇠 옆에 제목을 붙인 헤더를 직접 그린다.
  assert.match(root, /Platform\.OS === 'ios' \? \{ header: \(props: NativeStackHeaderProps\) => <AppHeader \{\.\.\.props\} \/> \}/);
  const header = read('components/app-header.tsx');
  assert.match(header, /options\.headerLeft\?\.\(/);
  assert.match(header, /options\.headerRight\?\.\(/);
  const back = read('components/header-back.tsx');
  assert.match(back, /name="chevron-left" size=\{26\}/);
  assert.match(back, /router\.back\(\)/);
  assert.match(back, /canGoBack\(\)/);
  // 노트 화면은 뒤로 버튼을 두지 않는다(원래대로).
  assert.match(read('app/report.tsx'), /headerLeft: \(\) => null/);
});

test('탭바: iOS 는 홈 인디케이터 바로 위에 뜬 알약, 안드로이드는 바닥에 붙은 전체 폭 막대', () => {
  const tabs = read('app/(tabs)/_layout.tsx');
  assert.match(tabs, /const IOS = Platform\.OS === 'ios'/);
  assert.match(tabs, /bottom: Math\.max\(insets\.bottom - 14, 12\)/);
  // 안드로이드: 좌우·바닥 여백 없음, 둥근 모서리 없음, 시스템 내비게이션 칸만큼 아래를 채운다
  assert.match(tabs, /left: 0,\s*right: 0,\s*bottom: 0,/);
  assert.match(tabs, /height: 72 \+ insets\.bottom/);
  // 안드로이드는 고른 탭만 아이콘 아래 이름을 보인다(pen 하단 탭 바)
  assert.match(tabs, /!IOS && focused && <Text style=\{\[styles\.tabLabel/);
});

test('안드로이드 뒤로 버튼은 돌아갈 곳이 없어도 사라지지 않는다 — 헤더 조각이 붙었다 떨어지면 앱이 꺼진다(SOMA-665)', () => {
  const back = read('components/header-back.tsx');
  // 예시 코치 화면처럼 뒤로 가기를 붙잡았다 다시 보내는 화면이 닫히는 사이에 canGoBack 이 바뀌어 버튼이 사라졌다
  // 생기면, 안드로이드 헤더(react-native-screens)가 같은 조각을 두 번 붙이려다 앱이 꺼졌다. 그래서 안드로이드에서는
  // 늘 그려 두고 숨기기·눌러도 아무 일 없게만 한다. iOS 는 헤더를 앱이 그려서(AppHeader) 빼도 된다.
  assert.doesNotMatch(back, /if \(!router\.canGoBack\(\)\) return null;/);
  assert.match(back, /if \(!canGoBack && Platform\.OS === 'ios'\) return null;/);
  assert.match(back, /disabled=\{!canGoBack\}/);
});
