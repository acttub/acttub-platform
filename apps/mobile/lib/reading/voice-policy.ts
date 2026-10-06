/**
 * 상대역 목소리 모델(Supertonic 3, 약 380MB)의 내려받기 규칙(reading.cast). 처음 한 번 기기에 내려받고,
 * 앱은 Wi-Fi 가 아니면 용량을 보여 주고 확인을 받는다(R9.4). 받지 않으면 그 회차는 기기 기본 목소리로 읽는다.
 */
export type NetworkType = 'wifi' | 'cellular' | 'none' | 'unknown';

export type DownloadPrompt = { ask: false } | { ask: true; sizeLabel: string };

export function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function modelDownloadPrompt(input: { assetsPresent: boolean; networkType: NetworkType; bytes: number }): DownloadPrompt {
  if (input.assetsPresent) return { ask: false };
  if (input.networkType === 'wifi') return { ask: false };
  return { ask: true, sizeLabel: formatMegabytes(input.bytes) };
}
