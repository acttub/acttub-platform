import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { useAuth } from '@/lib/auth';
import { translate as t, translateList } from '@/lib/i18n';
import { DIRECTION_VALUES, EXPERIENCE_VALUES, GOAL_VALUES } from '@/lib/profile-form';
import { DIRECTION_LABEL_KEYS, GENDER_LABEL_KEYS, type ProfileEditField } from '@/lib/profile-labels';
import { pickAndUploadProfilePhoto, removeProfilePhoto } from '@/lib/profile-photo-upload';

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
  const { profile, reloadProfile, setMe } = useAuth();
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
        <View style={styles.center}>
          {profile.status === 'error' ? (
            <>
              <Text style={styles.error}>{t('profileName.loadFail')}</Text>
              <Pressable style={styles.reload} onPress={() => void reloadProfile()} accessibilityRole="button">
                <Text style={styles.reloadText}>{t('profileName.reload')}</Text>
              </Pressable>
            </>
          ) : (
            <ActivityIndicator color={palette.blue} />
          )}
        </View>
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
  const initial = (p?.name ?? '').trim().charAt(0) || '?';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: t('profileName.editTitle') }} />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.photoBox}>
          <Pressable onPress={() => void changePhoto()} disabled={photoBusy} accessibilityRole="button" accessibilityLabel={t('profileName.editPhoto')}>
            <View style={styles.photo}>
              {photoBusy ? (
                <ActivityIndicator color={palette.blue} />
              ) : photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.photoImg} contentFit="cover" />
              ) : (
                <Text style={styles.photoText}>{initial}</Text>
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

        <View style={styles.divider} />
        {rows.map((row) => (
          <View key={row.field}>
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => router.push({ pathname: '/profile-edit-item', params: { field: row.field } })}
              accessibilityRole="button"
              accessibilityLabel={`${row.label} ${row.value}`}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={styles.rowValue} numberOfLines={1}>
                {row.value}
              </Text>
              <Feather name="chevron-right" size={18} color={palette.checkOff} />
            </Pressable>
            <View style={styles.divider} />
          </View>
        ))}
        {/* 포트폴리오(account.portfolio) — 가입 때 받는 여섯 항목과 다른 기능. pen 엔 없지만 들어갈 길이 여기뿐이다. */}
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          onPress={() => router.push('/portfolio-edit')}
          accessibilityRole="button">
          <Text style={styles.rowLabel}>{t('profileName.rowPortfolio')}</Text>
          <Text style={styles.rowValue} />
          <Feather name="chevron-right" size={18} color={palette.checkOff} />
        </Pressable>
        <View style={styles.divider} />
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
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  photoBox: { alignItems: 'center', gap: 8, paddingTop: 4, paddingBottom: 12 },
  photo: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: palette.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoImg: { width: '100%', height: '100%' },
  photoText: { fontSize: 32, fontWeight: '800', color: palette.blue },
  photoLinks: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  photoLink: { fontSize: 14, fontWeight: '700', color: palette.blue },
  photoRemove: { fontSize: 14, fontWeight: '700', color: palette.textFaint },
  divider: { height: 1, backgroundColor: palette.borderSoft },
  row: { height: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
  pressed: { opacity: 0.6 },
  rowLabel: { width: 104, fontSize: 15, fontWeight: '600', color: palette.textDim },
  rowValue: { flex: 1, fontSize: 15, fontWeight: '600', color: palette.text },
});
