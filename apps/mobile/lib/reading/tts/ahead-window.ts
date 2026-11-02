/**
 * 고품질 목소리로 미리 만들 상대 대사 창 (SOMA-1000).
 *
 * <p>리딩을 시작하면 구간 끝까지 상대 대사를 쉬지 않고 만들어서, 금방 나가도 수백 줄이 만들어지고 버려졌다(운영 11/1~11/2:
 * 3분 리딩에 217줄). 고품질 목소리는 줄마다 돈이 드므로 지금 줄부터 몇 줄만 만든다 — 줄이 바뀔 때마다 다시 고르므로 창이
 * 따라간다. 새 줄은 서버에서 중간값 2.5초에 만들어지고 한 줄 재생은 5~6초라 5줄이면 넉넉하다.
 *
 * <p>폰 안의 앱 목소리는 돈이 들지 않으므로 그대로 둔다.
 */
export const CLOUD_AHEAD_LINES = 5;

/** 지금 줄부터 고른 상대 대사 중 미리 만들 줄. 고품질 목소리면 앞 {@link CLOUD_AHEAD_LINES}줄, 아니면 전부. */
export function aheadWindow<T>(partnerLines: readonly T[], cloud: boolean): T[] {
  return cloud ? partnerLines.slice(0, CLOUD_AHEAD_LINES) : [...partnerLines];
}
