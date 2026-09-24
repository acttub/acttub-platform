/* eslint-disable */
/**
 * SPIKE (SOMA-500)에서 시작한 자산 받기. 모델 받기는 SOMA-494 에서 진행률·이어받기를 붙였다.
 * Supertonic 자산(모델 4개 + tts.json + unicode_indexer.json + voice style)을
 * HuggingFace 에서 기기로 내려받아 로컬 경로/파싱본을 돌려준다.
 * 큰 파일은 앱에 번들하지 않고 런타임 다운로드(실제 기능도 그렇게 갈 예정).
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Legacy from 'expo-file-system/legacy';
import { AppState, Platform } from 'react-native';

import { createDownloadProgress, type DownloadProgress, type VoiceProgress } from './download-progress.ts';
import { checkDownloaded, hasEnoughSpace, missingBytes, planModelDownload } from './download-plan.ts';
import { VoicePrepareError, voiceErrorKind } from './voice-errors.ts';

const SUPERTONE = 'https://huggingface.co/Supertone/supertonic-3/resolve/main';
const INT8 = 'https://huggingface.co/csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11/resolve/main';

export type Variant = 'fp32' | 'int8';
export type ModelKind = 'durationPredictor' | 'textEncoder' | 'vectorEstimator' | 'vocoder';

const MODEL_FILES: Record<Variant, Record<ModelKind, { url: string; name: string; bytes: number }>> = {
  fp32: {
    durationPredictor: { url: `${SUPERTONE}/onnx/duration_predictor.onnx`, name: 'duration_predictor.onnx', bytes: 3_700_147 },
    textEncoder: { url: `${SUPERTONE}/onnx/text_encoder.onnx`, name: 'text_encoder.onnx', bytes: 36_416_150 },
    vectorEstimator: { url: `${SUPERTONE}/onnx/vector_estimator.onnx`, name: 'vector_estimator.onnx', bytes: 256_534_781 },
    vocoder: { url: `${SUPERTONE}/onnx/vocoder.onnx`, name: 'vocoder.onnx', bytes: 101_424_195 },
  },
  int8: {
    durationPredictor: { url: `${INT8}/duration_predictor.int8.onnx`, name: 'duration_predictor.int8.onnx', bytes: 3_700_147 },
    textEncoder: { url: `${INT8}/text_encoder.int8.onnx`, name: 'text_encoder.int8.onnx', bytes: 36_416_150 },
    vectorEstimator: { url: `${INT8}/vector_estimator.int8.onnx`, name: 'vector_estimator.int8.onnx', bytes: 78_400_833 },
    vocoder: { url: `${INT8}/vocoder.int8.onnx`, name: 'vocoder.int8.onnx', bytes: 25_991_073 },
  },
};

const CONFIG_URL = `${SUPERTONE}/onnx/tts.json`;
const INDEXER_URL = `${SUPERTONE}/onnx/unicode_indexer.json`;
const voiceUrl = (preset: string) => `${SUPERTONE}/voice_styles/${preset}.json`;

export const MODEL_KINDS: ModelKind[] = ['durationPredictor', 'textEncoder', 'vectorEstimator', 'vocoder'];

export function variantBytes(v: Variant): number {
  return MODEL_KINDS.reduce((a, k) => a + MODEL_FILES[v][k].bytes, 0);
}

function dirFor(variant: Variant): Directory {
  return new Directory(Paths.document, `supertonic-${variant}`);
}

export interface DownloadResult {
  modelPaths: Record<ModelKind, string>; // file:// URIs
  cfgs: any;
  indexer: number[];
  style: any;
}

export type ProgressFn = (p: VoiceProgress) => void;

/**
 * 모델 받기 (SOMA-494). legacy DownloadResumable 로 받는 이유는 진행 콜백과 이어받기 때문이다 — 새 File API 의
 * downloadFileAsync 에는 둘 다 없어서 380MB 를 받는 동안 진행을 보여 줄 수 없었고, 끊기면 처음부터였다.
 *
 * - `<이름>.part` 에 받고 크기가 맞을 때만 제자리로 옮긴다(download-plan).
 * - 앱이 배경으로 가면 멈추고 이어받기 값을 `<이름>.resume` 에 남긴다. 돌아오면 이어서 받는다. 앱이 죽었으면
 *   다음 시도에서 그 값(iOS) 또는 남은 .part 크기(Android)로 이어받는다.
 */
type ActiveDownload = { task: Legacy.DownloadResumable; stateFile: File; url: string; pausing: Promise<string | null> | null };
let active: ActiveDownload | null = null;

function watchAppState(): () => void {
  const sub = AppState.addEventListener('change', (next) => {
    const cur = active;
    if (next !== 'background' || !cur || cur.pausing) return;
    cur.pausing = cur.task
      .pauseAsync()
      .then((saved) => {
        const resumeData = saved?.resumeData ?? null;
        if (resumeData) writeResume(cur.stateFile, cur.url, resumeData);
        return resumeData;
      })
      .catch(() => null);
  });
  return () => sub.remove();
}

function waitForActive(): Promise<void> {
  if (AppState.currentState === 'active') return Promise.resolve();
  return new Promise((resolve) => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        sub.remove();
        resolve();
      }
    });
  });
}

function readResume(stateFile: File, url: string): string | null {
  try {
    if (!stateFile.exists) return null;
    const saved = JSON.parse(stateFile.textSync());
    return saved?.url === url && typeof saved.resumeData === 'string' ? saved.resumeData : null;
  } catch {
    clearResume(stateFile);
    return null;
  }
}

function writeResume(stateFile: File, url: string, resumeData: string) {
  try {
    if (!stateFile.exists) stateFile.create();
    stateFile.write(JSON.stringify({ url, resumeData }));
  } catch {}
}

function clearResume(stateFile: File) {
  try {
    if (stateFile.exists) stateFile.delete();
  } catch {}
}

function sizeOf(file: File): number | null {
  try {
    return file.exists ? (file.size ?? 0) : null;
  } catch {
    return null;
  }
}

function freeDiskBytes(): number | null {
  try {
    const free = Paths.availableDiskSpace;
    return typeof free === 'number' && free > 0 ? free : null;
  } catch {
    return null;
  }
}

function downloadError(e: unknown, name: string): VoicePrepareError {
  const kind = voiceErrorKind(e) === 'storage' ? 'storage' : 'network';
  return new VoicePrepareError(kind, `download failed: ${name}`, { cause: e });
}

/** 한 번의 받기. 배경으로 가 멈추면 돌아올 때까지 기다렸다 이어받는다. */
async function runDownload(
  url: string,
  part: File,
  stateFile: File,
  resumeData: string | null,
  onBytes: (bytes: number) => void,
): Promise<Legacy.FileSystemDownloadResult> {
  let resume = resumeData;
  for (let round = 0; round < 50; round++) {
    const task = Legacy.createDownloadResumable(url, part.uri, {}, (d) => onBytes(d.totalBytesWritten), resume ?? undefined);
    const me: ActiveDownload = { task, stateFile, url, pausing: null };
    active = me;
    let result: Legacy.FileSystemDownloadResult | undefined;
    try {
      result = await task.downloadAsync();
    } finally {
      if (active === me) active = null;
    }
    if (result) return result;
    // 멈췄다(배경). 이어받기 값: 멈추며 받은 값 → Android 는 남은 조각 크기.
    const paused = me.pausing ? await me.pausing : null;
    const partBytes = sizeOf(part);
    resume = Platform.OS === 'android' ? (partBytes ? String(partBytes) : null) : paused;
    await waitForActive();
  }
  throw new VoicePrepareError('network', 'download paused too many times');
}

async function ensureModel(
  dir: Directory,
  m: { url: string; name: string; bytes: number },
  progress: DownloadProgress,
  emit: () => void,
): Promise<File> {
  const target = new File(dir, m.name);
  if (target.exists && (target.size ?? 0) >= m.bytes) {
    progress.complete(m.name);
    return target;
  }
  if (target.exists) target.delete();
  const part = new File(dir, `${m.name}.part`);
  const stateFile = new File(dir, `${m.name}.resume`);

  const finalize = () => {
    part.move(target);
    clearResume(stateFile);
    progress.complete(m.name);
    emit();
    return new File(dir, m.name);
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const plan = planModelDownload({
      platform: Platform.OS,
      expectedBytes: m.bytes,
      partBytes: sizeOf(part),
      savedResumeData: readResume(stateFile, m.url),
    });
    if (plan.action === 'finalize') return finalize();
    if (plan.discardPart && part.exists) part.delete();
    if (!plan.resumeData) {
      clearResume(stateFile);
      progress.reset(m.name);
    }

    let result: Legacy.FileSystemDownloadResult;
    try {
      result = await runDownload(m.url, part, stateFile, plan.resumeData, (bytes) => {
        progress.update(m.name, bytes);
        emit();
      });
    } catch (e) {
      clearResume(stateFile);
      // iOS 이어받기 값이 낡았으면(임시 파일이 지워짐) 처음부터 한 번 더 받는다.
      if (plan.resumeData && Platform.OS !== 'android' && attempt === 0) continue;
      throw downloadError(e, m.name);
    }

    const check = checkDownloaded({ expectedBytes: m.bytes, actualBytes: sizeOf(part) ?? 0, status: result.status });
    if (check === 'ok') return finalize();
    if (check === 'corrupt') {
      if (part.exists) part.delete();
      clearResume(stateFile);
      progress.reset(m.name);
    }
    // short: 다음 바퀴에서 이어받는다(Android). iOS 는 처음부터.
  }
  throw new VoicePrepareError('network', `download incomplete: ${m.name}`);
}

/** 작은 JSON(설정·글자표·목소리 스타일)을 받아 파싱한다. 캐시가 깨졌으면 지우고 한 번 다시 받는다. */
async function readJson(dir: Directory, url: string, name: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const file = new File(dir, name);
    if (!(file.exists && (file.size ?? 0) >= 1000)) {
      if (file.exists) file.delete();
      try {
        await File.downloadFileAsync(url, file);
      } catch (e) {
        throw downloadError(e, name);
      }
    }
    try {
      return JSON.parse(await file.text());
    } catch (e) {
      try {
        if (file.exists) file.delete();
      } catch {}
      if (attempt >= 1) throw new VoicePrepareError('parse', `bad json: ${name}`, { cause: e });
    }
  }
}

export async function downloadAssets(variant: Variant, preset: string, onProgress: ProgressFn = () => {}): Promise<DownloadResult> {
  const dir = dirFor(variant);
  if (!dir.exists) dir.create({ intermediates: true });

  const models = MODEL_KINDS.map((kind) => ({ kind, ...MODEL_FILES[variant][kind] }));
  const needed = missingBytes(
    models.map((m) => {
      const done = new File(dir, m.name);
      const present = done.exists && (done.size ?? 0) >= m.bytes ? m.bytes : (sizeOf(new File(dir, `${m.name}.part`)) ?? 0);
      return { expectedBytes: m.bytes, presentBytes: present };
    }),
  );
  if (!hasEnoughSpace({ freeBytes: freeDiskBytes(), neededBytes: needed })) {
    throw new VoicePrepareError('storage', 'not enough space', { neededBytes: needed });
  }

  const progress = createDownloadProgress(models.map((m) => ({ id: m.name, bytes: m.bytes })));
  let lastEmit = 0;
  const emit = (force = false) => {
    if (needed <= 0) return; // 다 받아 둔 상태 — 받기 단계를 보여 주지 않는다
    const now = Date.now();
    if (!force && now - lastEmit < 250) return;
    lastEmit = now;
    onProgress({ phase: 'download', ...progress.snapshot() });
  };

  const modelPaths = {} as Record<ModelKind, string>;
  const stopWatching = watchAppState();
  try {
    for (const m of models) {
      const done = new File(dir, m.name);
      if (done.exists && (done.size ?? 0) >= m.bytes) progress.complete(m.name);
    }
    emit(true); // 받기 시작 전에 카드부터 띄운다(이미 받아 둔 파일은 채운 채로)
    for (const m of models) {
      const f = await ensureModel(dir, m, progress, emit);
      modelPaths[m.kind] = f.uri;
      emit(true);
    }
  } finally {
    stopWatching();
  }

  // 작은 JSON 들 (variant 무관, fp32 쪽 dir 에 함께 저장)
  const cfgs = await readJson(dir, CONFIG_URL, 'tts.json');
  const indexer = await readJson(dir, INDEXER_URL, 'unicode_indexer.json');
  const style = await readJson(dir, voiceUrl(preset), `${preset}.json`);

  return { modelPaths, cfgs, indexer, style };
}

/** 목소리 스타일(프리셋)만 받아 파싱한다. 모델과 달리 작아서(수십 KB) 배역마다 그때그때 받는다. */
export async function downloadVoiceStyle(variant: Variant, preset: string): Promise<any> {
  const dir = dirFor(variant);
  if (!dir.exists) dir.create({ intermediates: true });
  return readJson(dir, voiceUrl(preset), `${preset}.json`);
}

/** 처음 내려받을 때 보여 줄 용량(모델 4개). 이동통신이면 확인을 받는다(reading.cast). */
export function modelDownloadBytes(variant: Variant): number {
  return variantBytes(variant);
}

export function assetsPresent(variant: Variant, preset: string): boolean {
  const dir = dirFor(variant);
  if (!dir.exists) return false;
  for (const kind of MODEL_KINDS) {
    const m = MODEL_FILES[variant][kind];
    const f = new File(dir, m.name);
    if (!f.exists || (f.size ?? 0) < m.bytes) return false;
  }
  return true;
}
