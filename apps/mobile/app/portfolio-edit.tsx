import Feather from '@expo/vector-icons/Feather';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { KeyboardAwareScroll } from '@/components/keyboard-aware-scroll';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { translate as t, translateList } from '@/lib/i18n';
import {
  CREDIT_KINDS,
  CREDIT_MAX,
  INTRO_MAX,
  PHOTO_MAX,
  canAddCredit,
  canAddPhoto,
  creditDraftFrom,
  creditPatch,
  emptyCreditDraft,
  isIntroValid,
  moveItem,
  normalizeIntro,
  orderPayload,
  portfolioFailure,
  validateCreditDraft,
  type CreditDraft,
  type CreditDraftErrors,
  type CreditKind,
  type Portfolio,
  type PortfolioCredit,
} from '@/lib/portfolio';
import { pickAndUploadPortfolioPhoto } from '@/lib/profile-photo-upload';

/** 편집 중인 경력. id 가 null 이면 새 경력이다. */
type Editing = { id: string | null; draft: CreditDraft; errors: CreditDraftErrors };

/**
 * 포트폴리오 편집 — 배우가 오디션에 낼 소개글·경력·사진을 적어 두고 공유 링크로 보여 준다.
 *
 * 항목마다 따로 저장한다. 소개글은 저장 버튼으로, 경력·사진의 추가·수정·삭제·순서와 공유
 * 링크는 바꾸는 즉시 저장한다. 전부 선택 항목이라 빈 채로도 된다. 사진은 올리기 전에 항상
 * 긴 변 2048px 의 JPEG 로 줄인다(profile-photo). 공유 주소는 서버가 주는 url 을 그대로 쓴다.
 *
 * 다른 기기에서 그 사이 고쳤으면(순서 불일치 422, 이미 지운 것 404) 목록을 다시 받는다.
 */
export default function PortfolioEditScreen() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [intro, setIntro] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const { confirm, alert, dialog } = useAppDialog();
  const kindLabels = translateList('portfolio.kindOptions');

  const apply = useCallback((next: Portfolio) => {
    setPortfolio(next);
    setIntro(next.intro ?? '');
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      apply(await api.portfolio());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('portfolio.loadFail'));
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 요청 하나를 돌린다. 실패하면 사유에 맞는 안내를 띄우고, 필요하면 목록을 다시 받는다. */
  const run = useCallback(
    async (key: string, task: () => Promise<void>) => {
      if (busy) return;
      setBusy(key);
      try {
        await task();
      } catch (error) {
        const failure = portfolioFailure(error);
        if (failure.reload) await load();
        void alert({
          title: t('portfolio.failTitle'),
          message:
            failure.kind === 'retry' && error instanceof Error
              ? error.message
              : t(`portfolio.fail.${failure.kind}`),
        });
      } finally {
        setBusy(null);
      }
    },
    [alert, busy, load],
  );

  if (!portfolio) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: t('portfolio.title') }} />
        <View style={styles.center}>
          {loadError ? (
            <>
              <Text style={styles.error}>{loadError}</Text>
              <Pressable style={styles.linkBtn} onPress={() => void load()} accessibilityRole="button">
                <Text style={styles.linkText}>{t('portfolio.reload')}</Text>
              </Pressable>
            </>
          ) : (
            <ActivityIndicator color={palette.blue} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  const introChanged = normalizeIntro(intro) !== normalizeIntro(portfolio.intro);
  const introTooLong = !isIntroValid(intro);

  const saveIntro = () =>
    run('intro', async () => {
      apply(await api.savePortfolioIntro(normalizeIntro(intro)));
    });

  const saveCredit = () => {
    if (!editing) return;
    const result = validateCreditDraft(editing.draft, new Date());
    if (!result.ok) {
      setEditing({ ...editing, errors: result.errors });
      return;
    }
    const original = portfolio.credits.find((credit) => credit.id === editing.id) ?? null;
    void run('credit', async () => {
      if (original) {
        // 보낸 항목만 바뀐다. 바뀐 것이 없으면 요청을 보내지 않는다.
        const patch = creditPatch(original, result.payload);
        if (patch) await api.updatePortfolioCredit(original.id, patch);
      } else {
        await api.createPortfolioCredit(result.payload);
      }
      setEditing(null);
      apply(await api.portfolio());
    });
  };

  const removeCredit = async (credit: PortfolioCredit) => {
    const ok = await confirm({
      title: t('portfolio.creditDeleteTitle'),
      message: credit.title,
      confirmLabel: t('portfolio.delete'),
      destructive: true,
    });
    if (!ok) return;
    void run(`credit:${credit.id}`, async () => {
      await api.deletePortfolioCredit(credit.id);
      apply(await api.portfolio());
    });
  };

  const moveCredit = (id: string, direction: 'up' | 'down') => {
    const next = moveItem(portfolio.credits, id, direction);
    if (!next) return;
    void run(`credit:${id}`, async () => {
      apply(await api.reorderPortfolioCredits(orderPayload(next)));
    });
  };

  const addPhoto = () =>
    run('photo', async () => {
      const next = await pickAndUploadPortfolioPhoto();
      if (next) apply(next);
    });

  const removePhoto = async (photoId: string) => {
    const ok = await confirm({
      title: t('portfolio.photoDeleteTitle'),
      confirmLabel: t('portfolio.delete'),
      destructive: true,
    });
    if (!ok) return;
    void run(`photo:${photoId}`, async () => {
      await api.deletePortfolioPhoto(photoId);
      apply(await api.portfolio());
    });
  };

  const movePhoto = (id: string, direction: 'up' | 'down') => {
    const next = moveItem(portfolio.photos, id, direction);
    if (!next) return;
    void run(`photo:${id}`, async () => {
      apply(await api.reorderPortfolioPhotos(orderPayload(next)));
    });
  };

  const toggleShare = (enabled: boolean) =>
    run('share', async () => {
      const share = await api.setPortfolioShare(enabled);
      setPortfolio((current) => (current ? { ...current, share } : current));
    });

  const shareUrl = portfolio.share.enabled ? portfolio.share.url : null;
  const sendUrl = () => {
    if (shareUrl) void Share.share({ message: shareUrl }).catch(() => {});
  };

  const kindLabel = (kind: CreditKind) => kindLabels[CREDIT_KINDS.indexOf(kind)] ?? kind;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: t('portfolio.title') }} />
      <KeyboardAwareScroll contentContainerStyle={styles.content}>
        <Text style={styles.lead}>{t('portfolio.lead')}</Text>

        {/* 소개글 */}
        <Section title={t('portfolio.introTitle')}>
          <TextInput
            style={styles.textarea}
            placeholder={t('portfolio.introPlaceholder')}
            placeholderTextColor={palette.textFaint}
            value={intro}
            onChangeText={setIntro}
            multiline
            textAlignVertical="top"
          />
          <View style={styles.rowBetween}>
            <Text style={introTooLong ? styles.fieldError : styles.hint}>
              {introTooLong
                ? t('portfolio.introTooLong')
                : t('portfolio.count', { count: [...intro.trim()].length, max: INTRO_MAX })}
            </Text>
            <SmallButton
              label={t('portfolio.save')}
              onPress={saveIntro}
              disabled={!introChanged || introTooLong || busy !== null}
              busy={busy === 'intro'}
            />
          </View>
        </Section>

        {/* 경력 */}
        <Section title={t('portfolio.creditsTitle')}>
          {portfolio.credits.length === 0 && <Text style={styles.hint}>{t('portfolio.creditsEmpty')}</Text>}
          {portfolio.credits.map((credit, index) => (
            <View key={credit.id} style={styles.item}>
              <View style={styles.itemBody}>
                <Text style={styles.itemTitle}>{credit.title}</Text>
                <Text style={styles.itemSub}>
                  {[credit.role, String(credit.year), kindLabel(credit.kind)].join(' · ')}
                </Text>
              </View>
              <IconButton
                icon="arrow-up"
                label={t('portfolio.moveUp')}
                onPress={() => moveCredit(credit.id, 'up')}
                disabled={index === 0 || busy !== null}
              />
              <IconButton
                icon="arrow-down"
                label={t('portfolio.moveDown')}
                onPress={() => moveCredit(credit.id, 'down')}
                disabled={index === portfolio.credits.length - 1 || busy !== null}
              />
              <IconButton
                icon="edit-2"
                label={t('portfolio.edit')}
                onPress={() => setEditing({ id: credit.id, draft: creditDraftFrom(credit), errors: {} })}
                disabled={busy !== null}
              />
              <IconButton
                icon="trash-2"
                label={t('portfolio.delete')}
                onPress={() => void removeCredit(credit)}
                disabled={busy !== null}
              />
            </View>
          ))}
          <View style={styles.rowBetween}>
            <Text style={styles.hint}>
              {t('portfolio.count', { count: portfolio.credits.length, max: CREDIT_MAX })}
            </Text>
            <SmallButton
              label={t('portfolio.creditAdd')}
              onPress={() => setEditing({ id: null, draft: emptyCreditDraft(), errors: {} })}
              disabled={!canAddCredit(portfolio) || busy !== null}
            />
          </View>
          {!canAddCredit(portfolio) && <Text style={styles.hint}>{t('portfolio.fail.credit_limit')}</Text>}
        </Section>

        {/* 사진 */}
        <Section title={t('portfolio.photosTitle')}>
          {portfolio.photos.length === 0 && <Text style={styles.hint}>{t('portfolio.photosEmpty')}</Text>}
          {portfolio.photos.map((photo, index) => (
            <View key={photo.id} style={styles.item}>
              {photo.url ? (
                <Image source={{ uri: photo.url }} style={styles.thumb} />
              ) : (
                <View style={styles.thumb} />
              )}
              <Text style={[styles.itemBody, styles.itemSub]}>
                {t('portfolio.photoOrder', { order: index + 1 })}
              </Text>
              <IconButton
                icon="arrow-up"
                label={t('portfolio.moveUp')}
                onPress={() => movePhoto(photo.id, 'up')}
                disabled={index === 0 || busy !== null}
              />
              <IconButton
                icon="arrow-down"
                label={t('portfolio.moveDown')}
                onPress={() => movePhoto(photo.id, 'down')}
                disabled={index === portfolio.photos.length - 1 || busy !== null}
              />
              <IconButton
                icon="trash-2"
                label={t('portfolio.delete')}
                onPress={() => void removePhoto(photo.id)}
                disabled={busy !== null}
              />
            </View>
          ))}
          <View style={styles.rowBetween}>
            <Text style={styles.hint}>
              {t('portfolio.count', { count: portfolio.photos.length, max: PHOTO_MAX })}
            </Text>
            <SmallButton
              label={t('portfolio.photoAdd')}
              onPress={addPhoto}
              disabled={!canAddPhoto(portfolio) || busy !== null}
              busy={busy === 'photo'}
            />
          </View>
          {!canAddPhoto(portfolio) && <Text style={styles.hint}>{t('portfolio.fail.photo_limit')}</Text>}
        </Section>

        {/* 공유 링크 — 기본은 꺼짐이다. 켠 동안만 링크를 아는 사람이 로그인 없이 본다. */}
        <Section title={t('portfolio.shareTitle')}>
          <View style={styles.rowBetween}>
            <Text style={[styles.itemBody, styles.itemSub]}>{t('portfolio.shareBody')}</Text>
            <Switch
              value={portfolio.share.enabled}
              onValueChange={(value) => void toggleShare(value)}
              disabled={busy !== null}
              trackColor={{ true: palette.blue, false: palette.border }}
              thumbColor="#FFFFFF"
              ios_backgroundColor={palette.border}
            />
          </View>
          {shareUrl ? (
            <>
              {/* 길게 눌러 복사할 수 있다. 아래 버튼은 OS 공유 창(복사 포함)을 연다. */}
              <Text style={styles.url} selectable>
                {shareUrl}
              </Text>
              <SmallButton label={t('portfolio.shareSend')} onPress={sendUrl} disabled={busy !== null} />
            </>
          ) : (
            <Text style={styles.hint}>{t('portfolio.shareOffHint')}</Text>
          )}
        </Section>
      </KeyboardAwareScroll>

      {/* 경력 추가·수정 */}
      <Modal
        visible={editing !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditing(null)}>
        <Pressable style={styles.backdrop} onPress={() => setEditing(null)} accessibilityRole="button" />
        {editing && (
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {t(editing.id ? 'portfolio.creditEditTitle' : 'portfolio.creditAddTitle')}
            </Text>
            <LabeledInput
              label={t('portfolio.creditTitleLabel')}
              value={editing.draft.title}
              error={editing.errors.title}
              onChangeText={(title) =>
                setEditing({ ...editing, draft: { ...editing.draft, title }, errors: { ...editing.errors, title: undefined } })
              }
            />
            <LabeledInput
              label={t('portfolio.creditRoleLabel')}
              value={editing.draft.role}
              error={editing.errors.role}
              onChangeText={(role) =>
                setEditing({ ...editing, draft: { ...editing.draft, role }, errors: { ...editing.errors, role: undefined } })
              }
            />
            <LabeledInput
              label={t('portfolio.creditYearLabel')}
              value={editing.draft.year}
              error={editing.errors.year}
              numeric
              onChangeText={(text) =>
                setEditing({
                  ...editing,
                  draft: { ...editing.draft, year: text.replace(/[^0-9]/g, '').slice(0, 4) },
                  errors: { ...editing.errors, year: undefined },
                })
              }
            />
            <Text style={styles.fieldLabel}>{t('portfolio.creditKindLabel')}</Text>
            <View style={styles.chips}>
              {CREDIT_KINDS.map((kind) => {
                const selected = editing.draft.kind === kind;
                return (
                  <Pressable
                    key={kind}
                    style={[styles.chip, selected && styles.chipOn]}
                    onPress={() =>
                      setEditing({ ...editing, draft: { ...editing.draft, kind }, errors: { ...editing.errors, kind: undefined } })
                    }
                    accessibilityRole="button"
                    accessibilityState={{ selected }}>
                    <Text style={[styles.chipText, selected && styles.chipTextOn]}>{kindLabel(kind)}</Text>
                  </Pressable>
                );
              })}
            </View>
            {editing.errors.kind && <Text style={styles.fieldError}>{t('portfolio.fieldError.required')}</Text>}
            <View style={styles.modalActions}>
              <Pressable style={styles.modalBtn} onPress={() => setEditing(null)} accessibilityRole="button">
                <Text style={styles.modalBtnText}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, styles.modalBtnPrimary, busy !== null && styles.disabled]}
                onPress={saveCredit}
                disabled={busy !== null}
                accessibilityRole="button">
                {busy === 'credit' ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={[styles.modalBtnText, styles.modalBtnTextPrimary]}>{t('portfolio.save')}</Text>
                )}
              </Pressable>
            </View>
          </View>
        )}
      </Modal>
      {dialog}
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function SmallButton({
  label,
  onPress,
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      style={[styles.smallBtn, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button">
      {busy ? (
        <ActivityIndicator size="small" color={palette.blueDeep} />
      ) : (
        <Text style={styles.smallBtnText}>{label}</Text>
      )}
    </Pressable>
  );
}

function IconButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: 'arrow-up' | 'arrow-down' | 'edit-2' | 'trash-2';
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={[styles.iconBtn, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <Feather name={icon} size={17} color={palette.textDim} />
    </Pressable>
  );
}

function LabeledInput({
  label,
  value,
  error,
  numeric,
  onChangeText,
}: {
  label: string;
  value: string;
  error?: string;
  numeric?: boolean;
  onChangeText: (text: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        keyboardType={numeric ? 'number-pad' : 'default'}
        maxLength={numeric ? 4 : undefined}
      />
      {error && <Text style={styles.fieldError}>{t(`portfolio.fieldError.${error}`)}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bgSubtle },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  content: { padding: 20, paddingBottom: 40, gap: 14 },
  lead: { fontSize: 13.5, lineHeight: 20, color: palette.textDim },
  section: {
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  sectionTitle: { fontSize: 15.5, fontWeight: '800', color: palette.text },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  hint: { fontSize: 12.5, color: palette.textFaint, lineHeight: 18 },
  error: { color: palette.danger, fontSize: 14, textAlign: 'center' },
  fieldError: { fontSize: 12.5, color: palette.danger },
  linkBtn: { paddingHorizontal: 16, paddingVertical: 8 },
  linkText: { color: palette.blue, fontSize: 14, fontWeight: '700' },
  textarea: {
    minHeight: 120,
    backgroundColor: palette.bgSoft,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    color: palette.text,
    fontSize: 15,
    lineHeight: 22,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  itemBody: { flex: 1 },
  itemTitle: { fontSize: 14.5, fontWeight: '700', color: palette.text },
  itemSub: { fontSize: 12.5, color: palette.textDim, lineHeight: 18, marginTop: 2 },
  thumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: palette.bgSoft, marginRight: 6 },
  iconBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  smallBtn: {
    minWidth: 76,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    backgroundColor: palette.blueSoft,
    borderRadius: 9999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  smallBtnText: { fontSize: 13, fontWeight: '800', color: palette.blueDeep },
  disabled: { opacity: 0.4 },
  url: { fontSize: 13.5, fontWeight: '600', color: palette.text, lineHeight: 20 },

  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalCard: {
    position: 'absolute',
    left: 20,
    right: 20,
    top: '12%',
    backgroundColor: palette.card,
    borderRadius: 18,
    padding: 20,
    gap: 12,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: palette.text },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '800', color: palette.textMuted },
  input: {
    backgroundColor: palette.bgSoft,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    color: palette.text,
    fontSize: 15,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  chipOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  chipText: { fontSize: 13.5, fontWeight: '700', color: palette.textDim },
  chipTextOn: { color: palette.blueDeep },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  modalBtn: { minWidth: 72, alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 10 },
  modalBtnPrimary: { backgroundColor: palette.blue },
  modalBtnText: { fontSize: 14, fontWeight: '700', color: palette.textDim },
  modalBtnTextPrimary: { color: '#FFFFFF' },
});
