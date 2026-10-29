import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BandGradient } from '@/components/ui/band-gradient';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

// pen S15.3 의 그라데이션 색 — 색 토큰에 없는 값이라 이 카드에만 둔다(디자인 시스템 「의도된 차이」).
const CARD_STOPS = [
  [0, '#EAF2FF'],
  [0.55, '#DDE8FF'],
  [1, '#D9D3FB'],
] as const;
const TILE_STOPS = [
  [0, '#6F9CFA'],
  [1, '#7C6BEF'],
] as const;

/**
 * 설정 맨 위 「Acttub Pro」 카드 — pen S15.3 「설정 · 기본」. 옅은 파랑→보라 가로 그라데이션 위에
 * 왕관 타일 · 제목 · 이용 상태, 아래에 Pro 로 할 수 있는 것 세 칩. 카드 전체를 누르면 Pro 화면으로 간다.
 */
export function SettingsProCard({ sub, onPress }: { sub: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${t('pro.settingsTitle')}, ${sub}`}
      ph-label="settings_pro"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <BandGradient stops={CARD_STOPS} horizontal bands={36} />
      <MaterialCommunityIcons name="star-four-points" size={26} color={palette.onAccent} style={styles.sparkleBig} />
      <MaterialCommunityIcons name="star-four-points" size={12} color={palette.onAccent} style={styles.sparkleSmall} />
      <View style={styles.top}>
        <View style={styles.tile}>
          <BandGradient stops={TILE_STOPS} bands={20} />
          <MaterialCommunityIcons name="crown-outline" size={30} color={palette.onAccent} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title}>{t('pro.settingsTitle')}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {sub}
          </Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={24} color={palette.textMeta} />
      </View>
      <View style={styles.chips}>
        <Chip icon="crown-outline" label={t('pro.settingsChipScripts')} />
        <Chip icon="waveform" label={t('pro.settingsChipVoice')} />
        <Chip icon="creation" label={t('pro.settingsChipMore')} />
      </View>
    </Pressable>
  );
}

function Chip({ icon, label }: { icon: IconName; label: string }) {
  return (
    <View style={styles.chip}>
      <MaterialCommunityIcons name={icon} size={15} color={palette.blueDeep} />
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: palette.onMediaSub,
    padding: space[4],
    gap: space[3],
  },
  pressed: { opacity: 0.9 },
  sparkleBig: { position: 'absolute', top: 18, right: 58, opacity: 0.95 },
  sparkleSmall: { position: 'absolute', top: 50, right: 82, opacity: 0.9 },
  top: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  tile: { width: 56, height: 56, borderRadius: radius.lg, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0, gap: space[1] },
  title: { ...type.title2, color: palette.text },
  sub: { ...type.captionBold, color: palette.textSub },
  // 칩은 글자 길이만큼 넓고, 폭이 모자라면 다음 줄로 내려간다(좁은 폰에서 글자가 잘렸다).
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1.5] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    height: 32,
    borderRadius: radius.full,
    paddingHorizontal: space[3],
    backgroundColor: palette.onMediaSub,
    borderWidth: 1,
    borderColor: palette.onAccent,
  },
  chipText: { ...type.micro, color: palette.text },
});
