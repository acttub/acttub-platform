import { Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '@/components/ui/buttons';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

export function TrackingIntro({ visible, onContinue, onDismiss }: { visible: boolean; onContinue: () => void; onDismiss: () => void }) {
  return <Modal visible={visible} animationType="none" onRequestClose={onContinue} onDismiss={onDismiss}>
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Text style={styles.title}>{t('trackingIntro.title')}</Text>
        <Text style={styles.text}>{t('trackingIntro.body')}</Text>
        <Text style={styles.text}>{t('trackingIntro.optional')}</Text>
      </View>
      <PrimaryButton label={t('trackingIntro.continue')} onPress={onContinue} />
    </SafeAreaView>
  </Modal>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg, padding: 24 },
  body: { flex: 1, justifyContent: 'center', gap: 20 },
  title: { fontSize: 25, fontWeight: '700', color: palette.text },
  text: { fontSize: 17, lineHeight: 27, color: palette.textDim },
});
