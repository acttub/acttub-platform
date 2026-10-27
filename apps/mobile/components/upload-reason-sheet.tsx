import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ChoiceCard } from '@/components/choice-card';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';
import { logEvent } from '@/lib/analytics';
import { translate as t } from '@/lib/i18n';

export type UploadHesitation = 'face' | 'short' | 'later';
const ITEMS: UploadHesitation[] = ['face', 'short', 'later'];
const KEYS = { face: 'hFace', short: 'hShort', later: 'hLater' } as const;

/**
 * P3.25 올리기 망설임 — 전체 화면 페이지. 이유 셋 중 하나를 고르고(기본 선택 없음) 「다음」을 누르면 그 길로 간다.
 * 얼굴·영상 걱정 → 올리기 옵션(P3.26), 길게 찍기 부담 → 10초 촬영, 지금은 못 찍어요 → 나중에 알림.
 */
export function UploadReasonSheet({ onFace, onShort, onLater }: {
  onFace: () => void; onShort: () => void; onLater: () => void;
}) {
  const [choice, setChoice] = useState<UploadHesitation | null>(null);
  const next = () => {
    if (!choice) return;
    void logEvent('practice_upload_decline_route', { reason: choice, destination: choice });
    (choice === 'face' ? onFace : choice === 'short' ? onShort : onLater)();
  };
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>{t('uploadFlow.hesitateTitle')}</Text>
        <Text style={styles.sub}>{t('uploadFlow.hesitateSub')}</Text>
        <View style={styles.choices}>
          {ITEMS.map((item) => (
            <ChoiceCard
              key={item}
              title={t(`uploadFlow.${KEYS[item]}`)}
              sub={t(`uploadFlow.${KEYS[item]}Sub`)}
              selected={choice === item}
              phLabel={`upload_hesitate_${item}`}
              onPress={() => {
                void logEvent('practice_upload_decline_reason', { reason: item });
                setChoice(item);
              }}
            />
          ))}
        </View>
      </ScrollView>
      {/* 화면 전체를 덮는 겹침 화면이라 부모의 아래 여백을 못 받는다 — 아래 바가 안전영역만큼 띄운다. */}
      <CtaBar>
        <PrimaryButton label={t('uploadFlow.next')} phLabel="upload_hesitate_next" disabled={!choice} onPress={next} />
      </CtaBar>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: palette.bg },
  body: { paddingHorizontal: space.gutter, paddingTop: space[6], paddingBottom: space[6] },
  title: { ...type.title2, color: palette.text },
  sub: { ...type.caption, color: palette.textMeta, marginTop: space[1] },
  choices: { gap: space[3], marginTop: space[5] },
});
