/* eslint-disable */
// @ts-nocheck
/**
 * SPIKE (SOMA-500) — 버리는 코드다.
 * Supertonic 자산(모델 4개 + tts.json + unicode_indexer.json + voice style)을
 * HuggingFace 에서 기기로 내려받아 로컬 경로/파싱본을 돌려준다.
 * 큰 파일은 앱에 번들하지 않고 런타임 다운로드(실제 기능도 그렇게 갈 예정).
 */
import { Directory, File, Paths } from 'expo-file-system';

import { translate as t } from '../../i18n.ts';

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

export type LogFn = (line: string) => void;

async function ensureFile(dir: Directory, url: string, name: string, bytes: number, log: LogFn): Promise<File> {
  const target = new File(dir, name);
  if (target.exists && (target.size ?? 0) >= bytes) {
    log(`  ✓ 캐시됨 ${name} (${fmtMB(target.size ?? 0)})`);
    return target;
  }
  if (target.exists) target.delete();
  const t0 = Date.now();
  log(`  ↓ 받는 중 ${name} (${fmtMB(bytes)})...`);
  await File.downloadFileAsync(url, target);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  log(`  ✓ 완료 ${name} — ${dt}s (${fmtMB(target.size ?? 0)})`);
  return target;
}

export async function downloadAssets(variant: Variant, preset: string, log: LogFn): Promise<DownloadResult> {
  const dir = dirFor(variant);
  if (!dir.exists) dir.create({ intermediates: true });

  log(`자산 다운로드 시작 (variant=${variant}, 총 ${fmtMB(variantBytes(variant))})`);

  const modelPaths = {} as Record<ModelKind, string>;
  for (const kind of MODEL_KINDS) {
    const m = MODEL_FILES[variant][kind];
    const f = await ensureFile(dir, m.url, m.name, m.bytes, log);
    modelPaths[kind] = f.uri;
  }

  // 작은 JSON 들 (variant 무관, fp32 쪽 dir 에 함께 저장)
  const cfgFile = await ensureFile(dir, CONFIG_URL, 'tts.json', 1000, log);
  const idxFile = await ensureFile(dir, INDEXER_URL, 'unicode_indexer.json', 1000, log);
  const styleFile = await ensureFile(dir, voiceUrl(preset), `${preset}.json`, 1000, log);

  log(t('reading.voiceParsing'));
  const cfgs = JSON.parse(await cfgFile.text());
  const indexer = JSON.parse(await idxFile.text());
  const style = JSON.parse(await styleFile.text());
  log(t('reading.voiceAssetsReady'));

  return { modelPaths, cfgs, indexer, style };
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

function fmtMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
