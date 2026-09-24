import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, test } from 'node:test';

// 엔진은 그대로 실행하고 파일·음성 모델·재생기 등 네이티브 경계만 대체한다.
globalThis.__readingEngineTest = { files: new Map(), players: [], calls: [], active: 0, peak: 0, gate: null };
const state = globalThis.__readingEngineTest;
const modules = {
  'expo-file-system': `const s=globalThis.__readingEngineTest;
    export const Paths={cache:'file:///cache'};
    export class File { constructor(root,name){this.uri=root+'/'+name;} get exists(){return s.files.has(this.uri);} write(bytes){s.files.set(this.uri,bytes);} }`,
  'expo-audio': `const s=globalThis.__readingEngineTest;
    export async function setAudioModeAsync(){}
    export function createAudioPlayer(source){
      const p={source,duration:0,playing:false,removed:false,listener:null,
        addListener(event,listener){this.listener=listener;return {remove:()=>{this.listener=null;}};},
        play(){this.playing=true;},remove(){this.removed=true;}};
      s.players.push(p);return p;
    }`,
  '../../i18n.ts': `export const currentLanguage=()=> 'ko'; export const translate=k=>k;`,
  '../network': `export async function currentNetworkType(){return globalThis.__readingEngineTest.network ?? 'wifi';}`,
  './assets': `const s=globalThis.__readingEngineTest;
    export const MODEL_KINDS=['vocoder'];
    export function assetsPresent(){return !!s.present;}
    export async function downloadAssets(variant,preset,onProgress){
      s.downloads=(s.downloads??0)+1;
      onProgress({phase:'download',receivedBytes:1,totalBytes:4,percent:25,etaSeconds:null});
      if(s.downloadGate) await s.downloadGate;
      if(s.downloadError) throw s.downloadError;
      onProgress({phase:'download',receivedBytes:4,totalBytes:4,percent:100,etaSeconds:0});
      return {modelPaths:{vocoder:'file:///v.onnx'},style:preset,cfgs:{},indexer:{}};
    }
    export async function downloadVoiceStyle(variant,preset){
      if(globalThis.__readingEngineTest.failPresets?.has(preset)) throw new Error('offline');
      return preset;
    }`,
  './helper.native.js': `const s=globalThis.__readingEngineTest;
    export const loadOnnx=async()=>{ if(s.loadFails) throw new Error('bad model'); return {}; };
    export const loadVoiceStyleFromObjects=styles=>styles[0];
    export const writeWavFile=samples=>new Uint8Array(samples);
    export class UnicodeProcessor{}
    export class TextToSpeech{
      sampleRate=24000;
      async call(text,locale,voice,steps,speed){
        s.active++;s.peak=Math.max(s.peak,s.active);s.calls.push({text,locale,voice,steps,speed});
        try { if(s.gate) await s.gate; return {wav:[1,2],duration:[5]}; }
        finally{s.active--;}
      }
    }`,
};
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/tts/engine.ts') && modules[specifier]) {
    return { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true };
  }
  return next(specifier, context);
} });
const engine = await import('../lib/reading/tts/engine.ts');
const flush = () => new Promise(resolve => setImmediate(resolve));

beforeEach(async () => {
  engine._reset();
  state.files.clear(); state.players.length=0; state.calls.length=0; state.active=0; state.peak=0; state.gate=null;
  state.failPresets=new Set();
  state.downloads=0; state.downloadGate=null; state.downloadError=null; state.loadFails=false; state.present=false; state.network='wifi';
  await engine.ensureReady();
});

test('같은 대사도 목소리·속도별로 합성하며 동일 설정의 저장본은 재사용한다', async () => {
  const first = await engine.synthesize('가지 마', 'script', 'F2');
  assert.equal(await engine.synthesize('가지 마', 'script', 'F2'), first);
  const man = await engine.synthesize('가지 마', 'script', 'M1');
  const slow = await engine.synthesize('가지 마', 'script', 'F2', { speed: 0.7 });
  assert.notEqual(first, man); assert.notEqual(first, slow);
  assert.deepEqual(state.calls.map(c => [c.voice, c.speed]), [['F2',1],['M1',1],['F2',0.7]]);
});

test('요청한 목소리를 못 받아 기본 목소리로 읽은 것은 그 목소리의 저장본으로 남기지 않는다', async () => {
  state.failPresets.add('F3');
  const fallback = await engine.synthesize('가지 마', 'script', 'F3');
  assert.equal(state.calls.at(-1).voice, 'M1');
  state.failPresets.clear();
  const real = await engine.synthesize('가지 마', 'script', 'F3');
  assert.notEqual(real, fallback);
  assert.equal(state.calls.at(-1).voice, 'F3');
  // 기본 목소리 저장본은 기본 목소리 요청이 그대로 다시 쓴다.
  assert.equal(await engine.synthesize('가지 마', 'script', 'M1'), fallback);
  assert.equal(state.calls.length, 2);
});

test('미리 생성 중의 즉시 요청도 모델을 동시에 실행하지 않는다', async () => {
  let release;
  state.gate = new Promise(resolve => { release=resolve; });
  const a = engine.synthesize('A', 'script', 'F1');
  const b = engine.synthesize('B', 'script', 'M2');
  await flush();
  assert.equal(state.calls.length, 1);
  release();
  await Promise.all([a,b]);
  assert.equal(state.peak, 1);
  assert.equal(state.calls.length, 2);
});

test('저장본의 길이가 아직 0이어도 완료 사건 전에는 다음 줄로 넘어가지 않는다', async () => {
  let finished=false;
  const playback=engine.play('file:///cached.wav').then(()=>{finished=true;});
  const player=state.players.at(-1);
  player.listener({isLoaded:true,didJustFinish:false,duration:5});
  await flush();
  assert.equal(finished,false);
  player.listener({isLoaded:true,didJustFinish:true,duration:5});
  await playback;
  assert.equal(finished,true);
  assert.equal(player.listener,null);
});

test('재생 중지로 대기를 풀고 합성 중 화면을 떠나면 뒤늦게 재생하지 않는다', async () => {
  const playing=engine.play('file:///cached.wav');
  const player=state.players.at(-1);
  engine.stop();
  await playing;
  assert.equal(player.removed,true);
  assert.equal(player.listener,null);
  let release;
  state.gate=new Promise(resolve=>{release=resolve;});
  const speaking=engine.speak('늦게 만들어지는 말','F1',{scriptId:'script'});
  await flush();
  engine.stop();
  release();
  await speaking;
  assert.equal(state.players.length,1);
});

test('준비 진행: 먼저 시작한 준비를 나중에 온 화면도 함께 지켜보고 받기는 한 번만 한다', async () => {
  engine._reset();
  state.downloads=0;
  let release;
  state.downloadGate=new Promise(resolve=>{release=resolve;});
  const early=[]; const late=[];
  const first=engine.ensureReady(p=>early.push(p.phase));
  await flush();
  assert.equal(engine.isPreparing(),true);
  const second=engine.ensureReady(p=>late.push(p.phase));
  assert.equal(late[0],'download'); // 늦게 와도 마지막 진행부터 받는다
  release();
  await Promise.all([first,second]);
  assert.equal(state.downloads,1);
  assert.deepEqual(early,['download','download','load','ready']);
  assert.deepEqual(late,['download','download','load','ready']);
  assert.equal(engine.isReady(),true);
});

test('미리 받기: Wi-Fi 에서만 받고, 진행 중인 준비와 한 번의 받기를 나눠 쓴다', async () => {
  engine._reset(); state.downloads=0;
  state.network='cellular';
  await engine.prefetchIfWifi();
  assert.equal(state.downloads,0);
  assert.equal(engine.isReady(),false);

  state.network='unknown';
  await engine.prefetchIfWifi();
  assert.equal(state.downloads,0);

  state.network='wifi';
  let release;
  state.downloadGate=new Promise(resolve=>{release=resolve;});
  const prefetch=engine.prefetchIfWifi();
  await flush(); await flush();
  const screen=engine.ensureReady();
  const again=engine.prefetchIfWifi();
  release();
  await Promise.all([prefetch,screen,again]);
  assert.equal(state.downloads,1);
  assert.equal(engine.isReady(),true);
});

test('미리 받기: 이미 받아 둔 모델은 미리 불러오지 않고 실패는 삼킨다', async () => {
  engine._reset(); state.downloads=0;
  state.present=true;
  await engine.prefetchIfWifi();
  assert.equal(state.downloads,0);
  assert.equal(engine.isReady(),false);

  state.present=false;
  state.downloadError=new Error('offline');
  await engine.prefetchIfWifi(); // 던지지 않는다
  assert.equal(engine.isReady(),false);
  assert.equal(engine.isPreparing(),false); // 실패 뒤에는 다시 시도할 수 있다
});

test('준비 실패: 모델을 못 불러오면 model_load 로 알린다', async () => {
  engine._reset();
  state.loadFails=true;
  await assert.rejects(engine.ensureReady(), (e) => e.kind === 'model_load');
  state.loadFails=false;
  await engine.ensureReady();
  assert.equal(engine.isReady(),true);
});
