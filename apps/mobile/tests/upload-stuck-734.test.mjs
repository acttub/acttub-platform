import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const upload = readFileSync(new URL('../app/upload.tsx', import.meta.url), 'utf8');

test('upload: 올리는 중에 「업로드 중...」을 누르면 업로드를 다시 시도한다 — 안내 문구대로 눌러서 밀 수 있다(SOMA-734)', () => {
  const press = upload.slice(upload.indexOf('const pressBlocked'), upload.indexOf('const toggleRights'));
  assert.match(press, /if \(uploading && user\?\.id\) void flushLibraryUploads\(user\.id\)/);
  assert.match(press, /noteBlocked\(\);/);
  assert.match(upload, /onPress=\{\(\) => \(ready \? void start\(\) : uploading && agreedRights && !sample \? setWaitPanel\(true\) : pressBlocked\(\)\)\}/);
});
