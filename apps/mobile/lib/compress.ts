import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

export type CompressResult = {
  uri: string;
  /** 압축 전/후 바이트. 크기를 못 읽었거나 압축이 스킵되면 null. */
  originalBytes: number | null;
  compressedBytes: number | null;
};

/**
 * 업로드 목표 크기 — 업로드 속도·서버 부담을 줄이려 6MB로 잡는다.
 * (Gemini 토큰은 영상 '길이' 기반이라 파일 크기와 무관 — 파일 축소는 순전히 전송/서버용.
 *  토큰 절감은 서버 summarizer의 media_resolution=LOW가 담당.)
 */
const TARGET_BYTES = 6 * 1024 * 1024;
/** 오디오가 가져갈 몫 (AAC 기준 넉넉하게). */
const AUDIO_BPS = 64_000;
/** 표정·시선 축 분석에 필요한 최저 화질 하한. 긴(5분) 영상이 이 근처로 떨어진다. */
const MIN_VIDEO_BPS = 300_000;
/** 짧은 영상 상한 — 처리 속도를 위해 공격적으로 낮췄다(720p엔 이 정도면 충분). */
const MAX_VIDEO_BPS = 1_200_000;

async function fileSize(uri: string): Promise<number | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && typeof info.size === 'number' ? info.size : null;
  } catch {
    return null;
  }
}

/** 길이(초) 기준으로 목표 크기(TARGET_BYTES)에 들어오는 비디오 비트레이트(bps)를 계산한다. */
export function bitrateForDuration(durationSec: number): number {
  const totalBps = (TARGET_BYTES * 8) / durationSec;
  return Math.round(Math.min(MAX_VIDEO_BPS, Math.max(MIN_VIDEO_BPS, totalBps - AUDIO_BPS)));
}

/**
 * 업로드 전 영상 압축 (react-native-compressor).
 * 길이를 읽어 목표 크기(TARGET_BYTES, 최대 15MB·평균 8MB)에 맞는 비트레이트를 직접 지정한다(manual).
 * 길이를 못 읽으면 auto 모드(해상도 기준, 원본 대비 약 1/10)로 폴백.
 * maxSize 720: Gemini가 내부에서 768px로 다운샘플하므로 이보다 크면 처리 시간만 늘 뿐 품질 이득 없음.
 *
 * 네이티브 모듈이라 개발 빌드(EAS)에서만 동작 — Expo Go/웹에서는 원본을 그대로 반환한다.
 */
export async function compressVideo(
  uri: string,
  onProgress?: (percent: number) => void,
): Promise<CompressResult> {
  if (Platform.OS === 'web') return { uri, originalBytes: null, compressedBytes: null };
  try {
    const { Video, getVideoMetaData } = require('react-native-compressor');
    const originalBytes = await fileSize(uri);
    let durationSec: number | null = null;
    try {
      const meta = await getVideoMetaData(uri);
      durationSec = typeof meta?.duration === 'number' && meta.duration > 0 ? meta.duration : null;
    } catch {
      // 메타데이터 실패는 치명적이지 않음 — auto 모드로 폴백
    }
    const options =
      durationSec !== null
        ? {
            compressionMethod: 'manual' as const,
            bitrate: bitrateForDuration(durationSec),
            maxSize: 720,
            progressDivider: 5,
          }
        : { compressionMethod: 'auto' as const, maxSize: 720, progressDivider: 5 };
    const compressed: string = await Video.compress(uri, options, (progress: number) =>
      onProgress?.(Math.round(progress * 100)),
    );
    const compressedBytes = await fileSize(compressed);
    return { uri: compressed, originalBytes, compressedBytes };
  } catch {
    // Expo Go 등 네이티브 모듈이 없는 환경 — 압축 없이 원본 업로드
    return { uri, originalBytes: null, compressedBytes: null };
  }
}

export function formatSizeChange(result: CompressResult): string | null {
  const { originalBytes: o, compressedBytes: c } = result;
  if (!o || !c || result.uri === '' || c >= o) return null;
  const mb = (b: number) => (b / (1024 * 1024)).toFixed(b >= 100 * 1024 * 1024 ? 0 : 1);
  const savedPct = Math.round((1 - c / o) * 100);
  return `영상 크기 ${mb(o)}MB → ${mb(c)}MB (${savedPct}% 감소)`;
}
