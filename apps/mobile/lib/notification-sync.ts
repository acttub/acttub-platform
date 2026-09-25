/**
 * 이 폰의 알림을 계정의 현재 상태에 맞추는 순서(account.notification · account.logout).
 *
 * - 게이트를 통과한 순간과 앱을 열 때(배경에서 돌아올 때 포함) 서버의 토글을 읽어 이 폰의 토큰
 *   등록과 리마인드 30일치를 다시 맞춘다.
 * - 계정이 이 기기를 떠나면(로그아웃·탈퇴·세션 끊김) 계정 세대를 올린다. 그 전에 시작한 동기화는
 *   단계 사이마다 세대를 확인하고 멈춘다 — 늦게 돌아온 설정 조회가 로그아웃 뒤에 토큰을 다시
 *   등록하거나 알람을 다시 만들지 않는다. 다음 게이트 통과 전까지는 새 동기화도 시작하지 않는다.
 *
 * 네이티브 모듈 없이 성립하는 부분만 여기 산다(notifications.ts 가 실제 호출을 넣어 쓴다).
 */
import { wantsServerPush, type NotificationSettings } from './push-policy.ts';
import type { IsCurrent } from './reminder-schedule.ts';

/**
 * 배경 복귀 때 다시 맞추는 최소 간격. 권한 창·공유 시트·사진 고르기처럼 잠깐 나갔다 오는
 * 것마다 서버를 부르고 알람 30개를 다시 깔지 않는다.
 */
export const FOREGROUND_SYNC_MIN_INTERVAL_MS = 5 * 60_000;

export type NotificationSyncDependencies = {
  /** 서버의 토글 셋을 읽는다. 계정이 떠난 뒤에는 읽은 값을 기기에 적지 않는다. */
  loadSettings: (isCurrent: IsCurrent) => Promise<NotificationSettings>;
  cachedSettings: () => Promise<NotificationSettings>;
  /** 배경 복귀 때는 알림 권한을 새로 묻지 않는다(askPermission=false). */
  registerDevice: (options: { askPermission: boolean; isCurrent: IsCurrent }) => Promise<void>;
  forgetToken: () => Promise<void>;
  /** 로그아웃 때 지우지 못한 푸시 토큰을 다시 보낸다. 로그인 여부와 무관하다. */
  flushPendingDeletions: () => Promise<void>;
  reminders: {
    sync: (settings: NotificationSettings, isCurrent: IsCurrent) => Promise<void>;
    cancelAll: () => Promise<void>;
  };
  now: () => number;
};

export function createNotificationSync(dependencies: NotificationSyncDependencies) {
  const {
    loadSettings,
    cachedSettings,
    registerDevice,
    forgetToken,
    flushPendingDeletions,
    reminders,
    now,
  } = dependencies;
  /** 계정 세대. 계정이 이 기기를 떠날 때마다 오른다. */
  let generation = 0;
  /** 게이트를 통과한 계정이 이 기기에 있는 동안만 참이다. */
  let open = false;
  let lastSyncAt: number | null = null;

  function guard(): IsCurrent {
    const mine = generation;
    return () => open && mine === generation;
  }

  function invalidate(): void {
    generation += 1;
    open = false;
    lastSyncAt = null;
  }

  async function run(askPermission: boolean): Promise<void> {
    const isCurrent = guard();
    lastSyncAt = now();
    const settings = await loadSettings(isCurrent).catch(() => cachedSettings());
    if (!isCurrent()) return;
    if (wantsServerPush(settings)) await registerDevice({ askPermission, isCurrent });
    else await forgetToken();
    if (!isCurrent()) return;
    await reminders.sync(settings, isCurrent);
  }

  return {
    /** 게이트(동의 → 프로필)를 통과한 순간과, 게이트가 이미 끝난 회원이 앱을 켰을 때 부른다. */
    afterGate(): Promise<void> {
      open = true;
      return run(true);
    },

    /**
     * 앱이 배경에서 돌아왔을 때 부른다. 밀린 토큰 삭제는 로그인 없이도 다시 보내고, 게이트를
     * 통과한 계정이 있으면 최소 간격을 두고 다시 맞춘다.
     */
    async onForeground({ gatePassed }: { gatePassed: boolean }): Promise<void> {
      await flushPendingDeletions();
      if (!gatePassed || !open) return;
      if (lastSyncAt !== null && now() - lastSyncAt < FOREGROUND_SYNC_MIN_INTERVAL_MS) return;
      await run(false);
    },

    /**
     * 계정이 이 기기를 떠난다(로그아웃·탈퇴·세션 끊김). 진행 중인 동기화를 무효로 하고 리마인드를
     * 전부 취소한다. 취소는 멈춘 맞추기 뒤에 돌아 마지막에 끝난다.
     */
    leave(): Promise<void> {
      invalidate();
      return reminders.cancelAll();
    },

    /** 진행 중인 동기화만 무효로 한다. 로그아웃의 첫 단계(푸시 토큰 삭제)가 부른다. */
    invalidate,

    /** 연습 완료·토글처럼 동기화 밖에서 알람을 맞추는 흐름이 쓰는 확인. */
    guard,
  };
}
