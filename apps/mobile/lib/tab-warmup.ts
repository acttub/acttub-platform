/**
 * 홈이 뜬 뒤 나머지 탭 화면을 뒤에서 미리 만들어 둔다 — 탭을 처음 눌러도 두 번째처럼 바로 뜨게.
 *
 * 하단 탭은 기본값이 「처음 누를 때 그 자리에서 화면을 만든다」(react-navigation lazy)라서, 앱을 켜고 처음 들어가는
 * 탭만 늦게 떴다(11/2 사용자 지적 「처음 들어갈 때만 느리다」). 큰 앱들처럼 앱을 연 뒤 다음 화면을 미리 만들어 둔다.
 * 앱을 켜는 순간 한꺼번에 만들면 홈이 느려지므로, 홈이 다 그려진 뒤 하나씩 간격을 두고 만든다.
 *
 * 커뮤니티는 홈이 받지 않는 챌린지 목록을 먼저 받아 둔 뒤 만든다 — 그래야 만들 때 받아 둔 목록으로 그린다(lib/last-reads).
 */
export type WarmTab = 'coaching' | 'reading' | 'challenges' | 'profile';

export const WARM_ORDER: readonly WarmTab[] = ['coaching', 'reading', 'challenges', 'profile'];
/** 홈이 뜬 뒤 첫 탭을 만들기까지, 그리고 탭 사이의 간격. 홈 첫 화면의 움직임·누름과 겹치지 않게 둔다. */
export const WARM_START_DELAY_MS = 600;
export const WARM_STEP_MS = 350;
/** 홈을 거치지 않고(알림 등으로) 다른 화면으로 들어왔을 때도 이만큼 지나면 만든다. */
export const WARM_FALLBACK_MS = 4000;
/** 미리 받을 목록이 늦어도 이 시간 뒤에는 그냥 만든다 — 그때는 탭을 열 때 받는다. */
export const WARM_PREFETCH_WAIT_MS = 2500;

export type WarmDeps = {
  /** 홈 첫 화면이 다 그려졌을 때 한 번 부른다. 이미 그려졌으면 바로 부른다. 해제 함수를 돌려준다. */
  onHomeReady: (listener: () => void) => () => void;
  /** 화면 움직임·누름 처리가 끝난 뒤에 부른다(InteractionManager). */
  afterInteractions: (task: () => void) => { cancel: () => void };
  wait: (ms: number, task: () => void) => () => void;
  /** 커뮤니티를 만들기 전에 받아 둘 목록. 실패해도 넘어간다. */
  prefetchCommunity: () => Promise<unknown>;
  warm: (tab: WarmTab) => void;
};

/** 순서대로 탭을 하나씩 만든다. 돌려준 함수로 남은 일정을 멈춘다(로그아웃·화면 닫힘). */
export function scheduleTabWarmup(deps: WarmDeps): () => void {
  let stopped = false;
  let started = false;
  const cancels: (() => void)[] = [];
  const later = (ms: number, task: () => void) => {
    cancels.push(deps.wait(ms, () => !stopped && task()));
  };

  const step = (index: number) => {
    if (stopped || index >= WARM_ORDER.length) return;
    const tab = WARM_ORDER[index];
    const run = () => {
      if (stopped) return;
      const handle = deps.afterInteractions(() => {
        if (stopped) return;
        deps.warm(tab);
        later(WARM_STEP_MS, () => step(index + 1));
      });
      cancels.push(handle.cancel);
    };
    if (tab !== 'challenges') return run();
    // 받기가 끝나거나 기다림 상한이 지나면, 둘 중 먼저 온 쪽에서 한 번만 만든다.
    let went = false;
    const go = () => {
      if (went) return;
      went = true;
      run();
    };
    void deps.prefetchCommunity().catch(() => undefined).then(() => !stopped && go());
    later(WARM_PREFETCH_WAIT_MS, go);
  };

  const start = () => {
    if (started || stopped) return;
    started = true;
    later(WARM_START_DELAY_MS, () => step(0));
  };
  cancels.push(deps.onHomeReady(start));
  later(WARM_FALLBACK_MS, start);

  return () => {
    stopped = true;
    cancels.forEach((cancel) => cancel());
  };
}
