import Feather from '@expo/vector-icons/Feather';
import { StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';

/**
 * 코칭 영상의 공개 범위 한 줄(SOMA-962). 「연습 기록을 지워야 남이 안 보냐」는 문의가 있었다 — 코칭 영상은 나만 보고,
 * 다른 배우는 챌린지에 공개로 올린 영상만 본다는 걸 영상 올리는 곳과 연습 기록에서 바로 알린다. 팝업 없이 글 한 줄이다.
 */
export function PrivateVideoNote() {
  return (
    <View style={styles.row} accessible accessibilityLabel={t('upload.privateNote')}>
      <Feather name="lock" size={12} color={palette.textMeta} style={styles.icon} />
      <Text style={styles.text}>{t('upload.privateNote')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[1] },
  icon: { marginTop: 3 },
  text: { flex: 1, ...type.caption, color: palette.textMeta },
});
