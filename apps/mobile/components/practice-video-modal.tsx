import { useVideoPlayer, VideoView } from 'expo-video';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

function Player({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });
  return <VideoView style={styles.video} player={player} nativeControls contentFit="contain" />;
}

/** P10.2 「연습 영상 보기」 — 전체 화면 모달로 한 번 재생한다. */
export function PracticeVideoModal({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  return (
    <Modal visible={Boolean(uri)} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root}>
        <View style={styles.head}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')} hitSlop={12}>
            <Text style={styles.close}>{t('common.close')}</Text>
          </Pressable>
        </View>
        {uri ? <Player uri={uri} /> : null}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  head: { alignItems: 'flex-end', paddingHorizontal: 20, paddingVertical: 12 },
  close: { color: '#fff', fontSize: 16, fontWeight: '700' },
  video: { flex: 1 },
});
