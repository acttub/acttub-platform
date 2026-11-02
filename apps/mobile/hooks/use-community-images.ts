import { useCallback, useEffect, useRef, useState } from 'react';

import { logEvent } from '@/lib/analytics';
import { takeAllowed, type DraftImage } from '@/lib/community';
import { discardPickedImages, uploadPickedImage } from '@/lib/community-image-picker';

let seq = 0;
const nextKey = () => `pick-${Date.now().toString(36)}-${++seq}`;

/**
 * 글쓰기 사진 줄(SOMA-873) — 고른 사진을 바로 뒤에서 올리고, 한 장씩 올리는 중·끝·실패를 들고 있는다.
 * 5장을 넘겨 고르면 앞에서부터 남은 자리만큼만 받는다. 실패한 사진은 `retry` 로 다시 올리고, `remove` 로 뺀다.
 * 화면이 닫히면 고른 사진의 기기 복사본을 지운다.
 */
export function useCommunityImages() {
  const [drafts, setDrafts] = useState<DraftImage[]>([]);
  const draftsRef = useRef<DraftImage[]>([]);
  const picked = useRef<string[]>([]);
  const alive = useRef(true);

  const update = useCallback((fn: (prev: DraftImage[]) => DraftImage[]) => {
    setDrafts((prev) => {
      const next = fn(prev);
      draftsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      discardPickedImages(picked.current);
    };
  }, []);

  const upload = useCallback(
    (key: string, uri: string) => {
      update((prev) => prev.map((d) => (d.key === key ? { ...d, status: 'uploading' } : d)));
      uploadPickedImage(uri)
        .then((imageId) => {
          if (alive.current) update((prev) => prev.map((d) => (d.key === key ? { ...d, imageId, status: 'done' } : d)));
        })
        .catch(() => {
          void logEvent('community_image_upload_fail');
          if (alive.current) update((prev) => prev.map((d) => (d.key === key ? { ...d, status: 'failed' } : d)));
        });
    },
    [update],
  );

  /** 고른 사진들을 줄 끝에 붙이고 올리기 시작한다. 실제로 붙인 장수를 돌려준다. */
  const add = useCallback(
    (uris: string[]) => {
      const allowed = takeAllowed(uris, draftsRef.current);
      // 자리가 없어 받지 못한 복사본은 바로 지운다.
      discardPickedImages(uris.slice(allowed.length));
      if (allowed.length === 0) return 0;
      const fresh = allowed.map((uri) => ({ key: nextKey(), uri, imageId: null, status: 'uploading' as const }));
      picked.current.push(...allowed);
      update((prev) => [...prev, ...fresh]);
      fresh.forEach((d) => upload(d.key, d.uri));
      void logEvent('community_image_add', { count: fresh.length });
      return fresh.length;
    },
    [update, upload],
  );

  const remove = useCallback(
    (key: string) => {
      update((prev) => prev.filter((d) => d.key !== key));
      void logEvent('community_image_remove');
    },
    [update],
  );

  const retry = useCallback(
    (key: string) => {
      const draft = draftsRef.current.find((d) => d.key === key);
      if (!draft || draft.status !== 'failed') return;
      void logEvent('community_image_retry');
      upload(key, draft.uri);
    },
    [upload],
  );

  /** 고치는 글의 기존 사진으로 줄을 채운다. */
  const reset = useCallback(
    (initial: DraftImage[]) => {
      update(() => initial);
    },
    [update],
  );

  return { drafts, add, remove, retry, reset };
}
