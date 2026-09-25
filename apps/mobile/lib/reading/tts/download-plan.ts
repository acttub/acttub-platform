/**
 * 모델 파일 하나를 어떻게 받을지 정하는 규칙 (SOMA-494). 파일 시스템 없이 시험한다.
 *
 * 받는 중에는 `<이름>.part` 에 쓰고, 크기가 맞을 때만 제자리로 옮긴다 — 끊긴 파일이 완성본으로 보이지 않게.
 *
 * 이어받기는 플랫폼마다 다르다(expo-file-system/legacy DownloadResumable).
 * - Android: 받는 대로 .part 에 바로 쓰고, resumeData 는 "이미 받은 바이트 수"다(Range 요청). 그래서 앱이 죽어도
 *   남은 .part 크기로 이어받을 수 있다.
 * - iOS: 끝나기 전엔 .part 가 생기지 않고, resumeData 는 NSURLSession 이 주는 불투명한 값이다. 앱이 배경으로 갈
 *   때 멈추며 받아 둔 값이 있어야만 이어받는다. 없으면 처음부터.
 */

export type ModelDownloadPlan =
  | { action: 'finalize' }
  | { action: 'download'; resumeData: string | null; discardPart: boolean };

export function planModelDownload(input: {
  platform: string;
  expectedBytes: number;
  /** .part 가 없으면 null */
  partBytes: number | null;
  savedResumeData: string | null;
}): ModelDownloadPlan {
  const { platform, expectedBytes, partBytes, savedResumeData } = input;
  if (partBytes !== null && partBytes === expectedBytes) return { action: 'finalize' };
  if (partBytes !== null && partBytes > expectedBytes) return { action: 'download', resumeData: null, discardPart: true };
  if (platform === 'android') {
    if (partBytes !== null && partBytes > 0) return { action: 'download', resumeData: String(partBytes), discardPart: false };
    return { action: 'download', resumeData: null, discardPart: partBytes !== null };
  }
  // iOS 등: 불투명한 이어받기 값만 믿는다. 어중간한 .part 는 이어 붙일 수 없다.
  return { action: 'download', resumeData: savedResumeData || null, discardPart: partBytes !== null };
}

export type DownloadCheck = 'ok' | 'short' | 'corrupt';

/**
 * 받고 난 .part 검사. 오류 응답이거나 크기가 넘치면(서버가 Range 를 무시하고 처음부터 보내 덧붙은 경우) 버린다.
 * 모자라면 이어받을 수 있다.
 */
export function checkDownloaded(input: { expectedBytes: number; actualBytes: number; status: number }): DownloadCheck {
  if (input.status >= 400) return 'corrupt';
  if (input.actualBytes > input.expectedBytes) return 'corrupt';
  if (input.actualBytes === input.expectedBytes) return 'ok';
  return 'short';
}

/** 받는 동안 다른 앱·OS 가 쓸 여유분. */
export const SPACE_MARGIN_BYTES = 50 * 1024 * 1024;

export function hasEnoughSpace(input: { freeBytes: number | null; neededBytes: number }): boolean {
  if (input.neededBytes <= 0) return true;
  if (input.freeBytes === null || !Number.isFinite(input.freeBytes)) return true; // 모르면 막지 않는다
  return input.freeBytes >= input.neededBytes + SPACE_MARGIN_BYTES;
}

/** 아직 받아야 할 바이트. 이미 있는 파일·조각만큼 뺀다. */
export function missingBytes(files: readonly { expectedBytes: number; presentBytes: number }[]): number {
  return files.reduce((sum, f) => sum + Math.max(0, f.expectedBytes - Math.max(0, f.presentBytes)), 0);
}
