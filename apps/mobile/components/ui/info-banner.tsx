import Feather from '@expo/vector-icons/Feather';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';

/** pen 「Banner · 알림」 — blue-soft 상자에 아이콘(기본 info)과 제목(body2-bold blue-deep, 없어도 된다)·설명(body2 text-sub). */
export function InfoBanner({
  title,
  body,
  icon = 'info',
  style,
}: {
  title?: string;
  body: string;
  icon?: 'info' | 'wifi-off';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.root, style]}>
      <Feather name={icon} size={20} color={palette.blueDeep} />
      <View style={styles.text}>
        {title ? <Text style={styles.title}>{title}</Text> : null}
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
