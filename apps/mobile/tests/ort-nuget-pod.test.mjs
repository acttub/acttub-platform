import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const appRoot = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(appRoot, rel), 'utf8');
const { addOrtNugetPod } = require('../plugins/with-ort-nuget-pod.js');

const PODFILE = "target 'Acttub' do\n  pod 'onnxruntime-react-native', :path => '../node_modules/onnxruntime-react-native'\n  use_expo_modules!\n\n  config = use_native_modules!\nend\n";

test('ort-nuget-pod: use_expo_modules! 다음 줄에 NuGet podspec 을 한 번만 넣는다', () => {
  const once = addOrtNugetPod(PODFILE);
  assert.match(once, /use_expo_modules!\n  pod 'onnxruntime-c', :podspec => '\.\.\/plugins\/onnxruntime-c-nuget\/onnxruntime-c\.podspec'\n/);
  assert.equal(addOrtNugetPod(once), once);
});

test('ort-nuget-pod: 넣을 자리가 없으면 조용히 넘어가지 않고 멈춘다', () => {
  assert.throws(() => addOrtNugetPod("target 'Acttub' do\nend\n"), /use_expo_modules!/);
});

test('ort-nuget-pod: 플러그인이 app.json 에 있고 podspec 은 NuGet 1.30.0 을 sha256 으로 고정한다', () => {
  const plugins = JSON.parse(read('app.json')).expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
  assert.ok(plugins.includes('./plugins/with-ort-nuget-pod.js'));
  const spec = read('plugins/onnxruntime-c-nuget/onnxruntime-c.podspec');
  assert.match(spec, /s\.version = '1\.30\.0'/);
  assert.match(spec, /api\.nuget\.org\/v3-flatcontainer\/microsoft\.ml\.onnxruntime\/1\.30\.0\//);
  assert.match(spec, /:sha256 => '[0-9a-f]{64}'/);
  assert.doesNotMatch(spec, /download\.onnxruntime\.ai\/pod-archive/);
});
