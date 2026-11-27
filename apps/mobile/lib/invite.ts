import { errorCode, errorStatus } from './api-request.ts';
import { deviceStorage } from './device-storage.ts';
import { storeUrlFor } from './update-required.ts';

/**
 * 친구 초대(SOMA-865, account.invite) — 화면이 쓰는 값 규칙. 서버가 기능을 닫아 두었으면 `/v2/invite/me` 가 404 이고 앱은
 * 초대 칸을 그리지 않는다.
 */

/** `GET /v2/invite/me`·`POST /v2/invite/redeem` 응답. */
export type InviteMe = {
  code: string;
  can_redeem: boolean;
  redeem_until: string | null;
  redeemed: boolean;
  rewarded: boolean;
  reward_count: number;
};

/** 서버와 같은 글자 — 헷갈리는 0·O·1·I 를 뺀 대문자·숫자. */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 6;

/**
 * 입력 칸에 친 글을 코드 모양으로 다듬는다 — 대문자로 바꾸고, 띄어쓰기·하이픈과 코드에 없는 글자를 빼고, 6자리에서 자른다.
 * 서버도 같은 정리를 하므로 여기서 거른 글자가 서버에 가지 않을 뿐이다.
 */
export function cleanInviteCode(raw: string): string {
  let out = '';
  for (const ch of raw.toUpperCase()) {
    if (INVITE_CODE_ALPHABET.includes(ch)) out += ch;
    if (out.length === INVITE_CODE_LENGTH) break;
  }
  return out;
}

export function isInviteCode(code: string): boolean {
  return code.length === INVITE_CODE_LENGTH && cleanInviteCode(code) === code;
}

/** 딥링크(`actingapp://invite?code=XXXXXX`)의 code 값. 코드 모양이 아니면 null. */
export function inviteCodeFromParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const code = cleanInviteCode(raw);
  return isInviteCode(code) ? code : null;
}

/**
 * 공유 시트로 보낼 글. 받는 친구의 기기를 모르므로 두 스토어 주소를 다 싣는다(주소는 업데이트 안내와 같은 규칙,
 * lib/update-required). 모르는 주소는 빼고, 둘 다 모르면 주소 없이 보낸다.
 */
export function inviteShareMessage(input: {
  code: string;
  intro: string;
  reward: string;
  codeLine: string;
  androidPackage: string | undefined;
  iosAppStoreUrl: string;
}): string {
  const ios = storeUrlFor({ platform: 'ios', androidPackage: input.androidPackage, iosAppStoreUrl: input.iosAppStoreUrl });
  const android = storeUrlFor({ platform: 'android', androidPackage: input.androidPackage, iosAppStoreUrl: input.iosAppStoreUrl });
  return [input.intro, input.codeLine, input.reward, ios, android].filter((line): line is string => !!line).join('\n');
}

/** 코드 넣기 실패의 사유 — 화면 문구와 계측(`invite_redeem_fail` 의 reason)이 같이 쓴다. */
export type RedeemFailReason = 'not_found' | 'own_code' | 'already' | 'window_closed' | 'rate_limited' | 'network' | 'unknown';

export function redeemFailReason(error: unknown): RedeemFailReason {
  switch (errorCode(error)) {
    case 'invite_code_not_found':
      return 'not_found';
    case 'own_invite_code':
      return 'own_code';
    case 'invite_already_redeemed':
      return 'already';
    case 'invite_window_closed':
      return 'window_closed';
  }
  const status = errorStatus(error);
  if (status === 429) return 'rate_limited';
  if (status === null || status >= 500) return 'network';
  return 'unknown';
}

// ── 딥링크로 받은 코드 ─────────────────────────────────────────────

const PENDING_KEY = 'acttub.invite.pendingCode';

/** 딥링크로 받은 코드를 기기에 맡긴다. 프로필의 코드 넣기 칸이 열리면 그 코드를 채운다. 못 쓰면 조용히 넘어간다. */
export async function rememberPendingInviteCode(code: string): Promise<void> {
  try {
    await deviceStorage().setItem(PENDING_KEY, code);
  } catch {
    // 기기 저장소를 못 쓰면 채워 주지 못할 뿐이다.
  }
}

/** 맡긴 코드를 꺼낸다(한 번 꺼내면 지운다). 없거나 못 읽으면 null. */
export async function takePendingInviteCode(): Promise<string | null> {
  try {
    const storage = deviceStorage();
    const code = await storage.getItem(PENDING_KEY);
    if (code) await storage.removeItem(PENDING_KEY);
    return code && isInviteCode(code) ? code : null;
  } catch {
    return null;
  }
}

// ── 보상 지급 계측 ─────────────────────────────────────────────────

const seenKey = (userId: string) => `acttub.invite.rewardSeen.${userId}`;

/**
 * 이 계정이 이 기기에서 마지막으로 본 뒤 늘어난 보상 수. 서버가 준 `reward_count` 와 기기에 적어 둔 값(없으면 0)을 견주고,
 * 달라졌으면 새 값을 적는다. 기기를 바꾸면 이미 센 보상을 한 번 더 셀 수 있다 — 서버 로그 `invite_reward_granted` 가 정본이다.
 */
export async function newRewardsSinceSeen(userId: string, rewardCount: number): Promise<number> {
  try {
    const storage = deviceStorage();
    const saved = Number.parseInt((await storage.getItem(seenKey(userId))) ?? '0', 10);
    const seen = Number.isFinite(saved) ? saved : 0;
    if (seen === rewardCount) return 0;
    await storage.setItem(seenKey(userId), String(rewardCount));
    return Math.max(0, rewardCount - seen);
  } catch {
    return 0;
  }
}
