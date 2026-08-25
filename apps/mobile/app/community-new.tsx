import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useKeyboardHeight } from '@/hooks/use-keyboard-height';

import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import type { CommunityCategory } from '@/lib/community';

/** 글쓰기 — 카테고리 고르고 제목·본문. 익명 여부는 글마다 따로 켠다. */
export default function CommunityNewScreen() {
  const router = useRouter();
  const keyboardHeight = useKeyboardHeight();
  const [categories, setCategories] = useState<CommunityCategory[]>([]);
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .communityCategories()
      .then((r) => {
        setCategories(r.categories);
        setSlug((current) => current || r.categories[0]?.slug || '');
      })
      .catch(() => setError('카테고리를 불러오지 못했어요.'));
  }, []);

  const ready = Boolean(slug && title.trim() && body.trim()) && !busy;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    try {
      const created = await api.createCommunityPost({
        category_slug: slug,
        title: title.trim(),
        body: body.trim(),
        anonymous,
      });
      // 방금 쓴 글로 바로 보낸다. 목록으로 돌아가면 내 글을 다시 찾아야 한다.
      router.replace({ pathname: '/community-post', params: { id: created.id } });
    } catch {
      setError('글을 올리지 못했어요. 잠시 후 다시 시도해주세요.');
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="닫기">
          <Feather name="x" size={22} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle}>글쓰기</Text>
        <Pressable
          onPress={submit}
          disabled={!ready}
          accessibilityRole="button"
          style={[styles.submit, !ready && styles.submitOff]}>
          <Text style={[styles.submitText, !ready && styles.submitTextOff]}>등록</Text>
        </Pressable>
      </View>

      {/* KeyboardAvoidingView 는 안드로이드 edge-to-edge에서 계산이 어긋나 입력이 키보드에
          가려진다 — 키보드 높이를 직접 받아 그만큼만 올린다([[use-keyboard-height]]). */}
      <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipRow}
            contentContainerStyle={styles.chipRowInner}>
            {categories.map((category) => {
              const active = category.slug === slug;
              return (
                <Pressable
                  key={category.slug}
                  onPress={() => setSlug(category.slug)}
                  style={[styles.chip, active && styles.chipActive]}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {category.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            placeholder="제목"
            placeholderTextColor={palette.textFaint}
          />
          <View style={styles.line} />
          <TextInput
            style={styles.bodyInput}
            value={body}
            onChangeText={setBody}
            placeholder={'하고 싶은 이야기를 편하게 적어보세요.\n실기 준비, 학원, 고민 무엇이든 좋아요.'}
            placeholderTextColor={palette.textFaint}
            multiline
            textAlignVertical="top"
          />

          <Pressable
            style={styles.anonRow}
            onPress={() => setAnonymous((was) => !was)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: anonymous }}>
            <Feather
              name={anonymous ? 'check-square' : 'square'}
              size={18}
              color={anonymous ? palette.blue : palette.checkOff}
            />
            <View style={styles.flex}>
              <Text style={[styles.anonText, anonymous && styles.anonTextOn]}>익명으로 쓰기</Text>
              <Text style={styles.anonHint}>이름 대신 익명으로 보여요.</Text>
            </View>
          </Pressable>

          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '800', color: palette.text },
  submit: {
    paddingHorizontal: 16,
    height: 34,
    borderRadius: 17,
    backgroundColor: palette.blue,
    justifyContent: 'center',
  },
  submitOff: { backgroundColor: palette.bgSoft },
  submitText: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  submitTextOff: { color: palette.textFaint },
  form: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 40 },
  chipRow: { flexGrow: 0 },
  chipRowInner: { gap: 8, paddingBottom: 16 },
  chip: {
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: palette.border,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: palette.navy, borderColor: palette.navy },
  chipText: { fontSize: 13, fontWeight: '700', color: palette.textDim },
  chipTextActive: { color: '#FFFFFF' },
  titleInput: { fontSize: 19, fontWeight: '800', color: palette.text, paddingVertical: 8 },
  line: { height: 1, backgroundColor: palette.border, marginVertical: 6 },
  bodyInput: {
    minHeight: 220,
    fontSize: 15,
    fontWeight: '500',
    color: palette.text,
    lineHeight: 23,
    paddingVertical: 8,
  },
  anonRow: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: palette.bgSoft,
  },
  anonText: { fontSize: 14, fontWeight: '700', color: palette.textDim },
  anonTextOn: { color: palette.blue },
  anonHint: { marginTop: 2, fontSize: 12, fontWeight: '500', color: palette.textFaint },
  error: { marginTop: 16, color: palette.danger, fontWeight: '600', fontSize: 13 },
});
