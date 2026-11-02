import Feather from '@expo/vector-icons/Feather';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/buttons';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import type { SplitJobRow as Job } from '@/hooks/use-split-jobs';
import { translate as t } from '@/lib/i18n';

/** pen reading-tab.list-splitting·list-split-failed·empty-splitting. 대본이 없으면 `card` 로 흰 카드에 담는다. 누를 수 없다. */
export function SplitJobRow({ job, card, onDismiss }: { job: Job; card?: boolean; onDismiss: (importId: string) => void }) {
  return (
    <View style={[styles.row, card && styles.card]}>
      <View style={styles.icon}>
        <Feather name={job.failed ? 'alert-circle' : 'file-text'} size={20} color={job.failed ? palette.danger : palette.blue} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>{job.title || t('reading.untitled')}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          <Text style={job.failed ? styles.failedLabel : styles.runningLabel}>{t(job.failed ? 'reading.splitJobFailed' : 'reading.splitJobRunning')}</Text>
          {` · ${job.failed ? t('reading.splitJobFailedHint') : `${job.pct}%`}`}
        </Text>
        {!job.failed && (
          <View style={styles.track} accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: job.pct }}>
            <View style={[styles.fill, { width: `${job.pct}%` }]} />
          </View>
        )}
      </View>
      {job.failed && (
        <Button variant="secondary" size="sm" label={t('reading.splitJobDismiss')} phLabel="reading_split_job_dismiss" onPress={() => onDismiss(job.importId)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3] },
  // 입구 화면의 파란 배경이 위로 4 겹쳐 내려오므로 테두리가 닿지 않게 띄운다.
  card: { marginTop: space[2], backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, paddingHorizontal: space[4] },
  icon: { width: 24, alignItems: 'center' },
  body: { flex: 1, minWidth: 0, gap: space[1] },
  title: { ...type.body1Bold, color: palette.text },
  meta: { ...type.caption, color: palette.textMeta },
  runningLabel: { ...type.captionBold, color: palette.blueDeep },
  failedLabel: { ...type.captionBold, color: palette.danger },
  // 위 간격은 묶음 gap 4 + 4 = 8(pen).
  track: { height: 6, marginTop: space[1], borderRadius: radius.full, backgroundColor: palette.bgSoft, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: palette.blue },
});
