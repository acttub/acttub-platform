import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
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
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import {
  BODY_MAX,
  TITLE_MAX,
  bodyCounter,
  canSubmitPost,
  charCount,
  postWriteFailure,
  type CommunityCategory,
} from '@/lib/community';
import { translate as t } from '@/lib/i18n';

/**
 * 게시판 글쓰기·글 수정(pen community-new.writing · contact-blocked). `id` 가 있으면 내 글을 고친다(분류는 그대로).
 * 「어떤 글인가요?」 분류 칩 → 제목 TextField → 내용(높이 140, `n / 2,000`) → 아래 고정 바: 연락처 안내 caption + 「올리기」.
 * 사진은 없다(서버에 이미지 칸이 없다). 연락처가 든 글(422 community_contact_info)은 내용 칸을 1.5px danger 로 두고 바로 아래 한 줄,
 * 그 밖의 실패는 버튼 바로 위 한 줄이다.
 */
export default function CommunityNewScreen() {
  const router = useRouter();
  const { confirm, dialog } = useAppDialog();
  const { id, category: initialCategory } = useLocalSearchParams<{ id?: string; category?: string }>();
  const editing = !!id;
  const [categories, setCategories] = useState<CommunityCategory[] | null>(null);
  const [categoriesFailed, setCategoriesFailed] = useState(false);
  const [category, setCategory] = useState<string | null>(initialCategory || null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [loadingPost, setLoadingPost] = useState(editing);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<'contact' | 'other' | null>(null);

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
    } catch {
      setPostFailed(true);
    } finally {
      setLoadingPost(false);
    }
  }, [id]);

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

  const ready = canSubmitPost({ category, title, body }) && !loadingPost && !postFailed;

  const submit = async () => {
    if (!ready || submitting || !category) return;
    setSubmitting(true);
    setFailure(null);
    try {
      if (editing && id) {
        await api.updateCommunityPost(id, { title: title.trim(), body: body.trim() });
        void logEvent('community_post_update', { id });
        router.back();
      } else {
        const created = await api.createCommunityPost({ category_slug: category, title: title.trim(), body: body.trim() });
        void logEvent('community_post_create', { category });
        router.replace({ pathname: '/community-post', params: { id: created.id } });
      }
    } catch (e) {
      setFailure(postWriteFailure(e));
    } finally {
      setSubmitting(false);
    }
  };

  const back = async () => {
    const dirty = !editing && (title.trim().length > 0 || body.trim().length > 0);
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

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <NavHeader
        title={editing ? t('communityNew.editTitle') : t('communityNew.title')}
        left={<NavBackButton onPress={() => void back()} />}
      />
      <KeyboardLift aboveSafeBottom>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
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
                  label={c.name}
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
        </ScrollView>
        <CtaBar safeBottom={false}>
          {failure === 'other' ? <InlineErrorLine message={t('communityNew.submitFail')} /> : null}
          <Text style={styles.hint}>{t('communityNew.contactHint')}</Text>
          <PrimaryButton
            label={editing ? t('communityNew.save') : t('communityNew.submit')}
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
