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
 *
 * 방어(2026-08-27, 두 번째 이용에서 터진다는 제보):
 * - offer 재진입 금지 — 뒤로가기·마치기 연타가 proceed 를 두 번 돌리면
 *   내비게이션이 이중 실행돼 죽을 수 있다.
 * - proceed 는 딱 한 번, try/catch 로 감싼다 — 화면 전환이 실패해도 앱은 살린다.
 */
export function useExitReview(
  trigger: ExitReviewTrigger,
  screen: 'coach' | 'report',
  sessionId: string | null | undefined,
) {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const [sending, setSending] = useState(false);
  const proceedRef = useRef<(() => void) | null>(null);
  // offer 확인(비동기) 중이거나 시트가 떠 있는 동안 들어오는 offer 를 버린다.
  const offerBusyRef = useRef(false);
  // 보냄/건너뜀이 겹쳐 두 번 마무리되는 것을 막는다.
  const closingRef = useRef(false);

  const runProceed = useCallback((proceed: (() => void) | null | undefined) => {
    if (!proceed) return;
    try {
      proceed();
    } catch {
      // 화면 전환 실패(스택 상태가 예상과 다를 때)로 앱이 죽지 않게 삼킨다.
      // 사용자는 화면에 남아 있을 뿐이고, 다음 조작에서 다시 시도된다.
    }
  }, []);

  const finish = useCallback(() => {
    const proceed = proceedRef.current;
    proceedRef.current = null;
    setVisible(false);
    setSending(false);
    offerBusyRef.current = false;
    closingRef.current = false;
    runProceed(proceed);
  }, [runProceed]);

  const offer = useCallback(
    async (proceed: () => void) => {
      if (offerBusyRef.current) return;
      offerBusyRef.current = true;
      let asked = true; // 확인에 실패하면 조용히 통과시키는 쪽이 안전하다.
      try {
        asked = await hasAskedExitReview();
      } catch {
        asked = true;
      }
      if (!shouldOfferExitReview(asked)) {
        offerBusyRef.current = false;
        runProceed(proceed);
        return;
      }
      proceedRef.current = proceed;
      trackExitReviewOpened(trigger);
      setVisible(true);
      // offerBusyRef 는 finish()에서 풀린다 — 시트가 떠 있는 동안 offer 재진입 금지.
    },
    [runProceed, trigger],
  );

  const submit = useCallback(
    async (text: string, contact: { email: string; phone: string }) => {
      if (closingRef.current) return;
      const payload = oneLinerPayload({
        text,
        screen,
        sessionId,
        userId: user?.id,
        contactEmail: contact.email,
        contactPhone: contact.phone,
      });
      if (!payload) return;
      closingRef.current = true;
      setSending(true);
      try {
        await markExitReviewAsked();
        trackExitReviewSubmitted(trigger, payload.text.length);
        // 전송을 기다리지 않는다 — 나가려는 사람을 네트워크에 붙잡아 두지 않는다.
        void submitOneLiner(payload);
      } catch {
        // 기록·집계 실패가 나가기를 막으면 안 된다.
      }
      finish();
    },
    [finish, screen, sessionId, trigger, user?.id],
  );

  const skip = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    try {
      await markExitReviewAsked();
      trackExitReviewSkipped(trigger);
    } catch {
      // 위와 동일 — 마무리는 항상 진행한다.
    }
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
