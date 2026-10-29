import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { BlueSwitch } from '@/components/ui/list-rows';
import { CoachBubble } from '@/components/ui/mascot-bubble';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';

export type UploadOptions = { purgeAfterAnalysis: boolean; faceMosaic: boolean };

/** P3.26 올리기 옵션 「이렇게 올려 볼까요?」 — 토글 둘(영상 바로 지우기 · 얼굴 가리기)과 「이대로 올리기」. */
export function UploadOptionsPage({ initial, onDone }: { initial?: UploadOptions | null; onDone: (options: UploadOptions) => void }) {
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
            <BlueSwitch value={purge} onValueChange={setPurge} accessibilityLabel={t('uploadFlow.purge')} />
          </View>
          <View style={styles.row}>
            <View style={styles.text}>
              <Text style={styles.title}>{t('uploadFlow.mosaic')}</Text>
              <Text style={styles.sub}>{t('uploadFlow.mosaicSub')}</Text>
            </View>
            <BlueSwitch value={mosaic} onValueChange={setMosaic} accessibilityLabel={t('uploadFlow.mosaic')} />
          </View>
        </View>
      </View>
      {/* 화면 전체를 덮는 겹침 화면이라 부모의 아래 여백을 못 받는다 — 아래 바가 안전영역만큼 띄운다. */}
      <CtaBar>
        <PrimaryButton label={t('uploadFlow.go')} phLabel="upload_options_go" onPress={() => onDone({ purgeAfterAnalysis: purge, faceMosaic: mosaic })} />
      </CtaBar>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: palette.bg },
  body: { flex: 1, paddingHorizontal: space.gutter, paddingTop: space[4], gap: space[3] },
  card: { borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, padding: space[4], gap: space[5] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  text: { flex: 1, gap: space[1] },
  title: { ...type.body1Bold, color: palette.text },
  sub: { ...type.caption, color: palette.textMeta },
});
