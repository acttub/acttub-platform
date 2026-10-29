/**
 * 연습한 날짜 누적 (SOMA-526).
 *
 * 홈의 연속 연습일·주간 원은 서버 리포트 날짜로 그리는데, 기록을 지우면 그 날이 통째로
 * 사라져 연속일이 줄어들었다. 리포트를 불러올 때마다 날짜를 기기에 누적해 두고, 그 뒤로는
 * 서버 날짜 ∪ 누적 날짜로 계산한다 — 지워도 "그 날 연습했다"는 사실은 남는다.
 *
 * 서버에 연습일 필드가 없어 기기 로컬(AsyncStorage)이다. 재설치·새 기기에선 지운 날짜는
 * 복원되지 않는다. (CI mobile 잡이 무설치 node --test 라 AsyncStorage 는 lazy require.)
 */

import { dayKey } from './practice-activity.ts';

/**
 * 계정별 키(10/25). 예전 v1 은 계정을 가리지 않고 로그아웃해도 남아, 같은 폰에서 새 계정으로 들어가면 앞 계정의
 * 연습한 날을 이어받아 첫 사용자 화면이 안 떴다. v1 은 누구 것인지 알 수 없어 읽지 않고 지운다 — 서버 기록이 원본이다.
 */
const LEGACY_KEY = 'acttub.practiceDays.v1';
const keyFor = (userId: string) => `acttub.practiceDays.v2.${userId}`;

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

function storage(): Storage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-async-storage/async-storage').default as Storage;
}

/** 저장된 {dayKey → 대표 ISO 시각}. 값은 buildRecentActivity 에 그대로 먹일 created_at. */
type Stored = Record<string, string>;

async function read(userId: string): Promise<Stored> {
  try {
    void storage().removeItem(LEGACY_KEY).catch(() => undefined);
    const raw = await storage().getItem(keyFor(userId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Stored) : {};
  } catch {
    return {};
  }
}

/** 순수 병합 — 테스트용. 새 날짜만 더하고 있던 날짜는 그대로. */
export function mergePracticeDays(stored: Stored, records: readonly { created_at: string }[]): Stored {
  const next = { ...stored };
  for (const r of records) {
    const at = new Date(r.created_at);
    if (Number.isNaN(at.getTime())) continue;
    const key = dayKey(at);
    if (!next[key]) next[key] = at.toISOString();
  }
  return next;
}

/**
 * 서버 기록을 누적분에 합쳐 저장하고, 합친 전체를 created_at 목록으로 돌려준다.
 * 홈은 이 결과로 연속일·주간 원을 그린다.
 */
export async function rememberPracticeDays(
  records: readonly { created_at: string }[],
  userId: string | null | undefined,
): Promise<{ created_at: string }[]> {
  // 계정을 아직 모르면 기기 기록을 섞지 않고 서버 기록만 쓴다.
  if (!userId) return Object.values(mergePracticeDays({}, records)).map((created_at) => ({ created_at }));
  const stored = await read(userId);
  const merged = mergePracticeDays(stored, records);
  if (Object.keys(merged).length !== Object.keys(stored).length) {
    await storage().setItem(keyFor(userId), JSON.stringify(merged)).catch(() => undefined);
  }
  return Object.values(merged).map((created_at) => ({ created_at }));
}

// 탈퇴 시 삭제는 local-account-data 가 'acttub.' 접두사 키를 통째로 지우며 함께 처리한다.
