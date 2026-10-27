import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('palette: pen 파이프라인 반영버전의 파랑 셋', () => {
  const palette = read('constants/palette.ts');
  assert.match(palette, /blue: '#4880EE'/);
  assert.match(palette, /blueDeep: '#3268D8'/);
  assert.match(palette, /blueSoft: '#EAF3FE'/);
});

test('공통 부품: 헤더·진행 머리·말풍선이 pen 00-components 수치다', () => {
  const nav = read('components/ui/nav-header.tsx');
  assert.match(nav, /row: \{ height: 44,/);
  assert.match(nav, /title: \{ fontSize: 18, fontWeight: '800'/);
  assert.match(nav, /export function BackTitleHeader/);
  assert.match(nav, /backTitle: \{ height: 44, flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 12, paddingRight: 16 \}/);
  assert.match(nav, /export function LargeTitleHeader/);
  assert.match(nav, /largeTitle: \{ fontSize: 28, fontWeight: '800'/);

  const progress = read('components/ui/step-header.tsx');
  assert.match(progress, /progress: \{ height: 44, flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 18 \}/);
  assert.match(progress, /height: 7,\s*marginLeft: 21,\s*marginRight: 11,/);
  assert.match(progress, /count: \{ fontSize: 15, fontWeight: '700', color: palette\.textMeta \}/);

  const bubble = read('components/ui/mascot-bubble.tsx');
  assert.match(bubble, /MASCOT_SIZE\.bubble/);
  assert.match(read('components/ui/mascot.ts'), /bubble: \{ width: 52, height: 61 \}/);
  assert.match(bubble, /title: \{ fontSize: 19, fontWeight: '700', lineHeight: 25/);
  assert.match(bubble, /guide: \{ fontSize: 15, fontWeight: '600', lineHeight: 20, color: palette\.blueDeep \}/);
});

test('공통 부품: 선택 행·요약 행·동의 행·선택 카드·설정 카드', () => {
  const option = read('components/ui/option-card.tsx');
  assert.match(option, /minHeight: 49,/);
  assert.match(option, /radio: \{ width: 18, height: 18, borderRadius: 9, borderWidth: 1\.5/);
  assert.match(option, /gap: 21,\s*paddingVertical: 13,\s*paddingLeft: 19,\s*paddingRight: 14,/);
  assert.match(option, /title: \{ fontSize: 18, fontWeight: '700', lineHeight: 23/);

  const summary = read('components/ui/summary-row.tsx');
  assert.match(summary, /padding: 15,\s*borderRadius: 16,\s*borderWidth: 1,\s*borderColor: palette\.border,/);
  assert.match(summary, /label: \{ fontSize: 14, fontWeight: '600', color: palette\.textMeta \}/);
  assert.match(summary, /value: \{ flexShrink: 1, fontSize: 16, fontWeight: '700'/);

  const consent = read('components/consent-row.tsx');
  assert.match(consent, /minHeight: 55,/);
  // 긴 제목(「[선택] 광고성 정보 (이메일 · 앱 푸시)」)이 잘리지 않게 두 줄까지 내린다(10/22 피드백).
  assert.match(consent, /numberOfLines=\{2\}/);
  assert.doesNotMatch(consent, /numberOfLines=\{1\}/);

  const card = read('components/ui/settings-card.tsx');
  assert.match(card, /iconCell: \{ width: 44, height: 44,/);
  assert.match(card, /borderColor: palette\.border,/);
  assert.match(card, /title: \{ fontSize: 15\.5, fontWeight: '800'/);
  assert.match(card, /sub: \{ fontSize: 12\.5,/);
  // 설정 화면(pen S15.3)은 묶음 카드(18/6 모서리)로 그린다 — 보관함·Pro 줄은 없다.
  const settings = read('app/settings.tsx');
  assert.match(settings, /settings-card/);
  assert.doesNotMatch(settings, /library|보관함|ACTTUB Pro/);
});
