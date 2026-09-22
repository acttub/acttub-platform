import { useCallback } from 'react';

import { useAppDialog } from '@/components/app-dialog';
import { useAuth } from '@/lib/auth';
import { translate as t } from '@/lib/i18n';

/**
 * 게스트 가드 — 계정이 있어야 하는 동작(AI 코칭·업로드·프로필 등) 앞에 둔다.
 * 로그인 상태면 그대로 실행하고, 게스트면 "로그인하고 계속" 팝업을 띄워 로그인 화면으로 보낸다.
 *
 *   const { requireLogin, element } = useRequireLogin();
 *   <Pressable onPress={() => requireLogin(() => router.push('/upload'))} />
 *   … {element}
 */
export function useRequireLogin() {
  const { status, leaveGuest } = useAuth();
  const { confirm, dialog } = useAppDialog();
  const isGuest = status === 'guest';

  const requireLogin = useCallback(
    (proceed: () => void) => {
      if (!isGuest) {
        proceed();
        return;
      }
      void confirm({
        title: t('guest.title'),
        message: t('guest.message'),
        confirmLabel: t('guest.cta'),
        cancelLabel: t('common.cancel'),
      }).then((ok) => {
        // 게이트가 signedOut을 보고 /login 으로 보낸다.
        if (ok) void leaveGuest();
      });
    },
    [confirm, isGuest, leaveGuest],
  );

  return { isGuest, requireLogin, element: dialog };
}
