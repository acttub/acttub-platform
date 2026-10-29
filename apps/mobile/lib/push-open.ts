/**
 * 푸시를 눌러 앱을 연 것을 서버(POST /v2/push-opens)에 남긴다(account.notification).
 * 보낸 기록과 이어 "푸시로 돌아온 사람"을 재는 측정이라 앱 동작을 막거나 바꾸지 않는다.
 *
 * - 같은 알림 식별자는 한 번만 센다(콜드 스타트 조회와 리스너가 같은 탭을 둘 다 알려 줄 수 있다).
 * - 탭이 로그인보다 먼저 올 수 있어, 로그인한 회원이 생길 때까지 메모리에 들고 있다가 보낸다.
 * - 보내기는 기다리지 않는다. 실패는 삼키고, 한 번만 다시 보낸다.
 *
 * 네이티브 모듈 없이 성립하는 부분만 여기 산다(notifications.ts 가 API 를 넣어 쓴다).
 */
export type PushOpenRecord = {
  kind: string;
  reminder_kind?: string;
  template_id?: string;
};

export type PushOpenBody = PushOpenRecord & { platform: 'ios' | 'android' };

/** 서버 한도(kind 40, reminder_kind 40, template_id 60). */
const LIMITS = { kind: 40, reminder_kind: 40, template_id: 60 } as const;
/** 로그인을 기다리는 동안 들고 있는 최대 개수. 넘치면 오래된 것부터 버린다. */
const MAX_PENDING = 5;

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, max).trim();
  return trimmed ? trimmed : undefined;
}

/** 푸시 data 에서 남길 값만 뽑는다. data 가 객체가 아니면 null(남기지 않는다). */
export function pushOpenRecord(data: unknown): PushOpenRecord | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  const record: PushOpenRecord = { kind: text(d.kind, LIMITS.kind) ?? 'unknown' };
  const reminderKind = text(d.reminder_kind, LIMITS.reminder_kind);
  const templateId = text(d.template_id, LIMITS.template_id);
  if (reminderKind) record.reminder_kind = reminderKind;
  if (templateId) record.template_id = templateId;
  return record;
}

export type PushOpenRecorder = {
  /** 탭 하나를 알린다. identifier 가 있으면 같은 것은 한 번만 센다. */
  capture(identifier: string | null | undefined, data: unknown): void;
  /** 로그인한 회원이 있으면 true, 없으면 false. 켜지는 순간 밀린 것을 보낸다. */
  setSignedIn(signedIn: boolean): void;
};

export function createPushOpenRecorder(deps: {
  send: (body: PushOpenBody) => Promise<unknown>;
  platform: () => 'ios' | 'android' | null;
}): PushOpenRecorder {
  const seen = new Set<string>();
  const pending: PushOpenRecord[] = [];
  let signedIn = false;

  const fire = (record: PushOpenRecord): void => {
    const platform = deps.platform();
    const body: PushOpenBody = platform ? { ...record, platform } : (record as PushOpenBody);
    // 기다리지 않는다. 한 번 실패하면 한 번만 다시 보내고, 그래도 안 되면 버린다.
    void (async () => {
      try {
        await deps.send(body);
      } catch {
        try {
          await deps.send(body);
        } catch {
          // 측정이라 삼킨다.
        }
      }
    })();
  };

  const flush = (): void => {
    while (signedIn && pending.length > 0) fire(pending.shift()!);
  };

  return {
    capture(identifier, data) {
      if (identifier) {
        if (seen.has(identifier)) return;
        seen.add(identifier);
      }
      const record = pushOpenRecord(data);
      if (!record) return;
      pending.push(record);
      while (pending.length > MAX_PENDING) pending.shift();
      flush();
    },
    setSignedIn(next) {
      signedIn = next;
      flush();
    },
  };
}
