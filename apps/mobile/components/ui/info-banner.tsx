import Feather from '@expo/vector-icons/Feather';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';

/** pen 「Banner · 알림」 — blue-soft 상자에 info 아이콘과 제목(body2-bold blue-deep)·설명(body2 text-sub). */
export function InfoBanner({ title, body, style }: { title: string; body: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.root, style]}>
      <Feather name="info" size={20} color={palette.blueDeep} />
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', gap: space[3], padding: space[4], borderRadius: radius.lg, backgroundColor: palette.blueSoft },
  text: { flex: 1, gap: 2 },
  title: { ...type.body2Bold, color: palette.blueDeep },
  body: { ...type.body2, color: palette.textSub },
});
