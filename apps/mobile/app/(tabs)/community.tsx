import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CommunityBoard } from '@/components/community/community-board';
import { DeadlinePreview } from '@/components/deadline-preview';
import { NotificationBell } from '@/components/notification-bell';
import { NavHeader } from '@/components/ui/nav-header';
import { useTabBarSpace } from '@/components/ui/tab-bar';
import { palette } from '@/constants/palette';
import { markBoardSeen } from '@/lib/community-seen';
import { translate as t } from '@/lib/i18n';

/**
 * 커뮤니티 탭(SOMA-1120·1121) — 예전 챌린지 탭 안 「게시판」을 독립 탭으로 꺼냈다. 맨 위는 「오디션·입시」 입구(예전 홈의 마감 임박,
 * components/deadline-preview), 그 아래 게시판이다. 칸(자유·질문·홍보)과 글쓰기·글 보기는
 * 게시판 부품(components/community/community-board) 그대로다. 머리 오른쪽은 알림 종.
 * 목록을 받으면 가장 최근 글 시각을 본 것으로 적는다(SOMA-873 — 다른 화면이 새 글 점을 켤 때 쓴다).
 */
export default function CommunityScreen() {
  const router = useRouter();
  const tabBarSpace = useTabBarSpace();
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <NavHeader large title={t('tabs.community')} right={<NotificationBell phLabel="community_bell" />} />
      <View style={styles.flex}>
        <CommunityBoard
          // 맨 위 「오디션·입시」 입구 — 마감 임박 공고 몇 줄과 전체 보기(SOMA-1121). 공고가 없으면 칸째 없다.
          top={<DeadlinePreview />}
          bottomSpace={tabBarSpace}
          onWrite={() => router.push('/community-new')}
          onSeen={(latest) => {
            if (latest) void markBoardSeen(latest);
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
});
