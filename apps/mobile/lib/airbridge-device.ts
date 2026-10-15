/**
 * 서버 재조회용 Airbridge 기기 ID 전달(SOMA-643).
 *
 * SDK 귀속 콜백이 오지 않는 설치(가입 계정의 약 14%)를 서버가 Airbridge 에서 다시 가져올 수 있게, 이 기기에서 새로
 * 가입한 계정에만 기기 ID(안드로이드 GAID, iOS IDFA/IDFV)를 서버로 **한 번** 넘긴다(`PUT /v2/me/airbridge-device`).
 * 서버는 귀속을 적거나 24시간이 지나면 이 ID 를 지운다. 앱은 ID 를 저장하지 않는다 — 보낼 때마다 SDK 에서 읽는다.
 * 저장하는 것은 "어느 계정이 언제 가입했고 보냈는가" 뿐이다.
 *
 * ⚠️ 이 파일은 CI(`node --test tests/*.test.mjs`)에서 타입 스트리핑으로 그대로 import된다. 최상위에
 * react-native·expo·SDK 모듈을 import하지 않는다 — 저장소·SDK·전송은 주입받는다(lib/signup-attribution-runtime.ts).
 */

export type AirbridgeDevicePayload = {
  platform: 'ios' | 'android';
  device_uuid: string;
};

export type AirbridgeDeviceState = {
  /** 이 기기에서 가입을 마친 첫 계정. 이 계정만 보낸다. */
  signupUserId: string | null;
  /** 가입을 마친 시각(ms). 서버가 24시간 뒤 지우므로 그 뒤에는 보내지 않는다. */
  signedUpAt: number | null;
  /** 서버가 받았다(또는 다시 보내도 소용없어 포기했다). */
  done: boolean;
  /** 기기 ID 를 SDK 에서 못 읽은 횟수. 한도를 넘으면 포기한다. */
  fetchFailures: number;
};

export const EMPTY_AIRBRIDGE_DEVICE_STATE: AirbridgeDeviceState = {
  signupUserId: null,
  signedUpAt: null,
  done: false,
  fetchFailures: 0,
};

export const AIRBRIDGE_DEVICE_STORAGE_KEY = 'acttub.airbridgeDevice.v1';

/** 서버가 기기 ID 를 들고 있는 기간(24시간)과 같다. 그 뒤에는 서버가 어차피 지운다. */
export const AIRBRIDGE_DEVICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** SDK 에서 ID 를 못 읽는 시도의 한도. 광고 추적 제한·SDK 미초기화처럼 계속 안 되는 기기를 붙잡지 않는다. */
export const AIRBRIDGE_DEVICE_MAX_FETCH_FAILURES = 5;

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

/** 서버가 받는 모양인가 — 36자 UUID 이고 모두 0 이 아니다(광고 추적 제한이면 0 으로 채워진다). */
export function isUsableAirbridgeDeviceId(value: unknown): value is string {
  return typeof value === 'string' && UUID_FORMAT.test(value) && value !== ZERO_UUID;
}

export function parseAirbridgeDeviceState(raw: string | null): AirbridgeDeviceState {
  if (!raw) return EMPTY_AIRBRIDGE_DEVICE_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<AirbridgeDeviceState>;
    return {
      signupUserId: typeof parsed.signupUserId === 'string' ? parsed.signupUserId : null,
      signedUpAt: typeof parsed.signedUpAt === 'number' ? parsed.signedUpAt : null,
      done: parsed.done === true,
      fetchFailures: typeof parsed.fetchFailures === 'number' ? parsed.fetchFailures : 0,
    };
  } catch {
    return EMPTY_AIRBRIDGE_DEVICE_STATE;
  }
}

/** 이 기기에서 가입을 마친 첫 계정만 남긴다 — 같은 폰으로 두 번째 계정을 만들어도 설치는 첫 계정의 것이다. */
export function withAirbridgeSignup(
  state: AirbridgeDeviceState,
  userId: string,
  now: number,
): AirbridgeDeviceState {
  return state.signupUserId ? state : { ...state, signupUserId: userId, signedUpAt: now };
}

export function shouldSendAirbridgeDevice(
  state: AirbridgeDeviceState,
  currentUserId: string | null,
  now: number,
): boolean {
  return (
    !state.done &&
    state.signupUserId !== null &&
    state.signedUpAt !== null &&
    currentUserId !== null &&
    currentUserId === state.signupUserId &&
    now - state.signedUpAt <= AIRBRIDGE_DEVICE_MAX_AGE_MS &&
    state.fetchFailures < AIRBRIDGE_DEVICE_MAX_FETCH_FAILURES
  );
}

export type AirbridgeDeviceStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

/**
 * 가입·로그인한 계정이 어떤 순서로 와도, 갖춰지는 때에 한 번만 보낸다. `fetchDevice` 가 `null` 이나 쓸 수 없는 값을
 * 돌려주면(SDK 없음·추적 제한) 실패로 세고 다음 기회(`accountResolved`·`retry`)에 다시 읽는다.
 * `send` 가 던지면 보내지 못한 것으로 두고 `onSendFailed` 로 알린다. 다시 보내도 소용없는 거절(422)은 `send` 가
 * 삼키고 끝내면 된다 — 그때도 끝난 것으로 적는다.
 */
export function createAirbridgeDeviceTracker(deps: {
  storage: AirbridgeDeviceStorage;
  fetchDevice: () => Promise<string | null>;
  send: (payload: AirbridgeDevicePayload) => Promise<void>;
  platform: string;
  now?: () => number;
  onSendFailed?: () => void;
}) {
  let currentUserId: string | null = null;
  let chain: Promise<void> = Promise.resolve();
  const now = deps.now ?? (() => Date.now());

  function serial(task: () => Promise<void>): Promise<void> {
    const next = chain.then(task).catch(() => undefined);
    chain = next;
    return next;
  }

  async function load(): Promise<AirbridgeDeviceState> {
    return parseAirbridgeDeviceState(await deps.storage.getItem(AIRBRIDGE_DEVICE_STORAGE_KEY));
  }

  async function save(state: AirbridgeDeviceState): Promise<void> {
    await deps.storage.setItem(AIRBRIDGE_DEVICE_STORAGE_KEY, JSON.stringify(state));
  }

  async function readDevice(): Promise<string | null> {
    try {
      const value = await deps.fetchDevice();
      return isUsableAirbridgeDeviceId(value) ? value : null;
    } catch {
      return null;
    }
  }

  async function flush(state: AirbridgeDeviceState): Promise<void> {
    if (deps.platform !== 'ios' && deps.platform !== 'android') return;
    if (!shouldSendAirbridgeDevice(state, currentUserId, now())) return;
    const device = await readDevice();
    if (!device) {
      await save({ ...state, fetchFailures: state.fetchFailures + 1 });
      return;
    }
    try {
      await deps.send({ platform: deps.platform, device_uuid: device });
    } catch (error) {
      deps.onSendFailed?.();
      throw error;
    }
    await save({ ...state, done: true });
  }

  return {
    /** 이 기기에서 가입(프로필 입력)을 마쳤다. */
    signedUp(userId: string): Promise<void> {
      return serial(async () => {
        currentUserId = userId;
        const before = await load();
        const after = withAirbridgeSignup(before, userId, now());
        if (after !== before) await save(after);
        await flush(after);
      });
    },
    /** 로그인한 계정을 확인했다(로그아웃이면 `null`). */
    accountResolved(userId: string | null): Promise<void> {
      return serial(async () => {
        currentUserId = userId;
        await flush(await load());
      });
    },
    /** 보내지 못한 것이 있으면 지금 로그인한 계정으로 다시 보낸다. 보낼 것이 없으면 아무것도 안 한다. */
    retry(): Promise<void> {
      return serial(async () => flush(await load()));
    },
  };
}
