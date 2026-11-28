import type { useRouter } from 'expo-router';

import { translate as t } from '@/lib/i18n';
import { confirmedVideoFor, pendingLibraryUploads } from '@/lib/library/library-runner';
import { setPickedVideo } from '@/lib/practice/picked-video';
import { markSceneCoached, type SceneTake } from '@/lib/practice/scene-takes';
import { setContinueOrigin } from '@/lib/practice/session-state';
import { readingCoachScene } from '@/lib/reading/redesign-748';

type Router = ReturnType<typeof useRouter>;

/**
 * 찍은 장면 영상으로 코칭을 시작한다(새 연습 준비 app/upload) — 대본 제목·내 배역을 장면 칸에 채우고 그 대본에 「코칭 받음」을 남긴다.
 * 영상은 확정 id 가 있으면 그것, 아직 올리는 중이면 대기 항목으로 넘긴다. 확정 id 를 잊었고 대기 줄에도 없으면(앱을 다시 켠 뒤
 * 이미 올라간 영상) 영상 없이 준비 화면을 열어 보관함에서 고르게 한다 — 끝나지 않는 「올리는 중」에 갇히지 않게.
 */
export async function startSceneCoaching(
  router: Router,
  owner: string | null | undefined,
  script: { id: string; title: string; roles: readonly string[] },
  take: SceneTake | undefined,
  replace = false,
): Promise<void> {
  const pendingId = take?.pendingId ?? null;
  let videoId = take?.videoId ?? (pendingId ? confirmedVideoFor(pendingId) : null);
  let waiting = false;
  if (!videoId && pendingId && owner) {
    const queue = await pendingLibraryUploads(owner).catch(() => []);
    waiting = queue.some((entry) => entry.id === pendingId);
    videoId = confirmedVideoFor(pendingId);
  }
  if (videoId || waiting) {
    setPickedVideo({
      videoId: videoId ?? null,
      pendingId: videoId ? null : pendingId,
      uri: take?.uri ?? null,
      playbackUrl: null,
      durationMs: take?.durationMs ?? null,
      source: 'record',
    });
  }
  setContinueOrigin({
    kind: 'reading',
    scene: readingCoachScene({ title: script.title, lineIds: [], scenes: [], startIndex: 0, myRoles: [...script.roles], t }),
  });
  void markSceneCoached(owner, script.id);
  if (replace) router.replace('/upload');
  else router.push('/upload');
}
