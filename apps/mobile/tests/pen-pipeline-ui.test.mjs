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

test('공통 부품: 말풍선이 pen 00-components 수치다', () => {
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
  // 긴 제목(「[선택] 광고성 정보 (이메일 · 앱 푸시)」)이 잘리지 않게 두 줄까지 내린다(10/22 피드백).
  assert.match(consent, /numberOfLines=\{2\}/);
  assert.doesNotMatch(consent, /numberOfLines=\{1\}/);

  const card = read('components/ui/settings-card.tsx');
  assert.match(card, /borderColor: palette\.border,/);
  // 설정 화면은 카드 줄로 그린다 — 보관함 줄은 없다.
  const settings = read('app/settings.tsx');
  assert.match(settings, /settings-card/);
  assert.doesNotMatch(settings, /library|보관함|ACTTUB Pro/);
});
