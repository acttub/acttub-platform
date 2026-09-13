import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { speakableText } from '@/lib/reading/parse';
import { getCurrent, isMyRole, updateCurrent } from '@/lib/reading/store';
import * as engine from '@/lib/reading/tts/engine';

type Phase = 'loading' | 'reading' | 'done';

export default function ReadingPlay() {
  const router = useRouter();
  const script = getCurrent();
  const lines = script?.lines ?? [];

  const [phase, setPhase] = useState<Phase>('loading');
  const [progress, setProgress] = useState('음성 준비 중...');
  const [index, setIndex] = useState(script?.status === 'done' ? 0 : script?.index ?? 0);
  const [paused, setPaused] = useState(false);

  const mounted = useRef(true);
  const indexRef = useRef(index);
  indexRef.current = index;

  useEffect(() => {
    mounted.current = true;
    engine
      .ensureReady((line) => mounted.current && setProgress(line))
      .then(() => mounted.current && setPhase('reading'))
      .catch((e) => mounted.current && setProgress(`준비 실패: ${e?.message ?? e}`));
    return () => {
      mounted.current = false;
      engine.stop();
      void updateCurrent({ index: indexRef.current });
    };
  }, []);

  useEffect(() => {
    if (phase !== 'reading' || paused) return;
    const line = lines[index];
    if (!line) {
      setPhase('done');
      void updateCurrent({ status: 'done', index: lines.length });
      return;
    }
    let cancelled = false;
    const advance = () => {
      if (!cancelled && mounted.current) setIndex((i) => i + 1);
    };
    if (line.type === 'direction') {
      const t = setTimeout(advance, 1100);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }
    if (isMyRole(line.role)) return; // 내 차례 — '다음' 대기
    void (async () => {
      try {
        await engine.speak(speakableText(line.text));
      } catch {}
      advance();
    })();
    return () => {
      cancelled = true;
    };
  }, [index, phase, paused]);

  const onNext = () => {
    engine.stop();
    setIndex((i) => i + 1);
  };
  const onTogglePause = () =>
    setPaused((p) => {
      if (!p) engine.stop();
      return !p;
    });
  const onRestart = () => {
    setIndex(0);
    setPaused(false);
    setPhase('reading');
    void updateCurrent({ status: 'reading', index: 0 });
  };

  if (!script) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.dim}>대본이 없어요.</Text>
        <Pressable style={styles.pill} onPress={() => router.replace('/reading')}>
          <Text style={styles.pillText}>내 대본으로</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'loading') {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={palette.blue} />
        <Text style={styles.loadTitle}>{progress}</Text>
        <Text style={styles.loadNote}>처음 한 번만 음성 모델을 내려받아요. 잠시 걸릴 수 있어요.</Text>
      </View>
    );
  }

  if (phase === 'done') {
    return (
      <View style={[styles.root, styles.center]}>
        <View style={styles.doneIcon}>
          <Feather name="check" size={28} color="#fff" />
        </View>
        <Text style={styles.doneTitle}>리딩 완료</Text>
        <Text style={styles.dim}>{script.title} 한 바퀴 끝났어요.</Text>
        <View style={styles.doneRow}>
          <Pressable style={[styles.pill, styles.pillGhost]} onPress={() => router.replace('/reading')}>
            <Text style={styles.pillGhostText}>내 대본으로</Text>
          </Pressable>
          <Pressable style={styles.pill} onPress={onRestart}>
            <Text style={styles.pillText}>다시 하기</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const line = lines[index];
  const prev = lines[index - 1];
  const next = lines[index + 1];
  const myTurn = !!line && line.type === 'dialogue' && isMyRole(line.role);
  const isDirection = !!line && line.type === 'direction';
  const total = lines.length;

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(((index + 1) / total) * 100)}%` }]} />
        </View>
        <Text style={styles.counter}>{Math.min(index + 1, total)} / {total}</Text>
      </View>

      <View style={styles.body}>
        {prev ? (
          <Text style={styles.context} numberOfLines={2}>
            {prev.type === 'dialogue' ? `${prev.role}  ${prev.text}` : prev.text}
          </Text>
        ) : (
          <View style={{ height: 8 }} />
        )}

        <View style={styles.card}>
          {isDirection ? (
            <Text style={styles.direction}>{line.text}</Text>
          ) : (
            <>
              <View style={styles.badgeRow}>
                <View style={[styles.badge, myTurn ? styles.badgeMine : styles.badgeOther]}>
                  <Text style={[styles.badgeText, myTurn ? styles.badgeTextMine : styles.badgeTextOther]}>
                    {line ? `${(line as any).role} · ${myTurn ? '내 차례' : '상대 배역'}` : ''}
                  </Text>
                </View>
                {!myTurn && (
                  <View style={styles.speaking}>
                    <Feather name="volume-2" size={13} color={palette.blue} />
                    <Text style={styles.speakingText}>읽는 중</Text>
                  </View>
                )}
              </View>
              <Text style={styles.lineText}>{line ? (line as any).text : ''}</Text>
            </>
          )}
        </View>

        {next ? (
          <Text style={styles.next} numberOfLines={1}>
            다음 · {next.type === 'dialogue' ? `${next.role}  ${next.text}` : next.text}
          </Text>
        ) : (
          <Text style={styles.next}>다음 · 마지막 대사예요</Text>
        )}

        <Text style={styles.hint}>{myTurn ? '대사를 읽고 다음을 눌러요' : '들으면서 기다리면 자동으로 넘어가요'}</Text>
      </View>

      <View style={styles.controls}>
        <Pressable style={[styles.ctrl, styles.ctrlGhost]} onPress={onTogglePause}>
          <Feather name={paused ? 'play' : 'pause'} size={16} color={palette.textDim} />
          <Text style={styles.ctrlGhostText}>{paused ? '재생' : '일시정지'}</Text>
        </Pressable>
        <Pressable style={[styles.ctrl, styles.ctrlPrimary]} onPress={onNext}>
          <Text style={styles.ctrlPrimaryText}>다음</Text>
          <Feather name="arrow-right" size={16} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 },
  dim: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 15, textAlign: 'center' },
  loadTitle: { color: palette.text, fontFamily: 'Pretendard-SemiBold', fontSize: 16, marginTop: 4, textAlign: 'center' },
  loadNote: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 13, textAlign: 'center' },
  doneIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: palette.green, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 24, marginTop: 4 },
  doneRow: { flexDirection: 'row', gap: 10, marginTop: 10 },

  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 12 },
  progressTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: palette.bgSoft, overflow: 'hidden' },
  progressFill: { height: 5, borderRadius: 3, backgroundColor: palette.blue },
  counter: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },

  body: { flex: 1, justifyContent: 'center', padding: 20, gap: 14 },
  context: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  card: { backgroundColor: palette.blueMist, borderColor: palette.blueLine, borderWidth: 1, borderRadius: 16, padding: 22, gap: 12 },
  direction: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 16, lineHeight: 24, textAlign: 'center', fontStyle: 'italic' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  badgeMine: { backgroundColor: palette.blue },
  badgeOther: { backgroundColor: palette.card },
  badgeText: { fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  badgeTextMine: { color: '#fff' },
  badgeTextOther: { color: palette.textDim },
  speaking: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  speakingText: { color: palette.blue, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  lineText: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 26, lineHeight: 36 },
  next: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 14, textAlign: 'center' },
  hint: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, textAlign: 'center', marginTop: 2 },

  controls: { flexDirection: 'row', gap: 10, padding: 16, borderTopColor: palette.borderSoft, borderTopWidth: 1 },
  ctrl: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 15 },
  ctrlGhost: { backgroundColor: palette.bgSoft },
  ctrlGhostText: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 16 },
  ctrlPrimary: { backgroundColor: palette.blue },
  ctrlPrimaryText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 16 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  pillGhost: { backgroundColor: palette.bgSoft },
  pillGhostText: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
});
