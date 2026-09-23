import { useCallback, useRef, useState } from 'react';

import { ExitReviewSheet } from '@/components/exit-review-sheet';
import { api } from '@/lib/api';
import {
  practiceFeedback,
  trackExitReviewOpened,
  trackExitReviewSkipped,
  trackExitReviewSubmitted,
} from '@/lib/exit-review';
import { buildFeedbackBody, shouldOfferFeedback } from '@/lib/practice/feedback';
import type { FeedbackScreen, FeedbackTrigger } from '@/lib/practice/types';
import { newRequestId } from '@/lib/request-id';

/**
 * A7 이탈 설문(practice.feedback) — 대화·노트 화면에서 나가려 할 때 한 줄을 묻는다.
 *
 * 한 계정에 한 번만 묻는다. 자동 노출 직전에 서버가 계정의 표식을 원자적으로 선점하고
 * 선점한 기기만 시트를 띄운다(두 기기가 동시에 물어도 하나만). 선점을 못 읽으면(오프라인)
 * 새로 묻지 않고 그냥 보낸다. 보내기·건너뛰기 모두 접수로 남고, 접수 실패가 나가기를 막지 않는다.
 *
 * 방어(2026-08-27, 두 번째 이용에서 터진다는 제보):
 * - offer 재진입 금지 — 뒤로가기·마치기 연타가 proceed 를 두 번 돌리면 내비게이션이 죽을 수 있다.
 * - proceed 는 딱 한 번, try/catch 로 감싼다 — 화면 전환이 실패해도 앱은 살린다.
 */
export function useExitReview(
  trigger: FeedbackTrigger,
  screen: FeedbackScreen,
  practiceId: string | null | undefined,
) {
  const [visible, setVisible] = useState(false);
  const [sending, setSending] = useState(false);
  const proceedRef = useRef<(() => void) | null>(null);
  const offerBusyRef = useRef(false);
  const closingRef = useRef(false);
  /** 이 시트의 접수 id — 오프라인으로 밀려도 같은 id 라 서버에 행은 하나다. */
  const requestIdRef = useRef<string | null>(null);

  const runProceed = useCallback((proceed: (() => void) | null | undefined) => {
    if (!proceed) return;
    try {
      proceed();
    } catch {
      // 화면 전환 실패로 앱이 죽지 않게 삼킨다. 사용자는 화면에 남아 있을 뿐이다.
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
      // 선점 호출이 곧 온라인 판정이다 — 끊겨 있으면(오프라인) 새로 묻지 않는다.
      const claim = await api
        .claimFeedbackAsk()
        .then((r) => ({ online: true, claimedNow: r.asked_now }))
        .catch(() => ({ online: false, claimedNow: false }));
      if (!shouldOfferFeedback(claim)) {
        offerBusyRef.current = false;
        runProceed(proceed);
        return;
      }
      requestIdRef.current = newRequestId();
      proceedRef.current = proceed;
      trackExitReviewOpened(trigger);
      setVisible(true);
    },
    [runProceed, trigger],
  );

  const submit = useCallback(
    async (text: string, contact: { email: string; phone: string }) => {
      if (closingRef.current) return;
      closingRef.current = true;
      setSending(true);
      const body = buildFeedbackBody({
        requestId: requestIdRef.current ?? newRequestId(),
        practiceId: practiceId ?? null,
        screen,
        trigger,
        text,
        contactEmail: contact.email,
        contactPhone: contact.phone,
      });
      trackExitReviewSubmitted(trigger, body.body?.length ?? 0);
      // 전송을 기다리지 않는다 — 나가려는 사람을 네트워크에 붙잡아 두지 않는다.
      void practiceFeedback.send(body);
      finish();
    },
    [finish, practiceId, screen, trigger],
  );

  /** 건너뛰기도 본문 없는 행으로 남는다(dismissed). */
  const skip = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    const body = buildFeedbackBody({
      requestId: requestIdRef.current ?? newRequestId(),
      practiceId: practiceId ?? null,
      screen,
      trigger,
    });
    trackExitReviewSkipped(trigger);
    void practiceFeedback.send(body);
    finish();
  }, [finish, practiceId, screen, trigger]);

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
