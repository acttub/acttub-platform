import { useCallback, useState } from 'react';

import { useAppDialog } from '@/components/app-dialog';
import { ExitReviewSheet } from '@/components/exit-review-sheet';
import { logEvent } from '@/lib/analytics';
import { useAuth } from '@/lib/auth';
import { oneLinerPayload, submitOneLiner } from '@/lib/exit-review';
import { translate as t } from '@/lib/i18n';

/**
 * 언제든 여는 의견 시트 — 설정 "의견 보내기"·홈 넛지가 쓴다.
 * 나갈 때 한 번만 묻는 useExitReview와 달리 몇 번이든 열리고, 물어봤다는 표시도 남기지 않는다.
 * 저장소는 같은 구글 시트(app_oneliner) — screen 값으로 어디서 왔는지 갈라 본다.
 */
export function useFeedbackSheet(screen: 'settings' | 'home') {
  const { user } = useAuth();
  const { alert, dialog } = useAppDialog();
  const [visible, setVisible] = useState(false);
  const [sending, setSending] = useState(false);

  const open = useCallback(() => {
    logEvent('feedback_sheet_open', { screen });
    setVisible(true);
  }, [screen]);

  const submit = useCallback(
    async (text: string, contact: { email: string; phone: string }) => {
      const payload = oneLinerPayload({
        text,
        screen,
        sessionId: null,
        userId: user?.id,
        contactEmail: contact.email,
        contactPhone: contact.phone,
      });
      if (!payload) return;
      setSending(true);
      await submitOneLiner(payload);
      logEvent('feedback_sheet_submit', { screen, length: payload.text.length });
      setSending(false);
      setVisible(false);
      void alert({ title: t('exitReview.sentTitle'), message: t('exitReview.sentMessage'), confirmLabel: t('common.confirm') });
    },
    [alert, screen, user?.id],
  );

  const element = (
    <>
      <ExitReviewSheet
        visible={visible}
        trigger="feedback"
        sending={sending}
        onSubmit={(text, contact) => void submit(text, contact)}
        onSkip={() => setVisible(false)}
      />
      {dialog}
    </>
  );

  return { open, element };
}
