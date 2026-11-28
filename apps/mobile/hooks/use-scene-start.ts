import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { recordScriptFromDetail, setRecordScript } from '@/lib/practice/record-script';
import { getScriptDetail, loadIntoCurrent, rememberedMyRoles } from '@/lib/reading/store';
import type { ScriptCard } from '@/lib/reading/types';

export type SceneStartFrom = 'step' | 'card' | 'row';
/** opened: 카메라를 열었다 · roles: 배역을 몰라 대본 상세(배역은 리딩을 시작할 때 고른다)로 보냈다 · failed: 대본을 못 받았다. */
export type SceneStartResult = 'opened' | 'roles' | 'failed';

/**
 * 연습 탭 「촬영하기」 — 대본 하나로 장면 촬영 카메라(app/record-video mode=scene)를 연다.
 * 내 배역은 그 대본의 마지막 회차 배역(서버 카드), 없으면 대본 만들기 때 기억한 배역이다. 그것도 없으면 지금처럼
 * 대본 상세로 보내 리딩을 시작하며 배역을 고르게 한다. 대본 줄을 받아 촬영 화면 대본 보기(프롬프터)에 얹는다.
 */
export function useSceneStart() {
  const router = useRouter();
  const [opening, setOpening] = useState<string | null>(null);

  const start = useCallback(
    async (script: Pick<ScriptCard, 'id' | 'title' | 'my_character_names'>, from: SceneStartFrom): Promise<SceneStartResult> => {
      setOpening(script.id);
      try {
        const roles = script.my_character_names.length > 0 ? script.my_character_names : await rememberedMyRoles(script.id);
        if (roles.length === 0) {
          if (!(await loadIntoCurrent(script.id))) return 'failed';
          router.push('/reading/detail');
          return 'roles';
        }
        const detail = await getScriptDetail(script.id).catch(() => null);
        if (!detail) return 'failed';
        setRecordScript({ ...recordScriptFromDetail(detail, roles), scriptId: script.id, role: roles.join(', ') });
        router.push({ pathname: '/record-video', params: { mode: 'scene', from } });
        return 'opened';
      } finally {
        setOpening(null);
      }
    },
    [router],
  );

  return { start, opening };
}
