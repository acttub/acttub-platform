import { getStoredUser, hasGuestSession } from "@/lib/auth/token-store";

// 이 브라우저의 게스트가 "만 14세 이상이에요"를 확인했는지. 게스트 id 에 묶어 둔다 —
// 갱신이 거절돼 새 게스트가 시작되면 앞 게스트의 확인을 물려받으면 안 된다.
//
// 동의 결정은 여기에 복제하지 않는다. 무엇을 물을지는 서버의 403 이, 계측을 켤지는 서버의
// 동의 현황이 정한다(analytics-consent.ts).
const AGE_CONFIRMED_KEY = "acttub.guest.age_confirmed";

function localStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function currentGuestId(): string | null {
  return hasGuestSession() ? (getStoredUser()?.id ?? null) : null;
}

/**
 * 첫 동의 시트에 "만 14세 이상이에요" 확인 줄을 둘지. 서버는 확인 시각을 게스트의 users
 * 행에 남기지만 웹에 돌려주지는 않는다 — 한 번 확인한 게스트에게 다시 묻지 않으려고
 * 여기 적어 둔다. 기록이 어긋나면 서버의 422(age_confirmation_required)가 바로잡는다.
 */
export function needsAgeConfirmation(): boolean {
  const guestId = currentGuestId();
  try {
    return !guestId || localStorage()?.getItem(AGE_CONFIRMED_KEY) !== guestId;
  } catch {
    return true;
  }
}

export function markAgeConfirmed(): void {
  const guestId = currentGuestId();
  if (!guestId) return;
  try {
    localStorage()?.setItem(AGE_CONFIRMED_KEY, guestId);
  } catch {
    // 저장소가 없으면 다음 시트에서 다시 묻는다 — 안전한 쪽이다.
  }
}

export function clearAgeConfirmed(): void {
  try {
    localStorage()?.removeItem(AGE_CONFIRMED_KEY);
  } catch {
    // 이미 비어 있는 것과 같다.
  }
}
