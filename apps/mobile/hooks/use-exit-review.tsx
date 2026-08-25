import { useCallback, useRef, useState } from 'react';

import { ExitReviewSheet } from '@/components/exit-review-sheet';
import { useAuth } from '@/lib/auth';
import {
  hasAskedExitReview,
  markExitReviewAsked,
  oneLinerPayload,
  submitOneLiner,
  trackExitReviewOpened,
  trackExitReviewSkipped,
  trackExitReviewSubmitted,
} from '@/lib/exit-review';
import { shouldOfferExitReview, type ExitReviewTrigger } from '@/lib/exit-review-policy';

/**
 * "나가기 전에 한 줄만" 흐름(SOMA-433). 화면은 `offer(proceed)` 하나만 부른다 —
 * 이미 물어본 사람이면 proceed 를 바로 실행하고, 아니면 시트를 띄운 뒤 보내든
 * 건너뛰든 proceed 를 실행한다. 어느 쪽이든 그 사람에겐 다시 안 뜬다.
 */
export function useExitReview(trigger: ExitReviewTrigger, screen: 'coach' | 'report', sessionId: string | null | undefined) {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const [sending, setSending] = useState(false);
  const proceedRef = useRef<(() => void) | null>(null);

  const finish = useCallback(() => {
    const proceed = proceedRef.current;
    proceedRef.current = null;
    setVisible(false);
    setSending(false);
    proceed?.();
  }, []);

  const offer = useCallback(
    async (proceed: () => void) => {
      const asked = await hasAskedExitReview();
      if (!shouldOfferExitReview(asked)) {
        proceed();
        return;
      }
      proceedRef.current = proceed;
      trackExitReviewOpened(trigger);
      setVisible(true);
    },
    [trigger],
  );

  const submit = useCallback(
    async (text: string, contact: { email: string; phone: string }) => {
      const payload = oneLinerPayload({
        text,
        screen,
        sessionId,
        userId: user?.id,
        contactEmail: contact.email,
        contactPhone: contact.phone,
      });
      if (!payload) return;
      setSending(true);
      await markExitReviewAsked();
      trackExitReviewSubmitted(trigger, payload.text.length);
      // 전송을 기다리지 않는다 — 나가려는 사람을 네트워크에 붙잡아 두지 않는다.
      void submitOneLiner(payload);
      finish();
    },
    [finish, screen, sessionId, trigger, user?.id],
  );

  const skip = useCallback(async () => {
    await markExitReviewAsked();
    trackExitReviewSkipped(trigger);
    finish();
  }, [finish, trigger]);

  const element = (
    <ExitReviewSheet
      visible={visible}
      trigger={trigger}
      sending={sending}
      onSubmit={(text, contact) => void submit(text, contact)}
      onSkip={() => void skip()}
    />
  );

  return { offer, element, visible };
}
