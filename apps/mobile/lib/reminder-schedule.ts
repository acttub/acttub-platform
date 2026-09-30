/**
 * 저녁 리마인드 알람을 맞추고 취소하는 순서(account.notification · account.logout).
 *
 * 업데이트 전에 남긴 로컬 예약과 로그아웃 취소를 한 줄로 세워 모두 걷는다.
 *
 * 네이티브 모듈 없이 성립하는 부분만 여기 산다(notifications.ts 가 저장소와 예약 함수를 넣어 쓴다).
 */
import type { NotificationSettings } from './push-policy.ts';

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type ReminderScheduler = {
  /** 알람 하나를 맞추고 예약 id 를 돌려준다. */
  schedule: (date: Date) => Promise<string>;
  cancel: (id: string) => Promise<void>;
  /** 이 앱이 예약한 로컬 알림을 전부 취소한다. 이 앱이 예약하는 로컬 알림은 리마인드뿐이다. */
  cancelAll: () => Promise<void>;
};

/** 'acttub.' 접두사 — 탈퇴 시 local-account-data 가 이 접두사를 통째로 지운다. */
export const NUDGE_IDS_KEY = 'acttub.push.nudgeIds';

/** 이 계정이 아직 이 기기에 있는가. 로그아웃·탈퇴가 시작되면 거짓이 된다(notification-sync). */
export type IsCurrent = () => boolean;

export function createReminderSchedule(dependencies: {
  storage: Storage;
  scheduler: ReminderScheduler;
  now: () => Date;
}) {
  const { storage, scheduler, now } = dependencies;
  let tail: Promise<unknown> = Promise.resolve();

  /** 앞선 동작이 끝난 뒤에 돈다. 앞이 실패했어도 뒤는 간다. */
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  }

  async function cancelStored(): Promise<void> {
    const raw = await storage.getItem(NUDGE_IDS_KEY);
    if (!raw) return;
    await storage.removeItem(NUDGE_IDS_KEY);
    let ids: string[] = [];
    try {
      ids = JSON.parse(raw) as string[];
    } catch {
      // 깨진 저장소 — 예약 id 를 잃었다. 이 앱이 예약하는 로컬 알림은 리마인드뿐이라 전부 취소한다.
      await scheduler.cancelAll().catch(() => undefined);
      return;
    }
    for (const id of ids) {
      try {
        await scheduler.cancel(id);
      } catch {
        // 이미 울렸거나 없는 예약 — 무시.
      }
    }
  }

  /** id 로 취소한 뒤 전부 취소를 한 번 더 부른다 — 앱이 맞추는 도중에 죽어 id 를 적지 못한 알람까지 걷는다. */
  async function cancelEverything(): Promise<void> {
    await cancelStored().catch(() => undefined);
    await scheduler.cancelAll();
  }

  return {
    /**
     * 게이트 통과·앱 열기·토글에서 부르며, 옛 앱이 남긴 로컬 리마인드를 취소만 한다.
     */
    sync(settings: NotificationSettings, isCurrent: IsCurrent = () => true): Promise<void> {
      return enqueue(async () => {
        if (!isCurrent()) return;
        try {
          void settings;
          void now;
          await cancelEverything();
        } catch {
          // 리마인드는 부가 기능 — 실패해도 흐름을 막지 않는다.
        }
      });
    },

    /**
     * 예약된 리마인드를 전부 취소한다. 로그아웃·탈퇴·세션 끊김에서 부른다. 앞서 돌던 맞추기가
     * 멈춘 뒤에 돈다.
     */
    cancelAll(): Promise<void> {
      return enqueue(cancelEverything);
    },
  };
}
