import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { palette } from '../constants/palette.ts';
import { radius, space, type } from '../constants/tokens.ts';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

// docs/DESIGN-SYSTEM.html 토큰 표의 [이름, 값, 줄 원문]. 첫 두 칸의 <code> 만 읽는다.
function tokenRows(id) {
  const table = read('docs/DESIGN-SYSTEM.html').match(new RegExp(`<table id="${id}">([\\s\\S]*?)</table>`));
  assert.ok(table, `DESIGN-SYSTEM.html 에 ${id} 표가 없습니다`);
  const rows = [...table[1].matchAll(/<tr><td><code>([^<]+)<\/code><\/td><td>.*?<code>([^<]+)<\/code>.*<\/tr>/g)];
  return rows.map((m) => [m[1], m[2], m[0]]);
}

const camel = (name) => name.replace(/-(\w)/g, (_, c) => c.toUpperCase());

test('DESIGN-SYSTEM.html 색 표가 palette.ts 와 같다', () => {
  const rows = tokenRows('color-tokens');
  assert.deepEqual(Object.fromEntries(rows.map(([n, v]) => [camel(n), v])), palette);
  for (const [name, value, row] of rows) {
    assert.ok(row.includes(`style="background:${value}"`), `${name} 색 견본이 값 ${value} 와 다릅니다`);
  }
});

test('DESIGN-SYSTEM.html 글자 표가 tokens.ts type 과 같다', () => {
  const fromCode = Object.fromEntries(
    Object.entries(type).map(([k, t]) => [k, `${t.fontSize} / ${t.lineHeight} · ${t.fontWeight}`]),
  );
  assert.deepEqual(Object.fromEntries(tokenRows('type-tokens').map(([n, v]) => [camel(n), v])), fromCode);
});

test('DESIGN-SYSTEM.html 모서리 표가 tokens.ts radius 와 같다', () => {
  const rows = tokenRows('radius-tokens').map(([n, v]) => [n.replace(/^r-/, ''), Number(v)]);
  assert.deepEqual(Object.fromEntries(rows), radius);
});

test('DESIGN-SYSTEM.html 간격 표가 tokens.ts space 와 같다', () => {
  const rows = tokenRows('space-tokens').map(([n, v]) => [n.replace(/^space\[(.+)\]$/, '$1'), Number(v)]);
  assert.deepEqual(Object.fromEntries(rows), space);
});

// 지금 토큰 밖에 있는 곳의 파일별 개수. 새 어긋남만 막는다. 개수가 줄면 함께 낮춘다.
const HEX_ALLOWED = {
  'app/(tabs)/index.tsx': 11,
  'app/(tabs)/reading.tsx': 1,
  'app/challenge-play.tsx': 2,
  'app/login.tsx': 11,
  'app/reading/play.tsx': 3,
  'components/ad-slot.tsx': 1,
  'components/entry-share-sheet.tsx': 6,
  'components/home-plan-badge.tsx': 2,
  'components/launch-splash-screen.tsx': 8,
  'components/mic-button.tsx': 1,
  'components/practice-video-modal.tsx': 2,
  'components/settings-pro-card.tsx': 5,
  'components/streak-celebration-screen.tsx': 7,
  'components/ui/default-avatar.tsx': 10,
  'components/ui/tab-bar.tsx': 1,
};

const FONT_SIZE_ALLOWED = {
  'app/_layout.tsx': 1,
  'app/login.tsx': 1,
  'app/notice-detail.tsx': 1,
  'app/ui-preview.tsx': 5,
  'components/ad-slot.tsx': 2,
  'components/announcement-poster.tsx': 7,
  'components/birth-wheel.tsx': 2,
  'components/diff-text.tsx': 4,
  'components/home-mascot.tsx': 1,
  'components/launch-splash-screen.tsx': 1,
  'components/markdown.tsx': 5,
  'components/note-cheer.tsx': 1,
  'components/practice-chrome.tsx': 11,
  'components/practice-video-modal.tsx': 1,
  'components/streak-celebration-screen.tsx': 7,
  'components/ui/loading-text.tsx': 1,
  'components/ui/mascot-bubble.tsx': 3,
  'components/ui/option-card.tsx': 7,
  'components/ui/summary-row.tsx': 3,
};

const SWITCH_ALLOWED = ['components/ui/list-rows.tsx'];

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\/|(?<![:'"`])\/\/.*$/gm, '');

const sources = ['app', 'components'].flatMap((dir) =>
  readdirSync(new URL(`${dir}/`, root), { recursive: true })
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => [`${dir}/${f}`, stripComments(read(`${dir}/${f}`))]),
);

function countByFile(pattern) {
  const counts = {};
  for (const [file, src] of sources) {
    const n = src.match(pattern)?.length ?? 0;
    if (n) counts[file] = n;
  }
  return counts;
}

function assertAllowed(what, found, allowed) {
  const files = [...new Set([...Object.keys(found), ...Object.keys(allowed)])];
  const over = files.filter((f) => (found[f] ?? 0) > (allowed[f] ?? 0));
  const under = files.filter((f) => (found[f] ?? 0) < (allowed[f] ?? 0));
  const list = (fs) => fs.map((f) => `${f}: 허용 ${allowed[f] ?? 0}, 지금 ${found[f] ?? 0}`).join('\n');
  assert.equal(over.length, 0, `새 ${what}: constants/palette.ts·tokens.ts 토큰을 쓰세요.\n${list(over)}`);
  assert.equal(under.length, 0, `${what} 개수가 줄었습니다: tests/design-system.test.mjs 허용 목록도 줄이세요.\n${list(under)}`);
}

test('app·components 에 허용 목록 밖 hex 색이 없다', () => {
  assertAllowed('hex 색', countByFile(/#[0-9a-fA-F]{3,8}\b/g), HEX_ALLOWED);
});

test('app·components 에 허용 목록 밖 fontSize 숫자가 없다', () => {
  // type.body1.fontSize 처럼 토큰을 읽는 값은 세지 않는다.
  assertAllowed('fontSize 숫자', countByFile(/\bfontSize\s*[:=]\s*\{?[^,;\n}]*?(?<![\w.])\d/g), FONT_SIZE_ALLOWED);
});

test('react-native Switch 는 BlueSwitch 만 직접 쓴다', () => {
  const importsSwitch = /import\s*\{[^}]*\bSwitch\b[^}]*\}\s*from\s*['"]react-native['"]/;
  assert.deepEqual(
    sources.filter(([, src]) => importsSwitch.test(src)).map(([file]) => file),
    SWITCH_ALLOWED,
    '스위치는 components/ui/list-rows.tsx 의 BlueSwitch 를 쓰세요.',
  );
});
