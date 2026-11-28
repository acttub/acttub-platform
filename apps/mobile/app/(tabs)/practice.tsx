import { useLocalSearchParams } from 'expo-router';

import PracticePage from '@/components/practice/reading-pane';

/**
 * 연습 탭 — 한 페이지(components/practice/reading-pane): 단계 칸 셋 → 다음 할 일 카드 → 내 대본 → 코칭 구역.
 * 예전 「리딩 | 코칭」 전환은 없앴다. 다른 화면·알림이 보내는 주소(`/practice?mode=coaching`, lib/practice-mode practiceHref)는
 * 이 한 페이지로 오고, mode=coaching 이면 코칭 구역으로 한 번 내려 준다.
 */
export default function PracticeTab() {
  const params = useLocalSearchParams<{ mode?: string }>();
  return <PracticePage focusCoaching={params.mode === 'coaching'} />;
}
