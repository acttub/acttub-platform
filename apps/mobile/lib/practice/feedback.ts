import { translate } from '../i18n.ts';
import { FEEDBACK_BODY_MAX, FEEDBACK_CONTACT_MAX, type FeedbackBody, type FeedbackScreen, type FeedbackTrigger } from './types.ts';

/**
 * 이탈 설문(practice.feedback). 대화·노트 화면에서 나가려 할 때 한 줄을 묻고, 한 계정에 한 번만
 * 묻는다 — 자동 노출 직전에 서버가 계정의 표식을 원자적으로 선점하고 선점한 기기만 시트를 띄운다.
 * 건너뛰기도 본문 없는 행으로 남는다. 접수는 서버가 정본이고 시트는 서버가 복제한다(앱은 시트를
 * 직접 부르지 않는다). 제출 실패가 나가기를 막지 않는다.
 */
const PENDING_KEY = 'acttub.feedback.pending';

/** 길이는 코드 포인트로 센다 — 이모지 하나가 두 글자로 세이지 않게. */
function codePoints(value: string): number {
  return [...value].length;
}

/** 공백을 정리한 본문. 비었으면 null(건너뛰기와 같은 자리). */
export function feedbackBodyText(text: string): string | null {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed : null;
}

export function bodyTooLong(text: string): boolean {
  const body = feedbackBodyText(text);
  return body !== null && codePoints(body) > FEEDBACK_BODY_MAX;
}

export function contactTooLong(value: string): boolean {
  return codePoints(value.trim()) > FEEDBACK_CONTACT_MAX;
}

export function sendableContact(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function buildFeedbackBody(input: {
  requestId: string;
  practiceId: string | null;
  screen: FeedbackScreen;
  trigger: FeedbackTrigger;
  /** 건너뛰기면 비운다 — 본문 없는 행(dismissed)으로 남는다. */
  text?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
}): FeedbackBody {
  const body: FeedbackBody = {
    request_id: input.requestId,
    practice_id: input.practiceId,
    screen: input.screen,
    trigger: input.trigger,
  };
  const text = input.text === undefined ? null : feedbackBodyText(input.text);
  if (text !== null) {
    body.body = text;
    const email = sendableContact(input.contactEmail);
    const phone = sendableContact(input.contactPhone);
    if (email) body.contact_email = email;
    if (phone) body.contact_phone = phone;
  }
  return body;
}

export function isDismissed(body: FeedbackBody): boolean {
  return body.body === undefined;
}

/**
 * 시트를 띄울지. 오프라인에서는 새 자동 노출을 하지 않고(이미 쓴 제출만 다시 보낸다), 서버가
 * 표식을 선점해 준 기기만 띄운다.
 */
export function shouldOfferFeedback(input: { online: boolean; claimedNow: boolean }): boolean {
  return input.online && input.claimedNow;
}

export function feedbackNotice(): string {
  return translate('exitReview.notice');
}

// ─── 밀린 제출 ────────────────────────────────────────────────────────────────

export type FeedbackStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export type FeedbackQueueDeps = {
  storage: FeedbackStorage;
  submit: (body: FeedbackBody) => Promise<unknown>;
};

function isPermanent(error: unknown): boolean {
  const status = error !== null && typeof error === 'object' ? (error as { status?: unknown }).status : null;
  return typeof status === 'number' && status >= 400 && status < 500;
}

async function readPending(storage: FeedbackStorage): Promise<FeedbackBody[]> {
  try {
    const raw = await storage.getItem(PENDING_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as FeedbackBody[]) : [];
  } catch {
    return [];
  }
}

async function writePending(storage: FeedbackStorage, bodies: FeedbackBody[]): Promise<void> {
  try {
    if (bodies.length === 0) await storage.removeItem(PENDING_KEY);
    else await storage.setItem(PENDING_KEY, JSON.stringify(bodies));
  } catch {
    // 못 적어도 나가기를 막지 않는다.
  }
}

/**
 * 보내고, 실패하면 들고 있다가 다음에 다시 보낸다. 같은 요청 id 라 서버에는 행이 하나다.
 * 4xx(형식 오류 등)는 들고 있어도 소용없어 버린다.
 */
export function createFeedbackQueue(dependencies: FeedbackQueueDeps) {
  const { storage, submit } = dependencies;

  async function flush(): Promise<{ sent: number; kept: number }> {
    const pending = await readPending(storage);
    if (pending.length === 0) return { sent: 0, kept: 0 };
    const keep: FeedbackBody[] = [];
    let sent = 0;
    for (const body of pending) {
      try {
        await submit(body);
        sent += 1;
      } catch (error) {
        if (!isPermanent(error)) keep.push(body);
      }
    }
    await writePending(storage, keep);
    return { sent, kept: keep.length };
  }

  /** 제출은 기다리지 않는다 — 나가려는 사람을 네트워크에 붙잡아 두지 않는다. */
  async function send(body: FeedbackBody): Promise<'sent' | 'queued' | 'dropped'> {
    try {
      await submit(body);
      return 'sent';
    } catch (error) {
      if (isPermanent(error)) return 'dropped';
      const pending = await readPending(storage);
      if (!pending.some((item) => item.request_id === body.request_id)) pending.push(body);
      await writePending(storage, pending);
      return 'queued';
    }
  }

  return { send, flush };
}

export const FEEDBACK_PENDING_KEY = PENDING_KEY;
