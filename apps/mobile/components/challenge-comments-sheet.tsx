import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { COMMENTS, type MockComment } from '@/lib/challenge-mock';
import { translate as t } from '@/lib/i18n';

/**
 * A15.3 댓글 시트 — 영상 위로 올라오는 바텀시트. 예시 댓글 + 하트 토글 + 입력.
 * 보낸 댓글은 이 시트가 열려 있는 동안만 목록에 남는다(서버 없음).
 */
export function ChallengeCommentsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<MockComment[]>(() => [...COMMENTS]);
  const [draft, setDraft] = useState('');

  const toggleLike = (id: string) =>
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, liked: !c.liked } : c)));

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setItems((prev) => [
      { id: `me-${Date.now()}`, name: t('comments.me'), ago: t('comments.justNow'), text, liked: false },
      ...prev,
    ]);
    setDraft('');
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title}>{t('comments.title', { count: 20 + items.length })}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
              <Feather name="x" size={22} color={palette.textDim} />
            </Pressable>
          </View>
          <FlatList
            data={items}
            keyExtractor={(c) => c.id}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <View style={styles.avatar} />
                <View style={styles.body}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name}>{item.name}</Text>
                    <Text style={styles.ago}>{item.ago}</Text>
                  </View>
                  <Text style={styles.text}>{item.text}</Text>
                </View>
                <Pressable onPress={() => toggleLike(item.id)} hitSlop={8} accessibilityRole="button">
                  <Feather name="heart" size={18} color={item.liked ? palette.danger : palette.checkOff} />
                </Pressable>
              </View>
            )}
          />
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder={t('comments.placeholder')}
              placeholderTextColor={palette.textFaint}
              value={draft}
              onChangeText={setDraft}
              returnKeyType="send"
              onSubmitEditing={send}
            />
            <Pressable onPress={send} hitSlop={8} accessibilityRole="button" disabled={!draft.trim()}>
              <Feather name="send" size={22} color={draft.trim() ? palette.blue : palette.checkOff} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    height: '66%',
    backgroundColor: palette.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: palette.border, marginBottom: 10 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  title: { fontSize: 18, fontWeight: '800', color: palette.text },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 20, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: palette.blueSoft },
  body: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  name: { fontSize: 13.5, fontWeight: '800', color: palette.text },
  ago: { fontSize: 11.5, color: palette.textFaint },
  text: { fontSize: 14, color: palette.text, lineHeight: 20 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
  },
  input: {
    flex: 1,
    backgroundColor: palette.bgSoft,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 11,
    fontSize: 14,
    color: palette.text,
  },
});
