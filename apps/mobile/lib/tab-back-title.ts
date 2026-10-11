import { translate as t } from './i18n.ts';

/**
 * 탭 묶음 화면의 제목 = 지금 보고 있는 탭 이름. iOS 는 다음 화면의 뒤로 버튼에 앞 화면 제목을 쓰는데, 제목이 없으면
 * 라우트 이름 "(tabs)"가 그대로 보였다.
 */
export function tabBackTitle(focusedTab: string | undefined): string {
  if (focusedTab === 'reading') return t('tabs.reading');
  if (focusedTab === 'challenges') return t('tabs.challenge');
  if (focusedTab === 'profile') return t('tabs.profile');
  return t('tabs.home');
}
