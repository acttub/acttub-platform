import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BandGradient } from '@/components/ui/band-gradient';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const CARD_STOPS = [
  [0, '#EAF2FF'],
  [0.55, '#DDE8FF'],
  [1, '#D9D3FB'],
] as const;
const TILE_STOPS = [
  [0, '#6F9CFA'],
  [1, '#7C6BEF'],
] as const;
const INK = '#1B2350';
const VIOLET = '#6A5BE6';

/**
 * 설정 맨 위 「Acttub Pro」 카드 — 갈아엎기 pen S15.3 「설정 · 기본」(SOMA-923). 옅은 파랑→보라 가로 그라데이션 위에
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
      <MaterialCommunityIcons name="star-four-points" size={26} color="#FFFFFF" style={styles.sparkleBig} />
      <MaterialCommunityIcons name="star-four-points" size={12} color="#FFFFFF" style={styles.sparkleSmall} />
      <View style={styles.top}>
        <View style={styles.tile}>
          <BandGradient stops={TILE_STOPS} bands={20} />
          <MaterialCommunityIcons name="crown-outline" size={30} color="#FFFFFF" />
        </View>
        <View style={styles.text}>
          <Text style={styles.title}>{t('pro.settingsTitle')}</Text>
          <View style={styles.subRow}>
            <Text style={styles.sub} numberOfLines={1}>
              {sub}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={16} color="#4E5A7A" />
          </View>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={24} color={palette.textMuted} />
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
      <MaterialCommunityIcons name={icon} size={15} color={VIOLET} />
      <Text style={styles.chipText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: '#FFFFFFCC',
    padding: 16,
    gap: 14,
    shadowColor: '#5B6BD8',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  pressed: { opacity: 0.9 },
  sparkleBig: { position: 'absolute', top: 18, right: 58, opacity: 0.95 },
  sparkleSmall: { position: 'absolute', top: 50, right: 82, opacity: 0.9 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  tile: { width: 56, height: 56, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontSize: 20, fontWeight: '800', color: INK },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  sub: { flexShrink: 1, fontSize: 13.5, fontWeight: '600', color: '#4E5A7A' },
  chips: { flexDirection: 'row', gap: 6 },
  chip: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 32,
    borderRadius: 999,
    paddingHorizontal: 8,
    backgroundColor: '#FFFFFFB3',
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  chipText: { flexShrink: 1, fontSize: 12, fontWeight: '700', color: INK },
});
