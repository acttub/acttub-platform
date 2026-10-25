import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { translate as t } from '@/lib/i18n';
import {
  confirmedVideoFor,
  flushLibraryUploads,
  onLibraryChange,
  pendingLibraryUploads,
  removePendingUpload,
} from '@/lib/library/library-runner';
import { videoErrorMessage } from '@/lib/library/video-checks';
import { buildContinueBody, buildStartBody, inProgressPracticeId, startFailure } from '@/lib/practice/start';
import {
  createWaitingUploadStore,
  waitingState,
  type WaitingState,
  type WaitingUpload,
} from '@/lib/practice/waiting-upload';

const store = createWaitingUploadStore(AsyncStorage);
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

/** 새 연습 화면에서 「홈에서 기다리기」를 누를 때 남긴다. */
export async function rememberWaitingUpload(waiting: WaitingUpload): Promise<void> {
  await store.save(waiting);
  notify();
}

export async function forgetWaitingUpload(owner: string): Promise<void> {
  await store.clear(owner);
  notify();
}

export type WaitingCard = { state: Exclude<WaitingState, 'gone'>; waiting: WaitingUpload };

/**
 * 홈 맨 위 「영상 올리는 중」 카드의 상태. 큐(onLibraryChange)와 기기 기록을 구독하고, 다 올라가면 확정 영상 id 를 기록에
 * 옮겨 적는다. 올리기 큐는 진행률을 주지 않아 막대는 단계(올리는 중·완료·실패)로만 보인다.
 */
export function useWaitingUpload() {
  const router = useRouter();
  const { user } = useAuth();
  const owner = user?.id ?? null;
  const [card, setCard] = useState<WaitingCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const refresh = useCallback(async () => {
    if (!owner) {
      setCard(null);
      return;
    }
    const waiting = await store.load(owner);
    if (!waiting) {
      setCard(null);
      return;
    }
    const entry = (await pendingLibraryUploads(owner)).find((e) => e.id === waiting.pendingId) ?? null;
    const confirmed = confirmedVideoFor(waiting.pendingId);
    const state = waitingState(waiting, entry, confirmed);
    if (state === 'gone') {
      await store.clear(owner);
      setCard(null);
      return;
    }
    if (confirmed && !waiting.videoId) {
      const next = { ...waiting, videoId: confirmed };
      await store.save(next);
      setCard({ state, waiting: next });
      return;
    }
    setCard({ state, waiting });
  }, [owner]);

  useFocusEffect(
    useCallback(() => {
      void refresh().catch(() => undefined);
    }, [refresh]),
  );
  useEffect(() => {
    const run = () => void refresh().catch(() => undefined);
    listeners.add(run);
    const off = onLibraryChange(run);
    return () => {
      listeners.delete(run);
      off();
    };
  }, [refresh]);

  /** 실패한 올리기를 다시 민다. */
  const retry = useCallback(async () => {
    if (!owner) return;
    setError(null);
    await flushLibraryUploads(owner).catch(() => undefined);
    await refresh().catch(() => undefined);
  }, [owner, refresh]);

  /** 다 올라간 영상으로 코칭을 시작하고 대화로 들어간다. */
  const begin = useCallback(async () => {
    if (!card || card.state !== 'ready' || !card.waiting.videoId || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const { waiting } = card;
    const videoId = waiting.videoId as string;
    try {
      const input = { requestId: waiting.requestId, videoId, scene: waiting.scene, blockage: waiting.blockage };
      const practice = waiting.continueFrom
        ? await api.continuePractice(waiting.continueFrom.practiceId, buildContinueBody(input))
        : await api.createPractice(buildStartBody(input));
      await forgetWaitingUpload(waiting.owner);
      router.push({ pathname: '/coach', params: { practiceId: practice.id } });
    } catch (e) {
      const failure = startFailure(e);
      if (failure.kind === 'in_progress') {
        const open = await api
          .listPracticeGroups('all')
          .then(({ groups }) => inProgressPracticeId(groups, waiting.continueFrom?.rootId ?? null))
          .catch(() => null);
        if (open) {
          await forgetWaitingUpload(waiting.owner);
          router.push({ pathname: '/coach', params: { practiceId: open } });
          return;
        }
      }
      setError(
        failure.kind === 'daily_limit'
          ? t('start.dailyLimit')
          : failure.kind === 'offline'
            ? t('start.offline')
            : failure.kind === 'video_not_ready'
              ? t('start.stillUploading')
              : videoErrorMessage(e),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, [card, router]);

  const cancel = useCallback(async () => {
    if (!card) return;
    await removePendingUpload(card.waiting.pendingId).catch(() => undefined);
    await forgetWaitingUpload(card.waiting.owner);
  }, [card]);

  return { card, error, busy, retry, begin, cancel };
}
