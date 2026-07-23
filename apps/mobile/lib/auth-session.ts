export type SignOutDependencies = {
  serverLogout: () => Promise<void>;
  providerLogout: () => Promise<void>;
  clearLocalSession: () => Promise<void>;
};

export async function signOutBestEffort({
  serverLogout,
  providerLogout,
  clearLocalSession,
}: SignOutDependencies): Promise<void> {
  try {
    await serverLogout();
  } catch {
    // 서버가 오프라인이어도 로컬 로그아웃은 계속한다.
  }
  try {
    await providerLogout();
  } catch {
    // provider 세션 정리 실패는 로컬 로그아웃을 막지 않는다.
  } finally {
    await clearLocalSession();
  }
}
