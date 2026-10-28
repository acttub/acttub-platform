import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * 로딩 표시(ActivityIndicator) 대신 쓰는 짧은 문구(SOMA-828).
 * 버튼을 누른 뒤 기다릴 때만 쓴다. 화면을 열 때 데이터를 기다리는 동안에는 아무것도 띄우지 않는다.
 */
export function LoadingText({
  label,
  color,
  style,
}: {
  /** 보여 줄 문구. 없으면 「잠시만요…」. locales 의 loadingText.* 를 쓴다. */
  label?: string;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  const text = label ?? t('loadingText.wait');
  return (
    <Text
      style={[styles.text, color ? { color } : null, style]}
      accessibilityRole="progressbar"
      accessibilityLabel={text}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 14, fontWeight: '500', color: palette.textDim, textAlign: 'center' },
});
