import Feather from '@expo/vector-icons/Feather';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Image, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { DragReorderList } from '@/components/drag-reorder';
import { KeyboardAwareScroll } from '@/components/keyboard-aware-scroll';
import { KeyboardLift } from '@/components/keyboard-lift';
import { Button } from '@/components/ui/buttons';
import { Chip } from '@/components/ui/chip';
import { DialogButtons, DialogCard } from '@/components/ui/dialog';
import { InlineErrorLine } from '@/components/ui/inline-error';
import { BlueSwitch } from '@/components/ui/list-rows';
import { LoadingText } from '@/components/ui/loading-text';
import { MASCOT } from '@/components/ui/mascot';
import { SkeletonDetail } from '@/components/ui/skeleton';
import { StatusScreen } from '@/components/ui/status-screen';
import { TextField } from '@/components/ui/text-field';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
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
  normalizeIntro,
  orderPayload,
  portfolioFailure,
  validateCreditDraft,
  type CreditDraft,
  type CreditDraftErrors,
  type CreditKind,
  type Portfolio,
  type PortfolioCredit,
  type PortfolioPhoto,
} from '@/lib/portfolio';
import { pickAndUploadPortfolioPhoto } from '@/lib/profile-photo-upload';

/** 편집 중인 경력. id 가 null 이면 새 경력이다. */
type Editing = { id: string | null; draft: CreditDraft; errors: CreditDraftErrors };

/**
 * 포트폴리오 편집 — 배우가 오디션에 낼 소개글·경력·사진을 적어 두고 공유 링크로 보여 준다.
 *
 * 항목마다 따로 저장한다. 소개글은 저장 버튼으로, 경력·사진의 추가·수정·삭제와 공유 링크는 바꾸는 즉시
 * 저장한다. 순서는 길게 눌러 끌어서 바꾸고 놓는 순간 저장하며, 실패하면 원래 순서로 되돌린다. 전부 선택 항목이라 빈 채로도 된다. 사진은 올리기 전에 항상
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
  const [dragging, setDragging] = useState(false);
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

  /** 요청 하나를 돌린다. 실패하면 `undo`로 되돌리고 사유에 맞는 안내를 띄우며, 필요하면 목록을 다시 받는다. */
  const run = useCallback(
    async (key: string, task: () => Promise<void>, undo?: () => void) => {
      if (busy) return;
      setBusy(key);
      try {
        await task();
      } catch (error) {
        undo?.();
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
        {loadError ? (
          <StatusScreen title={t('portfolio.loadFail')} body={loadError} primary={{ label: t('common.retry'), onPress: () => void load() }} />
        ) : (
          <SkeletonDetail lines={5} />
        )}
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

  /** 끌어서 바꾼 순서를 바로 보여 주고 보낸다. 실패하면 원래 순서로 되돌린다. */
  const reorderCredits = (next: PortfolioCredit[]) => {
    const before = portfolio.credits;
    setPortfolio((current) => (current ? { ...current, credits: next } : current));
    void run(
      'credits',
      async () => apply(await api.reorderPortfolioCredits(orderPayload(next))),
      () => setPortfolio((current) => (current ? { ...current, credits: before } : current)),
    );
  };

  const reorderPhotos = (next: PortfolioPhoto[]) => {
    const before = portfolio.photos;
    setPortfolio((current) => (current ? { ...current, photos: next } : current));
    void run(
      'photos',
      async () => apply(await api.reorderPortfolioPhotos(orderPayload(next))),
      () => setPortfolio((current) => (current ? { ...current, photos: before } : current)),
    );
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
    <GestureHandlerRootView style={styles.safe}>
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: t('portfolio.title') }} />
      <KeyboardAwareScroll contentContainerStyle={styles.content} scrollEnabled={!dragging}>
        <View style={styles.hero}>
          <View style={styles.heroText}>
            <Text style={styles.heroTitle} accessibilityRole="header">
              {t(portfolio.credits.length + portfolio.photos.length > 0 ? 'portfolio.heroFilled' : 'portfolio.heroEmpty')}
            </Text>
            <Text style={styles.lead}>{t('portfolio.lead')}</Text>
          </View>
          <Image source={MASCOT.cheer} style={styles.heroMascot} resizeMode="contain" accessibilityIgnoresInvertColors />
        </View>

        <Section title={t('portfolio.introTitle')} right={t('portfolio.count', { count: [...intro.trim()].length, max: INTRO_MAX })}>
          <TextField
            style={styles.textarea}
            placeholder={t('portfolio.introPlaceholder')}
            value={intro}
            onChangeText={setIntro}
            multiline
            textAlignVertical="top"
            error={introTooLong ? t('portfolio.introTooLong') : null}
          />
          <Button
            size="sm"
            label={t('portfolio.save')}
            onPress={saveIntro}
            disabled={!introChanged || introTooLong || busy !== null}
            loading={busy === 'intro'}
            loadingLabel={t('loadingText.saving')}
            style={styles.end}
          />
        </Section>

        <Section
          title={t('portfolio.creditsTitle')}
          right={t('portfolio.count', { count: portfolio.credits.length, max: CREDIT_MAX })}
          hint={portfolio.credits.length > 0 ? t('portfolio.reorderHint') : null}>
          {portfolio.credits.length === 0 && <Text style={styles.hint}>{t('portfolio.creditsEmpty')}</Text>}
          <DragReorderList
            items={portfolio.credits}
            axis="y"
            gap={space[2]}
            disabled={busy !== null}
            onReorder={reorderCredits}
            onDragChange={setDragging}
            renderItem={(credit) => (
              <View style={styles.item}>
                <View style={styles.itemBody}>
                  <Text style={styles.itemTitle}>{credit.title}</Text>
                  <Text style={styles.itemSub}>{[credit.role, String(credit.year), kindLabel(credit.kind)].join(' · ')}</Text>
                </View>
                <IconButton
                  icon="edit-2"
                  label={t('portfolio.edit')}
                  onPress={() => setEditing({ id: credit.id, draft: creditDraftFrom(credit), errors: {} })}
                  disabled={busy !== null}
                />
                <IconButton icon="trash-2" label={t('portfolio.delete')} onPress={() => void removeCredit(credit)} disabled={busy !== null} />
              </View>
            )}
          />
          <Button
            size="sm"
            label={t('portfolio.creditAdd')}
            icon={<Feather name="plus" size={16} color={palette.blueDeep} />}
            onPress={() => setEditing({ id: null, draft: emptyCreditDraft(), errors: {} })}
            disabled={!canAddCredit(portfolio) || busy !== null}
            style={styles.end}
          />
          {!canAddCredit(portfolio) && <Text style={styles.hint}>{t('portfolio.fail.credit_limit')}</Text>}
        </Section>

        <Section
          title={t('portfolio.photosTitle')}
          right={t('portfolio.count', { count: portfolio.photos.length, max: PHOTO_MAX })}
          hint={portfolio.photos.length > 0 ? t('portfolio.reorderHint') : null}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} scrollEnabled={!dragging} contentContainerStyle={styles.photoRow}>
            <DragReorderList
              items={portfolio.photos}
              axis="x"
              gap={space[2]}
              disabled={busy !== null}
              onReorder={reorderPhotos}
              onDragChange={setDragging}
              renderItem={(photo, index) => (
                <View style={styles.photoTile}>
                  {photo.url ? (
                    <Image source={{ uri: photo.url }} style={styles.photoImg} accessibilityLabel={t('portfolio.photoOrder', { order: index + 1 })} />
                  ) : (
                    <View style={styles.photoImg} accessibilityLabel={t('portfolio.photoOrder', { order: index + 1 })} />
                  )}
                  <Pressable
                    style={styles.photoX}
                    onPress={() => void removePhoto(photo.id)}
                    disabled={busy !== null}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={t('portfolio.delete')}>
                    <Feather name="x" size={14} color={palette.onAccent} />
                  </Pressable>
                </View>
              )}
            />
            <Pressable
              style={[styles.photoAdd, (!canAddPhoto(portfolio) || busy !== null) && styles.disabled]}
              onPress={addPhoto}
              disabled={!canAddPhoto(portfolio) || busy !== null}
              accessibilityRole="button"
              accessibilityLabel={t('portfolio.photoAdd')}>
              {busy === 'photo' ? (
                <LoadingText label={t('loadingText.uploading')} />
              ) : (
                <>
                  <Feather name="plus" size={22} color={palette.blueDeep} />
                  <Text style={styles.photoAddText}>{t('portfolio.photoAdd')}</Text>
                </>
              )}
            </Pressable>
          </ScrollView>
          {portfolio.photos.length === 0 && <Text style={styles.hint}>{t('portfolio.photosEmpty')}</Text>}
          {!canAddPhoto(portfolio) && <Text style={styles.hint}>{t('portfolio.fail.photo_limit')}</Text>}
        </Section>

        {/* 공유 링크 — 기본은 꺼짐이다. 켠 동안만 링크를 아는 사람이 로그인 없이 본다. */}
        <Section title={t('portfolio.shareTitle')}>
          <View style={styles.rowBetween}>
            <Text style={styles.shareBody}>{t('portfolio.shareBody')}</Text>
            <BlueSwitch
              value={portfolio.share.enabled}
              onValueChange={(value) => void toggleShare(value)}
              disabled={busy !== null}
              accessibilityLabel={t('portfolio.shareTitle')}
            />
          </View>
          {shareUrl ? (
            <>
              {/* 길게 눌러 복사할 수 있다. 아래 버튼은 OS 공유 창(복사 포함)을 연다. */}
              <Text style={styles.url} selectable>
                {shareUrl}
              </Text>
              <Button size="sm" label={t('portfolio.shareSend')} onPress={sendUrl} disabled={busy !== null} style={styles.start} />
            </>
          ) : (
            <Text style={styles.hint}>{t('portfolio.shareOffHint')}</Text>
          )}
        </Section>
      </KeyboardAwareScroll>

      {/* 경력 추가·수정 */}
      <Modal visible={editing !== null} transparent statusBarTranslucent animationType="fade" onRequestClose={() => setEditing(null)}>
        <KeyboardLift>
          <Pressable testID="credit-dialog-backdrop" style={styles.backdrop} onPress={() => setEditing(null)}>
            {editing && (
              <Pressable style={styles.stop} onPress={(e) => e.stopPropagation()}>
                <DialogCard title={t(editing.id ? 'portfolio.creditEditTitle' : 'portfolio.creditAddTitle')}>
                  <View style={styles.form}>
                    <TextField
                      label={t('portfolio.creditTitleLabel')}
                      placeholder={t('portfolio.creditTitlePlaceholder')}
                      value={editing.draft.title}
                      error={editing.errors.title ? t(`portfolio.fieldError.${editing.errors.title}`) : null}
                      onChangeText={(title) =>
                        setEditing({ ...editing, draft: { ...editing.draft, title }, errors: { ...editing.errors, title: undefined } })
                      }
                    />
                    <TextField
                      label={t('portfolio.creditRoleLabel')}
                      placeholder={t('portfolio.creditRolePlaceholder')}
                      value={editing.draft.role}
                      error={editing.errors.role ? t(`portfolio.fieldError.${editing.errors.role}`) : null}
                      onChangeText={(role) =>
                        setEditing({ ...editing, draft: { ...editing.draft, role }, errors: { ...editing.errors, role: undefined } })
                      }
                    />
                    <TextField
                      label={t('portfolio.creditYearLabel')}
                      placeholder={t('portfolio.creditYearPlaceholder')}
                      value={editing.draft.year}
                      keyboardType="number-pad"
                      maxLength={4}
                      error={editing.errors.year ? t(`portfolio.fieldError.${editing.errors.year}`) : null}
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
                      {CREDIT_KINDS.map((kind) => (
                        <Chip
                          key={kind}
                          label={kindLabel(kind)}
                          role="radio"
                          selected={editing.draft.kind === kind}
                          onPress={() =>
                            setEditing({ ...editing, draft: { ...editing.draft, kind }, errors: { ...editing.errors, kind: undefined } })
                          }
                        />
                      ))}
                    </View>
                    {editing.errors.kind && <InlineErrorLine message={t('portfolio.fieldError.required')} />}
                  </View>
                  <DialogButtons
                    cancelLabel={t('common.cancel')}
                    onCancel={() => setEditing(null)}
                    confirmLabel={t('portfolio.save')}
                    onConfirm={saveCredit}
                    busy={busy !== null}
                  />
                </DialogCard>
              </Pressable>
            )}
          </Pressable>
        </KeyboardLift>
      </Modal>
      {dialog}
    </SafeAreaView>
    </GestureHandlerRootView>
  );
}

function Section({ title, right, hint, children }: { title: string; right?: string; hint?: string | null; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionTop}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {right ? <Text style={styles.sectionCount}>{right}</Text> : null}
        </View>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function IconButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: 'edit-2' | 'trash-2';
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.iconBtn, (disabled || pressed) && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <Feather name={icon} size={20} color={palette.iconFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  content: { paddingHorizontal: space.gutter, paddingTop: space[3], paddingBottom: space[10] },
  hero: { paddingBottom: space[5], flexDirection: 'row', alignItems: 'center', gap: space[2] },
  heroText: { flex: 1, gap: space[2] },
  heroMascot: { width: 72, height: 72 },
  heroTitle: { ...type.title2, color: palette.text },
  lead: { ...type.body2, color: palette.textSub },
  section: { borderTopWidth: 1, borderTopColor: palette.border, paddingVertical: space[5], gap: space[3] },
  sectionHead: { gap: space[1] },
  sectionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { ...type.headline, color: palette.text },
  sectionCount: { ...type.caption, color: palette.textMeta },
  hint: { ...type.caption, color: palette.textMeta },
  end: { alignSelf: 'flex-end' },
  start: { alignSelf: 'flex-start' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  shareBody: { flex: 1, ...type.body2, color: palette.textSub },
  textarea: { minHeight: 120, paddingTop: space[3], paddingBottom: space[3] },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    padding: space[4],
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.lg,
    backgroundColor: palette.bg,
  },
  itemBody: { flex: 1, gap: space[1] },
  itemTitle: { ...type.body1Bold, color: palette.text },
  itemSub: { ...type.caption, color: palette.textMeta },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  photoRow: { flexDirection: 'row', gap: space[2] },
  photoTile: { width: 100, height: 130 },
  photoImg: { width: 100, height: 130, borderRadius: radius.md, backgroundColor: palette.bgSoft },
  photoX: {
    position: 'absolute',
    top: space[2],
    right: space[2],
    width: 24,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: palette.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAdd: {
    width: 100,
    height: 130,
    borderRadius: radius.md,
    backgroundColor: palette.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1.5],
  },
  photoAddText: { ...type.captionBold, color: palette.blueDeep },
  url: { ...type.body2Bold, color: palette.text },
  backdrop: { flex: 1, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center', padding: space[5] },
  stop: { width: '100%', alignItems: 'center' },
  form: { gap: space[3], paddingTop: space[2] },
  fieldLabel: { ...type.body2Bold, color: palette.textSub },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
});
