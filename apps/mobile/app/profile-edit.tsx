import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { pt } from '@/components/ui/anchored-menu';
import { DefaultAvatar } from '@/components/ui/default-avatar';
import { InlineErrorLine } from '@/components/ui/inline-error';
import { StatusScreen } from '@/components/ui/status-screen';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
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
 * 사진 자리는 고정이고 「사진 편집」 하나만 둔다. 사진이 있으면 Menu(사진 바꾸기 · 사진 지우기)를 띄우고, 없으면 바로
 * 고른다. 사진은 고르는 즉시 올린다(긴 변 2048px JPEG 로 줄여서). pen 의 「연습 방식」「이루고 싶은 것」은 서버 필드가 없어
 * 그리지 않고, 출생연도 대신 서버가 받는 생년월일을 보인다. pen 에 없는 「추구하는 방향」(서버 필수)과 포트폴리오
 * 편집 입구는 맨 아래에 남긴다.
 */
export default function ProfileEditScreen() {
  const router = useRouter();
  const { user, profile, reloadProfile, setMe } = useAuth();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const { sheet, dialog } = useAppDialog();
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
          <StatusScreen
            title={t('profileName.loadFail')}
            body={t('profileName.loadFailBody')}
            primary={{ label: t('common.retry'), onPress: () => void reloadProfile() }}
          />
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

  const editPhoto = (e?: GestureResponderEvent) => {
    if (!photoUri) {
      void changePhoto();
      return;
    }
    void sheet({
      anchor: pt(e),
      title: t('profileName.photoLabel'),
      actions: [
        { label: t('profileName.photoMenuChange'), icon: 'image', onPress: () => void changePhoto() },
        { label: t('profileName.photoRemove'), icon: 'trash-2', destructive: true, onPress: () => void removePhoto() },
      ],
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: t('profileName.editTitle') }} />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.summary}>
          <View style={styles.summaryTop}>
            <Pressable style={styles.photoBox} onPress={editPhoto} disabled={photoBusy} accessibilityRole="button" accessibilityLabel={t('profileName.editPhoto')}>
              <View style={styles.photo}>
                {photoBusy ? (
                  <LoadingText label={t('loadingText.uploading')} style={styles.photoBusy} />
                ) : photoUri ? (
                  <Image source={{ uri: photoUri }} style={styles.photoImg} contentFit="cover" />
                ) : (
                  <DefaultAvatar size={72} seed={user?.id} />
                )}
              </View>
              <Text style={styles.photoLink}>{t('profileName.editPhoto')}</Text>
            </Pressable>
            <View style={styles.summaryText}>
              <Text style={styles.summaryName} numberOfLines={1}>{p?.name ?? ''}</Text>
              <Text style={[styles.summaryBio, !p?.bio?.trim() && styles.summaryBioEmpty]} numberOfLines={2}>{p?.bio?.trim() || t('profileName.editBioEmpty')}</Text>
              <View style={styles.chipRow}>
                {!!p?.birth_date && (
                  <View style={styles.chip}>
                    <Feather name="gift" size={12} color={palette.iconFaint} />
                    <Text style={styles.chipText}>{p.birth_date.replace(/-/g, '.')}</Text>
                  </View>
                )}
                {!!p?.gender && (
                  <View style={styles.chip}>
                    <Feather name="user" size={12} color={palette.iconFaint} />
                    <Text style={styles.chipText}>{t(GENDER_LABEL_KEYS[p.gender])}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
          {photoError && <InlineErrorLine message={photoError} />}
        </View>

        {rows.map((row) => (
          <Pressable
            key={row.field}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() => router.push({ pathname: '/profile-edit-item', params: { field: row.field } })}
            accessibilityRole="button"
            accessibilityLabel={`${row.label} ${row.value}`}>
            <Text style={styles.rowLabel}>{row.label}</Text>
            <Text style={[styles.rowValue, row.field === 'bio' && !row.value && styles.rowEmpty]} numberOfLines={1}>
              {row.value || (row.field === 'bio' ? t('profileName.editBioRowEmpty') : '')}
            </Text>
            <Feather name="chevron-right" size={18} color={palette.iconFaint} />
          </Pressable>
        ))}
        {/* 포트폴리오(account.portfolio) — 가입 때 받는 여섯 항목과 다른 기능. 들어갈 길이 여기뿐이다. */}
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          onPress={() => router.push('/portfolio-edit')}
          accessibilityRole="button">
          <Text style={styles.rowLabel}>{t('profileName.rowPortfolio')}</Text>
          <Text style={[styles.rowValue, styles.rowEmpty]}>{t('profileName.editPortfolioRowEmpty')}</Text>
          <Feather name="chevron-right" size={18} color={palette.iconFaint} />
        </Pressable>
      </ScrollView>
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { paddingHorizontal: space.gutter, paddingTop: space[4], paddingBottom: space[8] },
  summary: { gap: space[3], padding: space[4], marginBottom: space[2], borderRadius: radius.lg, backgroundColor: palette.bgSubtle },
  summaryTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space[4] },
  summaryText: { flex: 1, gap: space[1.5] },
  summaryName: { ...type.headline, color: palette.text },
  summaryBio: { ...type.body2, color: palette.textSub },
  summaryBioEmpty: { color: palette.textMeta },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1.5] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
  },
  chipText: { ...type.micro, color: palette.textSub },
  photoBox: { alignItems: 'center', gap: space[2] },
  photo: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: palette.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoBusy: { ...type.micro, color: palette.textMeta },
  photoImg: { width: '100%', height: '100%' },
  photoLink: { ...type.micro, fontWeight: '700', color: palette.blueDeep },
  row: {
    minHeight: 53,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  pressed: { opacity: 0.6 },
  rowLabel: { ...type.body2, color: palette.textSub },
  rowEmpty: { ...type.body1, color: palette.textMeta },
  rowValue: { flex: 1, ...type.body1Bold, color: palette.text, textAlign: 'right' },
});
