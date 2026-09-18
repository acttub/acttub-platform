import Feather from '@expo/vector-icons/Feather';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState, type ComponentProps } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { displayNameFor } from '@/lib/display-name';
import { getUserName } from '@/lib/profile';
import { getProfileBio, getProfilePhotoUri, setProfileBio, setProfilePhotoUri } from '@/lib/profile-extras';
import { translate as t } from '@/lib/i18n';

/**
 * A4 프로필 — 하단 탭 "프로필"이 여는 페이지. 설정(⚙)·프로필 편집·활동·코치 기억으로 간다.
 *
 * 사진·한 줄 소개는 기기에만 저장한다(profile-extras, 서버 필드 없음). 보관함(A2.2)·저장한
 * 영상(A15.5)은 예시 데이터 화면. 챌린지 수도 계약이 없어 0을 보여준다(연습 수만 실데이터).
 */
export default function ProfileScreen() {
  const router = useRouter();
  const { user, status, leaveGuest } = useAuth();
  const isGuest = status === 'guest';
  const { alert, dialog } = useAppDialog();
  const [name, setName] = useState<string | null>(null);
  const [practiceCount, setPracticeCount] = useState(0);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [bio, setBio] = useState('');
  const [bioDraft, setBioDraft] = useState('');
  const [bioOpen, setBioOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void getUserName().then((n) => alive && setName(n?.trim() || null));
      void getProfilePhotoUri().then((u) => alive && setPhotoUri(u));
      void getProfileBio().then((b) => alive && setBio(b));
      void api
        .reportHistory()
        .then((r) => alive && setPracticeCount(r.reports.length))
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, []),
  );

  const display = displayNameFor(name, user?.email ?? null) || t('profileTab.title');
  const initial = display.trim().charAt(0) || '?';

  // 사진은 갤러리에서 골라 기기에만 둔다. 권한 거절·취소는 조용히 넘어간다.
  const pickPhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      if (result.canceled || !result.assets[0]) return;
      const uri = result.assets[0].uri;
      await setProfilePhotoUri(uri);
      setPhotoUri(uri);
    } catch {
      void alert({ title: t('profileTab.photoFail'), confirmLabel: t('common.confirm') });
    }
  };
  const openBio = () => {
    setBioDraft(bio);
    setBioOpen(true);
  };
  const saveBio = async () => {
    await setProfileBio(bioDraft);
    setBio(bioDraft.trim());
    setBioOpen(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('profileTab.title')}</Text>
          <Pressable style={styles.gear} onPress={() => router.push('/settings')} accessibilityRole="button">
            <Feather name="settings" size={22} color={palette.textDim} />
          </Pressable>
        </View>

        {/* 게스트 — 계정이 없으니 프로필 대신 로그인 안내 카드. */}
        {isGuest && (
          <View style={styles.guestCard}>
            <Text style={styles.guestTitle}>{t('guest.profileTitle')}</Text>
            <Text style={styles.guestBody}>{t('guest.profileBody')}</Text>
            <Pressable style={styles.guestBtn} onPress={() => void leaveGuest()} accessibilityRole="button">
              <Text style={styles.guestBtnText}>{t('guest.login')}</Text>
            </Pressable>
          </View>
        )}

        {/* 배우 프로필 카드 */}
        {!isGuest && <View style={styles.card}>
          <View style={styles.avatarCol}>
            <View style={styles.avatar}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarText}>{initial}</Text>
              )}
            </View>
            <Pressable style={styles.avatarBtn} onPress={() => void pickPhoto()} accessibilityRole="button">
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
            <Pressable style={styles.editBtn} onPress={() => router.push('/profile-edit')} accessibilityRole="button">
              <Feather name="edit-3" size={13} color={palette.blueDeep} />
              <Text style={styles.editBtnText}>{t('profileTab.editPortfolio')}</Text>
            </Pressable>
          </View>
        </View>}

        {/* 한 줄 소개 */}
        {!isGuest && <Pressable style={styles.bioCard} onPress={openBio} accessibilityRole="button">
          <Text style={styles.bioLabel}>{t('profileTab.bioLabel')}</Text>
          <Text style={bio ? styles.bioText : styles.bioPh}>{bio || t('profileTab.bioPlaceholder')}</Text>
        </Pressable>}

        {/* 나의 활동 */}
        <Text style={styles.sectionLabel}>{t('profileTab.activitySection')}</Text>
        <Row icon="video" title={t('profileTab.archiveTitle')} sub={t('profileTab.archiveSub')} onPress={() => router.push('/archive')} />
        <Row icon="bookmark" title={t('profileTab.savedTitle')} sub={t('profileTab.savedSub')} onPress={() => router.push('/saved-videos')} />

        {/* 코치의 기억 — 게스트에겐 없다 */}
        {!isGuest && <Text style={styles.sectionLabel}>{t('profileTab.memorySection')}</Text>}
        {!isGuest && (
          <Row
            icon="cpu"
            title={t('profileTab.memoryTitle')}
            sub={t('profileTab.memorySub')}
            onPress={() => router.push('/memory')}
          />
        )}
      </ScrollView>

      {/* 한 줄 소개 입력 — 작은 모달. */}
      <Modal visible={bioOpen} transparent animationType="fade" onRequestClose={() => setBioOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setBioOpen(false)} accessibilityRole="button" />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{t('profileTab.bioEditTitle')}</Text>
          <TextInput
            style={styles.modalInput}
            placeholder={t('profileTab.bioEditPh')}
            placeholderTextColor={palette.textFaint}
            value={bioDraft}
            onChangeText={setBioDraft}
            maxLength={60}
            autoFocus
          />
          <View style={styles.modalActions}>
            <Pressable style={styles.modalBtn} onPress={() => setBioOpen(false)} accessibilityRole="button">
              <Text style={styles.modalBtnText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable style={[styles.modalBtn, styles.modalBtnPrimary]} onPress={() => void saveBio()} accessibilityRole="button">
              <Text style={[styles.modalBtnText, styles.modalBtnTextPrimary]}>{t('common.save')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      {dialog}
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

  guestCard: { backgroundColor: palette.blueSoft, borderRadius: 18, padding: 18, gap: 8 },
  guestTitle: { fontSize: 18, fontWeight: '800', color: palette.text },
  guestBody: { fontSize: 13.5, color: palette.textDim, lineHeight: 20 },
  guestBtn: { alignSelf: 'flex-start', backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10, marginTop: 4 },
  guestBtnText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  bioCard: { backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 14, padding: 14, gap: 4 },
  bioLabel: { fontSize: 12.5, fontWeight: '800', color: palette.textMuted },
  bioPh: { fontSize: 13, fontWeight: '500', color: palette.textFaint },
  bioText: { fontSize: 14, fontWeight: '600', color: palette.text },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalCard: { position: 'absolute', left: 24, right: 24, top: '30%', backgroundColor: palette.card, borderRadius: 18, padding: 20, gap: 14 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: palette.text },
  modalInput: { backgroundColor: palette.bgSoft, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: palette.text },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  modalBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  modalBtnPrimary: { backgroundColor: palette.blue },
  modalBtnText: { fontSize: 14, fontWeight: '700', color: palette.textDim },
  modalBtnTextPrimary: { color: '#FFFFFF' },

  sectionLabel: { fontSize: 13, fontWeight: '800', color: palette.textMuted, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, borderRadius: 14, padding: 14 },
  rowIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 14.5, fontWeight: '700', color: palette.text },
  rowSub: { fontSize: 12, fontWeight: '500', color: palette.textFaint, marginTop: 3 },
});
