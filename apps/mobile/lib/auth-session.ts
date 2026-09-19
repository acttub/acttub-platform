/**
 * 로그아웃과 탈퇴의 순서(account.logout · account.withdraw). 무엇을 부르는지는 auth.tsx 가
 * 넣어 주고, 여기는 순서와 "어느 실패를 삼키는가"만 정한다.
 */
type Step = () => Promise<void>;

/** 실패해도 다음 단계로 간다. */
async function tolerate(step: Step): Promise<void> {
  try {
    await step();
  } catch {
    // 이 단계의 실패는 뒤 단계를 막지 않는다.
  }
}

export type SignOutDependencies = {
  /** ① 이 폰의 푸시 토큰을 서버에서 지운다. 실패한 삭제를 적어 두는 것은 push-token-lifecycle 의 몫. */
  deletePushToken: Step;
  /** ② 이 기기의 리프레시 토큰을 폐기한다. */
  serverLogout: Step;
  /** ③ 제공자 SDK 의 세션을 정리한다(애플은 없다). */
  providerLogout: Step;
  /** 저녁 리마인드 알람을 전부 취소한다. 다시 로그인하면 다시 맞춘다. */
  cancelReminders: Step;
  /** ④ 기기의 토큰과 계정 캐시를 지운다. 마지막 로그인 제공자 기억은 남긴다. */
  clearLocalSession: Step;
};

/**
 * 로그아웃. 순서는 푸시 토큰 삭제 → 리프레시 폐기 → 제공자 세션 정리 → 기기 토큰 삭제다.
 * 앞 단계가 실패해도(네트워크·5xx·401) 뒤 단계는 간다 — 비행기 모드에서도 로그아웃된다.
 */
export async function signOutBestEffort({
  deletePushToken,
  serverLogout,
  providerLogout,
  cancelReminders,
  clearLocalSession,
}: SignOutDependencies): Promise<void> {
  try {
    await tolerate(deletePushToken);
    await tolerate(serverLogout);
    await tolerate(providerLogout);
    await tolerate(cancelReminders);
  } finally {
    await clearLocalSession();
  }
}

/**
 * 계정이 서버에서 사라진 뒤 이 기기를 비우는 단계. 탈퇴, 다른 기기에서 한 탈퇴(403
 * account_deactivated), 가입 게이트의 만 14세 미만 닫힘이 같은 한 벌을 쓴다.
 */
export type ClosedAccountDependencies = {
  /** 서버가 푸시 토큰을 전부 지웠다. 기기의 기록만 버린다. */
  forgetPushToken: Step;
  cancelReminders: Step;
  /** 이 기기에 저장된 계정 자료(캐시, 파일, 메모리 상태)를 전부 지운다. */
  wipeLocalData: Step;
  /** 마지막 로그인 제공자 기억은 로그아웃에는 남기지만, 계정이 사라질 때는 지운다. */
  forgetLastProvider: Step;
  providerLogout: Step;
  /** 기기의 토큰을 지운다. 서버 로그아웃은 부르지 않는다 — refresh 는 서버가 이미 전부 끊었다. */
  clearLocalSession: Step;
};

/**
 * 닫힌 계정의 기기 비우기. 계정은 이미 사라졌으므로 하나가 실패해도 계속 간다 — 여기서 멈추면
 * 지워진 계정으로 로그인된 화면에 남는다. 알람은 예약 id 가 기기 자료와 함께 지워지기 전에 취소한다.
 */
export async function wipeClosedAccount({
  forgetPushToken,
  cancelReminders,
  wipeLocalData,
  forgetLastProvider,
  providerLogout,
  clearLocalSession,
}: ClosedAccountDependencies): Promise<void> {
  try {
    await tolerate(forgetPushToken);
    await tolerate(cancelReminders);
    await tolerate(wipeLocalData);
    await tolerate(forgetLastProvider);
    await tolerate(providerLogout);
  } finally {
    await clearLocalSession();
  }
}

export type WithdrawDependencies = ClosedAccountDependencies & {
  /** 앱이 SDK 로 끊는 제공자(구글)의 연결 해제. 탈퇴 요청 직전에 부른다. */
  disconnectProviders: Step;
  /** 서버 파기. 실패하면 계정은 그대로이므로 기기에서 아무것도 지우지 않는다. */
  serverWithdraw: Step;
};

/**
 * 탈퇴. 서버가 먼저다 — 서버 파기가 실패하면(네트워크·서버 오류) 오류를 올리고 기기는
 * 건드리지 않는다. 계정은 살아 있는데 기기에서만 로그아웃되면 탈퇴한 줄 알고 떠난다.
 * 서버 처리가 멱등해서 다시 눌러도 안전하다.
 *
 * 서버가 끝낸 뒤에는 닫힌 계정의 기기 비우기를 그대로 돈다(wipeClosedAccount).
 */
export async function withdrawAccount({
  disconnectProviders,
  serverWithdraw,
  ...closedAccount
}: WithdrawDependencies): Promise<void> {
  // 앱의 해제가 실패해도 탈퇴는 진행한다.
  await tolerate(disconnectProviders);
  await serverWithdraw();
  await wipeClosedAccount(closedAccount);
}
