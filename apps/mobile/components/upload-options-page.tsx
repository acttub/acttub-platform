import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/buttons';
import { CoachBubble } from '@/components/ui/mascot-bubble';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

export type UploadOptions = { purgeAfterAnalysis: boolean; faceMosaic: boolean };

/** P3.26 올리기 옵션 「이렇게 올려 볼까요?」 — 토글 둘(영상 바로 지우기 · 얼굴 가리기)과 「이대로 올리기」. */
export function UploadOptionsPage({ initial, onDone }: { initial?: UploadOptions | null; onDone: (options: UploadOptions) => void }) {
  // 화면 전체를 덮는 겹침 화면이라 부모의 아래 여백을 못 받는다 — 폰 아래 바만큼 직접 띄운다.
  const insets = useSafeAreaInsets();
  const [purge, setPurge] = useState(initial?.purgeAfterAnalysis ?? true);
  const [mosaic, setMosaic] = useState(initial?.faceMosaic ?? false);
  return (
    <View style={styles.root}>
      <View style={styles.body}>
        <CoachBubble title={t('uploadFlow.optionsBubble')} />
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.text}>
              <Text style={styles.title}>{t('uploadFlow.purge')}</Text>
              <Text style={styles.sub}>{t('uploadFlow.purgeSub')}</Text>
            </View>
            <Switch value={purge} onValueChange={setPurge} accessibilityLabel={t('uploadFlow.purge')} />
          </View>
          <View style={styles.row}>
            <View style={styles.text}>
              <Text style={styles.title}>{t('uploadFlow.mosaic')}</Text>
              <Text style={styles.sub}>{t('uploadFlow.mosaicSub')}</Text>
            </View>
            <Switch value={mosaic} onValueChange={setMosaic} accessibilityLabel={t('uploadFlow.mosaic')} />
          </View>
        </View>
      </View>
      <View style={[styles.bottom, { paddingBottom: 10 + insets.bottom }]}>
        <PrimaryButton label={t('uploadFlow.go')} phLabel="upload_options_go" onPress={() => onDone({ purgeAfterAnalysis: purge, faceMosaic: mosaic })} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: palette.bg },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 24, gap: 24 },
  card: { backgroundColor: palette.bgSubtle, borderRadius: 20, padding: 16, gap: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: '700', lineHeight: 22, color: palette.text },
  sub: { fontSize: 13, fontWeight: '500', lineHeight: 19, color: palette.textMeta },
  bottom: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 10 },
});
