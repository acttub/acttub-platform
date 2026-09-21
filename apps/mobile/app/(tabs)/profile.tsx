import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState, type ComponentProps } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { displayNameFor } from '@/lib/display-name';
import { getUserName } from '@/lib/profile';
import { isKorean, translate as t } from '@/lib/i18n';

/**
 * A4 프로필 — 하단 탭 "프로필"이 여는 페이지. 설정(⚙)·포트폴리오 편집·활동·코치 기억으로 간다.
 * "포트폴리오 편집"은 가입 때 받는 프로필 여섯 항목과 다른 기능이다(account.portfolio).
 *
 * 이름·사진·한 줄 소개는 서버의 프로필(GET /v2/me)을 보여 준다. 사진과 소개는 설정에서만
 * 받으므로 여기서는 고치지 않고 프로필 수정 화면으로 보낸다. 보관함(A2.2)·저장한
 * 영상(A15.5)은 예시 데이터 화면. 챌린지 수도 계약이 없어 0을 보여준다(연습 수만 실데이터).
 */
export default function ProfileScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [name, setName] = useState<string | null>(null);
  const [practiceCount, setPracticeCount] = useState(0);
  const serverProfile = profile.me?.profile ?? null;
  const photoUri = serverProfile?.photo_url ?? null;
  const bio = serverProfile?.bio?.trim() ?? '';

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void getUserName().then((n) => alive && setName(n?.trim() || null));
      // 연습 횟수는 묶음의 회차 수를 더한 값이다(practice.library).
      void api
        .listPracticeGroups('all')
        .then((r) => alive && setPracticeCount(r.groups.reduce((sum, g) => sum + g.ordinal_count, 0)))
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, []),
  );

  // 정본은 서버의 프로필 이름이다. 아직 못 읽었으면 기기에 적어 둔 이름으로 부른다.
  const display =
    displayNameFor(serverProfile?.name ?? name, user?.email ?? null) || t('profileTab.title');
  const initial = display.trim().charAt(0) || '?';
  const openProfileEdit = () => router.push('/profile-edit');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('profileTab.title')}</Text>
          <Pressable style={styles.gear} onPress={() => router.push('/settings')} accessibilityRole="button">
            <Feather name="settings" size={22} color={palette.textDim} />
          </Pressable>
        </View>

        {/* 배우 프로필 카드 */}
        <View style={styles.card}>
          <View style={styles.avatarCol}>
            <View style={styles.avatar}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarText}>{initial}</Text>
              )}
            </View>
            <Pressable style={styles.avatarBtn} onPress={openProfileEdit} accessibilityRole="button">
              <Feather name="camera" size={12} color={palette.blueDeep} />
              <Text style={styles.avatarBtnText}>{t(photoUri ? 'profileTab.changePhoto' : 'profileTab.addPhoto')}</Text>
            </Pressable>
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.actorLabel}>{t('profileTab.actorProfile')}</Text>
            <Text style={styles.name}>{display}</Text>
            {!!user?.email && <Text style={styles.email}>{user.email}</Text>}
            <Text style={styles.addInfo}>{t('profileTab.addInfo')}</Text>
            <View style={styles.statRow}>
              <Text style={styles.statValue}>{practiceCount}</Text>
              <Text style={styles.statLabel}>{t('profileTab.statPractice')}</Text>
              <Text style={styles.statValue}>0</Text>
              <Text style={styles.statLabel}>{t('profileTab.statChallenge')}</Text>
            </View>
            <Pressable style={styles.editBtn} onPress={() => router.push('/portfolio-edit')} accessibilityRole="button">
              <Feather name="edit-3" size={13} color={palette.blueDeep} />
              <Text style={styles.editBtnText}>{t('profileTab.editPortfolio')}</Text>
            </Pressable>
          </View>
        </View>

        {/* 한 줄 소개 */}
        <Pressable style={styles.bioCard} onPress={openProfileEdit} accessibilityRole="button">
          <Text style={styles.bioLabel}>{t('profileTab.bioLabel')}</Text>
          <Text style={bio ? styles.bioText : styles.bioPh}>{bio || t('profileTab.bioPlaceholder')}</Text>
        </Pressable>

        {/* 나의 활동 */}
        <Text style={styles.sectionLabel}>{t('profileTab.activitySection')}</Text>
        <Row icon="video" title={t('profileTab.archiveTitle')} sub={t('profileTab.archiveSub')} onPress={() => router.push('/archive')} />
        {/* 저장한 영상은 챌린지에서 담은 것뿐이라 챌린지와 함께 가린다 (SOMA-544). */}
        {isKorean() && (
          <Row icon="bookmark" title={t('profileTab.savedTitle')} sub={t('profileTab.savedSub')} onPress={() => router.push('/saved-videos')} />
        )}

        {/* 코치의 기억 */}
        <Text style={styles.sectionLabel}>{t('profileTab.memorySection')}</Text>
        <Row
          icon="cpu"
          title={t('profileTab.memoryTitle')}
          sub={t('profileTab.memorySub')}
          onPress={() => router.push('/memory')}
        />
      </ScrollView>

    </SafeAreaView>
  );
}

function Row({
  icon,
  title,
  sub,
  onPress,
}: {
  icon: ComponentProps<typeof Feather>['name'];
  title: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={onPress} accessibilityRole="button">
      <View style={styles.rowIcon}>
        <Feather name={icon} size={18} color={palette.blue} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={palette.checkOff} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  content: { padding: 20, paddingBottom: 130, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 },
  title: { fontSize: 26, fontWeight: '800', color: palette.text },
  gear: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  card: { flexDirection: 'row', gap: 14, backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, borderRadius: 18, padding: 16 },
  avatarCol: { alignItems: 'center', gap: 8 },
  avatar: { width: 84, height: 84, borderRadius: 18, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { fontSize: 34, fontWeight: '800', color: palette.blue },
  avatarBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: palette.blueSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  avatarBtnText: { fontSize: 11, fontWeight: '800', color: palette.blueDeep },
  cardBody: { flex: 1, gap: 3 },
  actorLabel: { fontSize: 11, fontWeight: '800', color: palette.blue, letterSpacing: 0.5 },
  name: { fontSize: 20, fontWeight: '800', color: palette.text },
  email: { fontSize: 12.5, fontWeight: '500', color: palette.textMuted },
  addInfo: { fontSize: 12.5, fontWeight: '600', color: palette.textFaint, marginTop: 2 },
  statRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 8 },
  statValue: { fontSize: 16, fontWeight: '800', color: palette.text },
  statLabel: { fontSize: 12, fontWeight: '600', color: palette.textMuted, marginRight: 8 },
  editBtn: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 5, backgroundColor: palette.blueSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, marginTop: 10 },
  editBtnText: { fontSize: 12.5, fontWeight: '800', color: palette.blueDeep },

  bioCard: { backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 14, padding: 14, gap: 4 },
  bioLabel: { fontSize: 12.5, fontWeight: '800', color: palette.textMuted },
  bioPh: { fontSize: 13, fontWeight: '500', color: palette.textFaint },
  bioText: { fontSize: 14, fontWeight: '600', color: palette.text },

  sectionLabel: { fontSize: 13, fontWeight: '800', color: palette.textMuted, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, borderRadius: 14, padding: 14 },
  rowIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 14.5, fontWeight: '700', color: palette.text },
  rowSub: { fontSize: 12, fontWeight: '500', color: palette.textFaint, marginTop: 3 },
});
