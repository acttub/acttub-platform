// 목소리 정하기(R3) 미리 듣기 샘플 assets/audio/voice-preview-<프리셋>.m4a 열 개를 다시 만든다.
// 서버와 같은 모델·목소리여야 하므로 목소리 짝은 서버 CloudVoiceService.java 에서 읽는다.
//   GEMINI_API_KEY=… GEMINI_TTS_MODEL=gemini-3.8-flash-tts node scripts/make_voice_previews.mjs
// macOS(afconvert)와 ffmpeg 가 필요하다. 키는 출력하지 않는다.
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEXT = '안녕하세요, 오늘 같이 연습해요.';
const here = new URL('.', import.meta.url).pathname;
const service = readFileSync(join(here, '../../api/src/main/java/com/acttub/actingapi/feature/reading/app/CloudVoiceService.java'), 'utf8');
const voices = [...service.matchAll(/voices\.put\("([MF]\d)", "(\w+)"\)/g)].map((m) => [m[1], m[2]]);
if (voices.length !== 10) throw new Error(`목소리 짝을 ${voices.length}개만 찾았다`);
const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_TTS_MODEL;
if (!key || !model) throw new Error('GEMINI_API_KEY·GEMINI_TTS_MODEL 이 필요하다');

const work = mkdtempSync(join(tmpdir(), 'voice-preview-'));
for (const [preset, voice] of voices) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: TEXT }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    }),
  });
  if (!res.ok) throw new Error(`${preset} ${voice}: ${res.status}`);
  const audio = Buffer.from((await res.json()).candidates[0].content.parts[0].inlineData.data, 'base64');
  const raw = join(work, `${preset}.raw`);
  const wav = join(work, `${preset}.wav`);
  writeFileSync(raw, audio);
  // 모델이 WAV(끝에 C2PA 덩어리)를 주기도, PCM 만 주기도 한다 — 서버 WavPcm 처럼 소리만 다시 싼다.
  const input = audio.subarray(0, 4).toString() === 'RIFF' ? ['-i', raw] : ['-f', 's16le', '-ar', '24000', '-ac', '1', '-i', raw];
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...input, '-c:a', 'pcm_s16le', '-ar', '24000', '-ac', '1', wav]);
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', wav, join(here, `../assets/audio/voice-preview-${preset.toLowerCase()}.m4a`)]);
  console.log(preset, voice);
}
