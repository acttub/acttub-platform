import { File, Paths } from 'expo-file-system';

import { api } from '@/lib/api';
import { createExampleAudioLoader, exampleAudioFileName, type ExampleAudio } from '@/lib/reading/example-audio';

/** 앱 전체가 나눠 쓰는 예시 음성 기억(대본마다). */
const loader = createExampleAudioLoader((scriptId) => api.getExampleAudio(scriptId));

export function loadExampleAudio(scriptId: string, options: { fresh?: boolean } = {}): Promise<ExampleAudio | null> {
  return loader.load(scriptId, options);
}

export function cachedExampleAudio(scriptId: string): ExampleAudio | null | undefined {
  return loader.cached(scriptId);
}

/** 한 줄을 받는 데 이보다 오래 걸리면 그 줄은 기기 목소리로 읽는다 — 재생이 끝없이 매달리지 않게. */
const DOWNLOAD_TIMEOUT_MS = 15_000;
const inFlight = new Map<string, Promise<string>>();

/**
 * 예시 음성 한 줄의 기기 파일. 받아 둔 게 있으면 그대로, 아니면 임시 주소에서 캐시 폴더로 받는다. 스트리밍 대신 받는 것은
 * 실패를 바로 알아 기기 목소리로 넘어가기 위해서다(스트리밍은 끊기면 재생 끝 신호가 오지 않을 수 있다).
 */
export function exampleLineUri(audio: ExampleAudio, lineId: string): Promise<string> {
  const line = audio.lines.get(lineId);
  if (!line) return Promise.reject(new Error('no example audio for line'));
  const out = new File(Paths.cache, exampleAudioFileName(audio.exampleId, lineId, line.url));
  if (out.exists) return Promise.resolve(out.uri);
  const already = inFlight.get(out.uri);
  if (already) return already;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const work = Promise.race([
    File.downloadFileAsync(line.url, out).then(() => out.uri),
    new Promise<string>((_, reject) => {
      timer = setTimeout(() => reject(new Error('example audio timeout')), DOWNLOAD_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
    inFlight.delete(out.uri);
  });
  inFlight.set(out.uri, work);
  return work;
}

/** 앞으로 읽을 줄을 차례로 미리 받아 둔다(실패는 무시 — 그 줄 차례에 다시 받거나 기기 목소리로 읽는다). */
export async function prefetchExampleLines(audio: ExampleAudio, lineIds: readonly string[], isCancelled: () => boolean = () => false): Promise<void> {
  for (const id of lineIds) {
    if (isCancelled()) return;
    if (!audio.lines.has(id)) continue;
    await exampleLineUri(audio, id).catch(() => undefined);
  }
}
