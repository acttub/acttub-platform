import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { logEvent } from '@/lib/analytics';
import { useAuth } from '@/lib/auth';
import {
  canWriteCommunity,
  communityPromptDraft,
  type CommunityPromptFrom,
  type CommunityPromptInput,
  type CommunityPromptKind,
} from '@/lib/community-prompt';

/**
 * 연습 완료 화면의 「상대역 구하기」·「물어보기」(SOMA-1054). 회원이고 `active` 일 때만 보이고, 보이면 한 번
 * community_prompt_shown, 누르면 community_prompt_tap 을 남기고 미리 채운 글쓰기를 연다.
 */
export function useCommunityPrompt(from: CommunityPromptFrom, active: boolean, input: CommunityPromptInput) {
  const router = useRouter();
  const { profile } = useAuth();
  const visible = active && canWriteCommunity(profile?.me);
  const shownRef = useRef(false);

  useEffect(() => {
    if (!visible || shownRef.current) return;
    shownRef.current = true;
    logEvent('community_prompt_shown', { from });
  }, [visible, from]);

  const open = (kind: CommunityPromptKind) => {
    logEvent('community_prompt_tap', { from, kind });
    router.push({ pathname: '/community-new', params: { ...communityPromptDraft(kind, input), from, kind } });
  };

  return { visible, open };
}
