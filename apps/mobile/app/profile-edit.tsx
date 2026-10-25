import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DefaultAvatar } from '@/components/ui/default-avatar';
import { palette } from '@/constants/palette';
import { useAuth } from '@/lib/auth';
import { LoadingText } from '@/components/ui/loading-text';
import { translate as t, translateList } from '@/lib/i18n';
import { DIRECTION_VALUES, EXPERIENCE_VALUES, GOAL_VALUES } from '@/lib/profile-form';
import { DIRECTION_LABEL_KEYS, GENDER_LABEL_KEYS, type ProfileEditField } from '@/lib/profile-labels';
import { pickAndUploadProfilePhoto, removeProfilePhoto } from '@/lib/profile-photo-upload';
import { SkeletonRows } from '@/components/ui/skeleton';

/**
 * S6 프로필 편집(pen mGCmI, SOMA-748) — 인스타그램식. 사진 수정 + 항목 줄(이름 · 값), 줄을 누르면 그 항목만 고치는 화면
 * (profile-edit-item)으로 간다. 설정과 프로필 탭의 「편집」이 연다. 가입 게이트 라우트(/profile-name)와 달리 부트스트랩
 * 게이트가 건드리지 않아, 게이트를 지난 회원도 프로필을 고칠 수 있다.
 *
 * 사진은 고르는 즉시 올린다(긴 변 2048px JPEG 로 줄여서). pen 의 「연습 방식」「이루고 싶은 것」은 서버 필드가 없어
 * 그리지 않고, 출생연도 대신 서버가 받는 생년월일을 보인다. pen 에 없는 「추구하는 방향」(서버 필수)과 포트폴리오
 * 편집 입구는 맨 아래에 남긴다.
 */
export default function ProfileEditScreen() {
  const router = useRouter();
  const { user, profile, reloadProfile, setMe } = useAuth();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const me = profile.me;
  const p = me?.profile ?? null;

  const changePhoto = async () => {
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const next = await pickAndUploadProfilePhoto();
      if (next) setMe(next);
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : t('profileName.photoFail'));
    } finally {
      setPhotoBusy(false);
    }
  };

  const removePhoto = async () => {
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      setMe(await removeProfilePhoto());
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : t('profileName.photoFail'));
    } finally {
      setPhotoBusy(false);
    }
  };

  if (!me) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: t('profileName.editTitle') }} />
        {profile.status === 'error' ? (
        <View style={styles.center}>
            <>
              <Text style={styles.error}>{t('profileName.loadFail')}</Text>
              <Pressable style={styles.reload} onPress={() => void reloadProfile()} accessibilityRole="button">
                <Text style={styles.reloadText}>{t('profileName.reload')}</Text>
              </Pressable>
            </>
        </View>
        ) : (
          <SkeletonRows count={5} avatar={false} card={false} />
        )}
      </SafeAreaView>
    );
  }

  const goals = translateList('profileName.goalOptions');
  const careers = translateList('profileName.careerOptions');
  const rows: { field: ProfileEditField; label: string; value: string }[] = [
    { field: 'name', label: t('profileName.nicknameLabel'), value: p?.name ?? '' },
    { field: 'bio', label: t('profileName.rowBio'), value: p?.bio?.trim() ?? '' },
    { field: 'birth', label: t('profileName.birthLabel'), value: p?.birth_date ?? '' },
    { field: 'gender', label: t('profileName.genderLabel'), value: p?.gender ? t(GENDER_LABEL_KEYS[p.gender]) : '' },
    { field: 'goal', label: t('profileName.rowGoal'), value: p?.goal ? (goals[GOAL_VALUES.indexOf(p.goal)] ?? '') : '' },
    {
      field: 'career',
      label: t('profileName.careerLabel'),
      value: p?.experience ? (careers[EXPERIENCE_VALUES.indexOf(p.experience)] ?? '') : '',
    },
    {
      field: 'directions',
      label: t('profileName.rowDirections'),
      value: DIRECTION_VALUES.filter((d) => p?.directions.includes(d))
        .map((d) => t(DIRECTION_LABEL_KEYS[d]))
        .join(', '),
    },
  ];
  const photoUri = p?.photo_url ?? null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: t('profileName.editTitle') }} />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.summary}>
        <View style={styles.photoBox}>
          <Pressable onPress={() => void changePhoto()} disabled={photoBusy} accessibilityRole="button" accessibilityLabel={t('profileName.editPhoto')}>
            <View style={styles.photo}>
              {photoBusy ? (
                <LoadingText label={t('loadingText.uploading')} style={{ fontSize: 12 }} />
              ) : photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.photoImg} contentFit="cover" />
              ) : (
                <DefaultAvatar size={84} seed={user?.id} />
              )}
            </View>
          </Pressable>
          <View style={styles.photoLinks}>
            <Pressable onPress={() => void changePhoto()} disabled={photoBusy} hitSlop={6} accessibilityRole="button">
              <Text style={styles.photoLink}>{t('profileName.editPhoto')}</Text>
            </Pressable>
            {!!photoUri && (
              <Pressable onPress={() => void removePhoto()} disabled={photoBusy} hitSlop={6} accessibilityRole="button">
                <Text style={styles.photoRemove}>{t('profileName.photoRemove')}</Text>
              </Pressable>
            )}
          </View>
          {photoError && <Text style={styles.error}>{photoError}</Text>}
        </View>
        <View style={styles.summaryText}>
          <Text style={styles.summaryName} numberOfLines={1}>{p?.name ?? ''}</Text>
          <Text style={[styles.summaryBio, !p?.bio?.trim() && styles.summaryBioEmpty]} numberOfLines={2}>{p?.bio?.trim() || t('profileName.editBioEmpty')}</Text>
          <View style={styles.chipRow}>
            {!!p?.birth_date && (
              <View style={styles.chip}>
                <Feather name="gift" size={13} color={palette.textMuted} />
                <Text style={styles.chipText}>{p.birth_date.replace(/-/g, '.')}</Text>
              </View>
            )}
            {!!p?.gender && (
              <View style={styles.chip}>
                <Feather name="user" size={13} color={palette.textMuted} />
                <Text style={styles.chipText}>{t(GENDER_LABEL_KEYS[p.gender])}</Text>
              </View>
            )}
          </View>
        </View>
        </View>

        {rows.map((row) => (
          <View key={row.field}>
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => router.push({ pathname: '/profile-edit-item', params: { field: row.field } })}
              accessibilityRole="button"
              accessibilityLabel={`${row.label} ${row.value}`}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={[styles.rowValue, row.field === 'bio' && !row.value && styles.rowEmpty]} numberOfLines={1}>
                {row.value || (row.field === 'bio' ? t('profileName.editBioRowEmpty') : '')}
              </Text>
              <Feather name="chevron-right" size={16} color={palette.checkOff} />
            </Pressable>
          </View>
        ))}
        {/* 포트폴리오(account.portfolio) — 가입 때 받는 여섯 항목과 다른 기능. pen 엔 없지만 들어갈 길이 여기뿐이다. */}
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          onPress={() => router.push('/portfolio-edit')}
          accessibilityRole="button">
          <Text style={styles.rowLabel}>{t('profileName.rowPortfolio')}</Text>
          <Text style={[styles.rowValue, styles.rowEmpty]}>{t('profileName.editPortfolioRowEmpty')}</Text>
          <Feather name="chevron-right" size={16} color={palette.checkOff} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  reload: { paddingHorizontal: 16, paddingVertical: 8 },
  reloadText: { color: palette.blue, fontSize: 14, fontWeight: '700' },
  error: { color: palette.danger, fontSize: 13, textAlign: 'center' },
  // pen S6.3 — 좌우 16, 카드 위 16, 줄 사이 9.
  body: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32, gap: 9 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 18, padding: 18, marginBottom: 6, borderRadius: 20, backgroundColor: palette.bgSubtle, borderWidth: 1, borderColor: palette.borderSoft },
  summaryText: { flex: 1, gap: 6 },
  summaryName: { fontSize: 20, fontWeight: '800', color: palette.text },
  // pen S6.4 소개가 있으면 #4E5968, 없으면 안내 #8B95A1.
  summaryBio: { fontSize: 14, color: palette.textDim, lineHeight: 20 },
  summaryBioEmpty: { color: palette.textFaint },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.bg, paddingHorizontal: 9, paddingVertical: 4 },
  chipText: { fontSize: 12, fontWeight: '500', color: palette.textDim },
  photoBox: { alignItems: 'center', gap: 8 },
  photo: {
    width: 84,
    height: 84,
    borderRadius: 32,
    backgroundColor: palette.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoImg: { width: '100%', height: '100%' },
  photoLinks: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  photoLink: { fontSize: 12, fontWeight: '700', color: palette.blue },
  photoRemove: { fontSize: 12, fontWeight: '700', color: palette.textFaint },
  divider: { height: 1, backgroundColor: palette.borderSoft },
  // pen S6.3 줄 — 높이 53(위아래 15), 왼 16 · 오른 12, 모서리 16, 칸 사이 10.
  row: { minHeight: 53, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 15, paddingLeft: 16, paddingRight: 12, borderWidth: 1, borderColor: palette.border, borderRadius: 16, backgroundColor: palette.card },
  pressed: { opacity: 0.6 },
  rowLabel: { fontSize: 14, fontWeight: '600', color: palette.textMuted },
  rowEmpty: { fontSize: 15, fontWeight: '500', color: palette.textFaint },
  rowValue: { flex: 1, fontSize: 16, fontWeight: '700', color: palette.text, textAlign: 'right' },
});
