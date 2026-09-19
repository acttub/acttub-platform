/**
 * 저녁 리마인드 알람을 맞추고 취소하는 순서(account.notification · account.logout).
 *
 * 맞추기와 취소를 한 줄로 세워 서로 끼어들지 않게 한다. 30일치를 맞추는 도중에 로그아웃이
 * 오면 맞추기가 멈추고 그때까지의 예약 id 를 적어 둔 뒤, 줄 뒤에 선 취소가 전부 걷는다 —
 * 취소가 마지막에 끝나야 로그아웃 뒤 예약된 알람이 0개다.
 *
 * 네이티브 모듈 없이 성립하는 부분만 여기 산다(notifications.ts 가 저장소와 예약 함수를 넣어 쓴다).
 */
import { nudgeFireDates, practicedToday, type NotificationSettings } from './push-policy.ts';

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
export const LAST_PRACTICE_KEY = 'acttub.push.lastPracticeDay';

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

  async function scheduleWindow(isCurrent: IsCurrent): Promise<void> {
    const current = now();
    const last = await storage.getItem(LAST_PRACTICE_KEY);
    const dates = nudgeFireDates(current, practicedToday(last, current));
    const ids: string[] = [];
    try {
      for (const date of dates) {
        if (!isCurrent()) return;
        ids.push(await scheduler.schedule(date));
      }
    } finally {
      // 도중에 멈추거나 실패해도 그때까지 맞춘 알람의 id 를 적어 둔다 — 다음 취소가 찾아 걷는다.
      if (ids.length > 0) await storage.setItem(NUDGE_IDS_KEY, JSON.stringify(ids));
    }
  }

  return {
    /**
     * 저녁 리마인드를 현재 상태에 맞게 다시 깐다. 게이트 통과·앱 열기·연습 완료·토글에서 부른다.
     * 반복 트리거로는 "오늘만 건너뛰기" 가 안 되어 앞으로 30일치를 낱개로 예약한다.
     */
    sync(settings: NotificationSettings, isCurrent: IsCurrent = () => true): Promise<void> {
      return enqueue(async () => {
        if (!isCurrent()) return;
        try {
          if (!settings.evening_reminder) {
            await cancelEverything();
            return;
          }
          await cancelStored();
          await scheduleWindow(isCurrent);
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
