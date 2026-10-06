/**
 * 가입 계정의 유입 광고(SOMA-588).
 *
 * Airbridge SDK 가 알려주는 설치 귀속 결과(채널·캠페인·광고 세트·소재)를 기기에 한 번 적어 두었다가,
 * **이 기기에서 새로 가입한 계정**에만 한 번 서버로 보낸다(`PUT /v2/me/signup-attribution`). 서버도 계정마다
 * 처음 온 값만 남기지만, 기존 회원이 앱을 업데이트해 SDK 가 처음 돌 때의 귀속까지 보내지 않도록 앱이 먼저
 * 거른다 — 가입을 이 기기에서 마친 계정(`signupUserId`)과 지금 로그인한 계정이 같을 때만 보낸다.
 *
 * 광고 식별자(IDFA·GAID)는 싣지 않는다. 귀속 결과 가운데 광고를 가리키는 이름만 옮긴다.
 *
 * ⚠️ 이 파일은 CI(`node --test tests/*.test.mjs`)에서 타입 스트리핑으로 그대로 import된다. 최상위에
 * react-native·expo·SDK 모듈을 import하지 않는다 — 저장소와 전송은 주입받는다(lib/signup-attribution-runtime.ts).
 */

export type SignupAttributionPayload = {
  source: 'airbridge';
  platform: 'ios' | 'android';
  channel: string;
  campaign?: string;
  ad_group?: string;
  ad_creative?: string;
  content?: string;
  term?: string;
  sub_publisher?: string;
};

export type SignupAttributionState = {
  /** 처음 받은 귀속 결과. 뒤에 다시 와도 바꾸지 않는다. */
  attribution: SignupAttributionPayload | null;
  /** 이 기기에서 가입(프로필 입력)을 마친 첫 계정. 이 계정에만 보낸다. */
  signupUserId: string | null;
  /** 서버가 받았다(또는 다시 보내도 소용없는 거절이었다). */
  sent: boolean;
};

export const EMPTY_SIGNUP_ATTRIBUTION_STATE: SignupAttributionState = {
  attribution: null,
  signupUserId: null,
  sent: false,
};

export const SIGNUP_ATTRIBUTION_STORAGE_KEY = 'acttub.signupAttribution.v1';

/** 서버의 값 하나 최대 글자 수(SignupAttribution.MAX_LENGTH)와 같다. */
const MAX_LENGTH = 200;

const OPTIONAL_FIELDS = [
  ['attributedCampaign', 'campaign'],
  ['attributedAdGroup', 'ad_group'],
  ['attributedAdCreative', 'ad_creative'],
  ['attributedContent', 'content'],
  ['attributedTerm', 'term'],
  ['attributedSubPublisher', 'sub_publisher'],
] as const;

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const chars = Array.from(trimmed);
  return chars.length > MAX_LENGTH ? chars.slice(0, MAX_LENGTH).join('').trim() : trimmed;
}

/**
 * Airbridge 의 `setOnAttributionReceived` 결과를 서버 본문으로 옮긴다. 채널이 없으면 쓸 것이 없어 `null`.
 * 광고 없이 들어온 설치는 Airbridge 가 `attributedChannel: "unattributed"` 로 알리고, 그것도 그대로 적는다.
 */
export function toSignupAttribution(
  raw: unknown,
  platform: string,
): SignupAttributionPayload | null {
  if (platform !== 'ios' && platform !== 'android') return null;
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const channel = clean(record.attributedChannel);
  if (!channel) return null;
  const payload: SignupAttributionPayload = { source: 'airbridge', platform, channel };
  for (const [from, to] of OPTIONAL_FIELDS) {
    const value = clean(record[from]);
    if (value) payload[to] = value;
  }
  return payload;
}

export function parseSignupAttributionState(raw: string | null): SignupAttributionState {
  if (!raw) return EMPTY_SIGNUP_ATTRIBUTION_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<SignupAttributionState>;
    return {
      attribution: parsed.attribution && typeof parsed.attribution === 'object' ? parsed.attribution : null,
      signupUserId: typeof parsed.signupUserId === 'string' ? parsed.signupUserId : null,
      sent: parsed.sent === true,
    };
  } catch {
    return EMPTY_SIGNUP_ATTRIBUTION_STATE;
  }
}

/** 처음 받은 귀속만 남긴다. */
export function withAttribution(
  state: SignupAttributionState,
  attribution: SignupAttributionPayload,
): SignupAttributionState {
  return state.attribution ? state : { ...state, attribution };
}

/** 이 기기에서 가입을 마친 첫 계정만 남긴다 — 같은 폰으로 두 번째 계정을 만들어도 설치 귀속은 첫 계정의 것이다. */
export function withSignup(state: SignupAttributionState, userId: string): SignupAttributionState {
  return state.signupUserId ? state : { ...state, signupUserId: userId };
}

export function shouldSendSignupAttribution(
  state: SignupAttributionState,
  currentUserId: string | null,
): boolean {
  return (
    !state.sent &&
    state.attribution !== null &&
    state.signupUserId !== null &&
    currentUserId !== null &&
    currentUserId === state.signupUserId
  );
}

export type SignupAttributionStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

/**
 * 귀속 결과·가입·로그인한 계정 셋이 어떤 순서로 와도, 모두 갖춰지는 때에 한 번만 보낸다. 셋은 따로 온다 —
 * 귀속은 SDK 초기화 뒤 1~5분 안에, 가입은 사람이 프로필을 마칠 때, 계정은 앱을 열 때마다 온다.
 *
 * `send` 가 던지면 보내지 못한 것으로 두고 다음 기회(다음 계정 확인·앱 실행)에 다시 보낸다.
 * 다시 보내도 소용없는 거절은 `send` 가 삼키고 끝내면 된다 — 그때도 보낸 것으로 적는다.
 */
export function createSignupAttributionTracker(deps: {
  storage: SignupAttributionStorage;
  send: (payload: SignupAttributionPayload) => Promise<void>;
}) {
  let currentUserId: string | null = null;
  let chain: Promise<void> = Promise.resolve();

  function serial(task: () => Promise<void>): Promise<void> {
    const next = chain.then(task).catch(() => undefined);
    chain = next;
    return next;
  }

  async function load(): Promise<SignupAttributionState> {
    return parseSignupAttributionState(await deps.storage.getItem(SIGNUP_ATTRIBUTION_STORAGE_KEY));
  }

  async function save(state: SignupAttributionState): Promise<void> {
    await deps.storage.setItem(SIGNUP_ATTRIBUTION_STORAGE_KEY, JSON.stringify(state));
  }

  async function update(
    change: (state: SignupAttributionState) => SignupAttributionState,
  ): Promise<SignupAttributionState> {
    const before = await load();
    const after = change(before);
    if (after !== before) await save(after);
    return after;
  }

  async function flush(state: SignupAttributionState): Promise<void> {
    if (!shouldSendSignupAttribution(state, currentUserId) || !state.attribution) return;
    await deps.send(state.attribution);
    await save({ ...state, sent: true });
  }

  return {
    /** SDK 가 귀속 결과를 알렸다. */
    received(attribution: SignupAttributionPayload): Promise<void> {
      return serial(async () => flush(await update((state) => withAttribution(state, attribution))));
    },
    /** 이 기기에서 가입(프로필 입력)을 마쳤다. */
    signedUp(userId: string): Promise<void> {
      return serial(async () => {
        currentUserId = userId;
        await flush(await update((state) => withSignup(state, userId)));
      });
    },
    /** 로그인한 계정을 확인했다(로그아웃이면 `null`). */
    accountResolved(userId: string | null): Promise<void> {
      return serial(async () => {
        currentUserId = userId;
        await flush(await load());
      });
    },
  };
}
