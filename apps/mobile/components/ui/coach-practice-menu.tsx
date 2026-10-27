import Feather from '@expo/vector-icons/Feather';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

export type PracticeMenuItem = {
  key: string;
  icon: FeatherName;
  title: string;
  sub?: string;
  danger?: boolean;
  onPress: () => void;
};

/**
 * 연습 묶음 「⋯」 메뉴(pen 「추가 · 연습 ⋯ 메뉴」, SOMA-748) — 가운데 흰 카드, 제목 「이 연습」, 아이콘 줄 목록.
 * 줄을 누르면 메뉴를 닫고 그 일을 한다(여는 쪽이 닫힌 뒤 다음 창을 띄운다).
 */
export function PracticeMenu({
  visible,
  title,
  items,
  onClose,
}: {
  visible: boolean;
  title: string;
  items: PracticeMenuItem[];
  onClose: () => void;
}) {
  return (
    <Modal transparent statusBarTranslucent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button">
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()} accessibilityViewIsModal>
          <Text style={styles.title}>{title}</Text>
          {items.map((item) => (
            <Pressable
              key={item.key}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={item.onPress}
              accessibilityRole="button"
              accessibilityLabel={item.title}>
              <Feather name={item.icon} size={22} color={item.danger ? palette.danger : palette.textSub} />
              <View style={styles.body}>
                <Text style={[styles.rowTitle, item.danger && styles.danger]}>{item.title}</Text>
                {item.sub ? <Text style={styles.sub}>{item.sub}</Text> : null}
              </View>
              <Feather name="chevron-right" size={20} color={palette.iconFaint} />
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360, backgroundColor: palette.bg, borderRadius: 24, paddingHorizontal: 24, paddingTop: 26, paddingBottom: 16 },
  title: { fontSize: 20, fontWeight: '800', color: palette.text, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18 },
  pressed: { opacity: 0.6 },
  body: { flex: 1, gap: 4 },
  rowTitle: { fontSize: 17, fontWeight: '700', color: palette.text },
  danger: { color: palette.danger },
  sub: { fontSize: 13, fontWeight: '500', color: palette.textMeta },
});
