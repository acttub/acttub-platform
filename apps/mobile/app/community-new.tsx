import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { CommunityImageRow } from '@/components/community/community-image-row';
import { KeyboardLift } from '@/components/keyboard-lift';
import { PrimaryButton } from '@/components/ui/buttons';
import { Chip } from '@/components/ui/chip';
import { CtaBar } from '@/components/ui/cta-bar';
import { InlineError, InlineErrorLine } from '@/components/ui/inline-error';
import { NavBackButton, NavHeader } from '@/components/ui/nav-header';
import { SkeletonBlock, SkeletonGroup } from '@/components/ui/skeleton';
import { TextField } from '@/components/ui/text-field';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { useCommunityImages } from '@/hooks/use-community-images';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import {
  BODY_MAX,
  TITLE_MAX,
  bodyCounter,
  canSubmitPost,
  categoryLabel,
  charCount,
  draftsFromPost,
  imageIdsOf,
  imagesState,
  postWriteFailure,
  remainingSlots,
  type CommunityCategory,
  type PostWriteFailure,
} from '@/lib/community';
import { pickCommunityImages } from '@/lib/community-image-picker';
import { translate as t } from '@/lib/i18n';

/**
 * 게시판 글쓰기·글 수정(pen community-new.writing · contact-blocked). `id` 가 있으면 내 글을 고친다(분류는 그대로).
 * 「어떤 글인가요?」 분류 칩 → 제목 TextField → 내용(높이 140, `n / 2,000`) → 아래 고정 바: 연락처 안내 caption + 「올리기」.
 * 내용 아래 사진 줄(5장까지): 고르는 즉시 뒤에서 올리고, 올리는 중이면 「올리기」가 「사진 올리는 중…」으로 꺼진다. 실패한 사진은
 * 빨간 테두리 — 누르면 다시 올리고 x 로 뺀다. 고치는 글은 기존 사진을 보여 주고 빼거나 더할 수 있다.
 * 연락처가 든 글(422 community_contact_info)은 내용 칸을 1.5px danger 로 두고 바로 아래 한 줄, 그 밖의 실패는 버튼 바로 위 한 줄이다.
 */
export default function CommunityNewScreen() {
  const router = useRouter();
  const { confirm, alert, dialog } = useAppDialog();
  const images = useCommunityImages();
  const resetImages = images.reset;
  const { id, category: initialCategory } = useLocalSearchParams<{ id?: string; category?: string }>();
  const editing = !!id;
  const scrollRef = useRef<ScrollView>(null);
  const [categories, setCategories] = useState<CommunityCategory[] | null>(null);
  const [categoriesFailed, setCategoriesFailed] = useState(false);
  const [category, setCategory] = useState<string | null>(initialCategory || null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [loadingPost, setLoadingPost] = useState(editing);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<PostWriteFailure | null>(null);

  const loadCategories = useCallback(async () => {
    setCategoriesFailed(false);
    try {
      const r = await api.communityCategories();
      setCategories(r.categories);
    } catch {
      setCategoriesFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const [postFailed, setPostFailed] = useState(false);
  const loadPost = useCallback(async () => {
    if (!id) return;
    setPostFailed(false);
    setLoadingPost(true);
    try {
      const post = await api.communityPost(id);
      setCategory(post.category_slug);
      setTitle(post.title);
      setBody(post.body);
      resetImages(draftsFromPost(post));
    } catch {
      setPostFailed(true);
    } finally {
      setLoadingPost(false);
    }
  }, [id, resetImages]);

  useEffect(() => {
    void loadPost();
  }, [loadPost]);

  const changeTitle = (v: string) => {
    setTitle(v);
    if (failure) setFailure(null);
  };
  const changeBody = (v: string) => {
    setBody(v);
    if (failure) setFailure(null);
  };

  const photos = imagesState(images.drafts);
  const ready = canSubmitPost({ category, title, body }) && !loadingPost && !postFailed && photos === 'ready';

  const addImages = async () => {
    const result = await pickCommunityImages(remainingSlots(images.drafts));
    if (result.kind === 'blocked') {
      const open = await confirm({
        title: t('communityNew.photoBlockedTitle'),
        message: t('communityNew.photoBlockedBody'),
        confirmLabel: t('communityNew.photoOpenSettings'),
      });
      if (open) void Linking.openSettings();
      return;
    }
    if (result.kind === 'denied') {
      await alert({ title: t('communityNew.photoDeniedTitle'), message: t('communityNew.photoDeniedBody') });
      return;
    }
    if (result.kind === 'picked') {
      images.add(result.uris);
      if (failure === 'too_many_images' || failure === 'invalid_image') setFailure(null);
    }
  };

  const submit = async () => {
    if (!ready || submitting || !category) return;
    setSubmitting(true);
    setFailure(null);
    try {
      if (editing && id) {
        await api.updateCommunityPost(id, { title: title.trim(), body: body.trim(), image_ids: imageIdsOf(images.drafts) });
        logEvent('community_post_update', { id });
        router.back();
      } else {
        const imageIds = imageIdsOf(images.drafts);
        const created = await api.createCommunityPost({ category_slug: category, title: title.trim(), body: body.trim(), image_ids: imageIds });
        logEvent('community_post_create', { category, images: imageIds.length });
        router.replace({ pathname: '/community-post', params: { id: created.id } });
      }
    } catch (e) {
      const reason = postWriteFailure(e);
      setFailure(reason);
      // 키보드가 올라와 있으면 내용 칸 아래 이유 한 줄이 버튼 뒤로 가려 빨간 칸만 보였다 — 그 줄이 보이게 내린다(11/2 폰 QA).
      if (reason === 'contact') setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    } finally {
      setSubmitting(false);
    }
  };

  const dirty = !editing && (title.trim().length > 0 || body.trim().length > 0 || images.drafts.length > 0);
  const back = async () => {
    if (dirty) {
      const ok = await confirm({
        title: t('communityNew.discardTitle'),
        confirmLabel: t('communityNew.discardConfirm'),
        destructive: true,
      });
      if (!ok) return;
    }
    router.back();
  };

  // 안드로이드 뒤로 키도 위 뒤로 버튼과 같이 쓰던 글을 버릴지 묻는다 — 전에는 묻지 않고 입력이 사라졌다(11/2 폰 QA).
  const backRef = useRef(back);
  backRef.current = back;
  useEffect(() => {
    if (!dirty) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      void backRef.current();
      return true;
    });
    return () => sub.remove();
  }, [dirty]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <NavHeader
        title={editing ? t('communityNew.editTitle') : t('communityNew.title')}
        left={<NavBackButton onPress={() => void back()} />}
      />
      <KeyboardLift aboveSafeBottom>
        <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {postFailed ? <InlineError message={t('communityNew.loadFail')} onRetry={() => void loadPost()} /> : null}
          <Text style={styles.label}>{t('communityNew.categoryLabel')}</Text>
          {categoriesFailed ? (
            <InlineError message={t('communityNew.categoryFail')} onRetry={() => void loadCategories()} />
          ) : categories === null ? (
            <SkeletonGroup style={styles.chips}>
              {[56, 92, 92, 56].map((w, i) => (
                <SkeletonBlock key={i} width={w} height={40} radius={radius.full} />
              ))}
            </SkeletonGroup>
          ) : (
            <View style={styles.chips}>
              {categories.map((c) => (
                <Chip
                  key={c.slug}
                  label={categoryLabel(c.slug, c.name)}
                  role="radio"
                  selected={category === c.slug}
                  // 글을 고칠 때는 분류를 바꾸지 않는다(서버 수정은 제목·내용만 받는다).
                  disabled={editing && category !== c.slug}
                  phLabel={`community_new_category_${c.slug}`}
                  onPress={() => {
                    if (!editing) setCategory(c.slug);
                  }}
                />
              ))}
            </View>
          )}

          <Text style={[styles.label, styles.gapTop]}>{t('communityNew.titleLabel')}</Text>
          <TextField
            value={title}
            onChangeText={changeTitle}
            placeholder={t('communityNew.titlePh')}
            accessibilityLabel={t('communityNew.titleLabel')}
            maxLength={TITLE_MAX}
            returnKeyType="next"
          />

          <Text style={[styles.label, styles.gapTop]}>{t('communityNew.bodyLabel')}</Text>
          <TextField
            value={body}
            onChangeText={changeBody}
            placeholder={t('communityNew.bodyPh')}
            accessibilityLabel={t('communityNew.bodyLabel')}
            multiline
            textAlignVertical="top"
            maxLength={BODY_MAX}
            error={failure === 'contact' ? t('communityNew.contactError') : null}
            style={styles.bodyInput}
          />
          <Text style={[styles.counter, charCount(body) > BODY_MAX && styles.counterOver]}>{bodyCounter(body)}</Text>
          <CommunityImageRow
            drafts={images.drafts}
            onAdd={() => void addImages()}
            onRemove={(key) => {
              images.remove(key);
              if (failure === 'too_many_images' || failure === 'invalid_image') setFailure(null);
            }}
            onRetry={images.retry}
          />
          {photos === 'failed' ? <InlineErrorLine message={t('communityNew.imageFailedLine')} /> : null}
        </ScrollView>
        <CtaBar safeBottom={false}>
          {failure && failure !== 'contact' ? <InlineErrorLine message={submitFailMessage(failure)} /> : null}
          <Text style={styles.hint}>{t('communityNew.contactHint')}</Text>
          <PrimaryButton
            label={photos === 'uploading' ? t('communityNew.imagesUploading') : editing ? t('communityNew.save') : t('communityNew.submit')}
            loading={submitting}
            loadingLabel={editing ? t('loadingText.saving') : t('loadingText.uploading')}
            disabled={!ready}
            phLabel={editing ? 'community_edit_submit' : 'community_new_submit'}
            onPress={() => void submit()}
          />
        </CtaBar>
      </KeyboardLift>
      {dialog}
    </SafeAreaView>
  );
}

function submitFailMessage(failure: Exclude<PostWriteFailure, 'contact'>): string {
  switch (failure) {
    case 'too_many_images':
      return t('communityNew.tooManyImages');
    case 'invalid_image':
      return t('communityNew.invalidImage');
    case 'member_only':
      return t('community.memberOnly');
    default:
      return t('communityNew.submitFail');
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  scroll: { flex: 1 },
  body: { paddingHorizontal: space.gutter, paddingTop: space[3], paddingBottom: space[6], gap: space[2] },
  label: { ...type.body2Bold, color: palette.text },
  gapTop: { marginTop: space[1] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  bodyInput: { height: 140, paddingTop: space[3], paddingBottom: space[3] },
  counter: { ...type.caption, color: palette.textMeta, textAlign: 'right' },
  counterOver: { color: palette.danger },
  hint: { ...type.caption, color: palette.textMeta, textAlign: 'center' },
});
