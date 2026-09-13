import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { speakableText } from '@/lib/reading/parse';
import { getCurrent, isMyRole, updateCurrent } from '@/lib/reading/store';
import * as engine from '@/lib/reading/tts/engine';
import { useMicAutoAdvance } from '@/lib/reading/use-stt';

type Phase = 'loading' | 'reading' | 'done';

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function ReadingPlay() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const script = getCurrent();
  const lines = script?.lines ?? [];
  const start = script?.startIndex ?? 0;
  const end = script?.endIndex ?? Math.max(0, lines.length - 1);
  const maskMode = script?.maskMode ?? 'none';

  const [phase, setPhase] = useState<Phase>('loading');
  const [progress, setProgress] = useState('음성 준비 중...');
  const [index, setIndex] = useState(() => {
    const at = script?.status === 'done' ? start : script?.index ?? start;
    return Math.min(Math.max(at, start), end);
  });
  const [paused, setPaused] = useState(false);
  const [revealAll, setRevealAll] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [heard, setHeard] = useState('');

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

  // 타이머
  useEffect(() => {
    if (phase !== 'reading' || paused) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [phase, paused]);

  const line = lines[index];
  const myTurn = !!line && line.type === 'dialogue' && isMyRole((line as any).role);

  const advance = () => {
    if (mounted.current) setIndex((i) => i + 1);
  };

  // 내 차례 + 재생중 + 안멈춤이면 마이크로 듣고, 말 끝나면 자동 다음. 들은 말은 화면에 표시.
  useMicAutoAdvance(
    phase === 'reading' && !paused && myTurn,
    () => {
      engine.stop();
      advance();
    },
    setHeard,
  );

  // 줄이 바뀌면 이전에 들은 말은 지운다.
  useEffect(() => {
    setHeard('');
  }, [index]);

  // 대사 진행: 상대 배역이면 TTS, 지문은 잠깐, 내 배역이면 마이크 대기
  useEffect(() => {
    if (phase !== 'reading' || paused) return;
    if (index > end || !lines[index]) {
      setPhase('done');
      void updateCurrent({ status: 'done', index: end + 1 });
      return;
    }
    const cur = lines[index];
    let cancelled = false;
    const go = () => {
      if (!cancelled && mounted.current) setIndex((i) => i + 1);
    };
    if (cur.type === 'direction') {
      const t = setTimeout(go, 1000);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }
    if (isMyRole(cur.role)) return; // 내 차례 — 마이크(useMicAutoAdvance) 또는 '다음'
    void (async () => {
      try {
        await engine.speak(speakableText(cur.text));
      } catch {}
      go();
    })();
    return () => {
      cancelled = true;
    };
  }, [index, phase, paused, end]);

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
    setIndex(start);
    setPaused(false);
    setElapsed(0);
    setPhase('reading');
    void updateCurrent({ status: 'reading', index: start });
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
        <Text style={styles.dim}>{script.title} · {mmss(elapsed)} 동안 연습했어요.</Text>
        <View style={styles.doneRow}>
          <Pressable style={[styles.pill, styles.pillGhost]} onPress={() => router.replace('/reading')}>
            <Text style={styles.pillGhostText}>내 대본으로</Text>
          </Pressable>
          <Pressable style={styles.pill} onPress={onRestart}>
            <Text style={styles.pillText}>다시 하기</Text>
          </Pressable>
        </View>
        <Pressable style={styles.memorizeLink} onPress={() => router.replace('/reading/memorize')}>
          <Feather name="edit-3" size={15} color={palette.blueDeep} />
          <Text style={styles.memorizeLinkText}>안 외워진 대사 암기 연습</Text>
        </Pressable>
      </View>
    );
  }

  const prev = index - 1 >= start ? lines[index - 1] : undefined;
  const next = index + 1 <= end ? lines[index + 1] : undefined;
  const isDirection = !!line && line.type === 'direction';
  const pos = index - start + 1;
  const total = end - start + 1;

  const masked =
    !revealAll &&
    !isDirection &&
    (maskMode === 'all' || (maskMode === 'mine' && myTurn));
  const shownText = line ? (isDirection ? line.text : masked ? '⋯⋯⋯⋯' : (line as any).text) : '';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* 상단바: 나가기 · 모든 대사 보기 · 진행/타이머 */}
      <View style={styles.topBar}>
        <Pressable style={styles.exitBtn} onPress={() => router.replace('/reading')} hitSlop={8}>
          <Feather name="x" size={20} color={palette.textDim} />
          <Text style={styles.exitText}>나가기</Text>
        </Pressable>
        {maskMode !== 'none' && (
          <Pressable style={[styles.revealBtn, revealAll && styles.revealOn]} onPress={() => setRevealAll((v) => !v)}>
            <Feather name={revealAll ? 'eye' : 'eye-off'} size={13} color={revealAll ? palette.blue : palette.textMuted} />
            <Text style={[styles.revealText, revealAll && styles.revealTextOn]}>모든 대사 보기</Text>
          </Pressable>
        )}
        <Text style={styles.counter}>{Math.min(pos, total)} / {total} · {mmss(elapsed)}</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round((pos / total) * 100)}%` }]} />
      </View>

      <View style={styles.body}>
        {prev ? (
          <Text style={styles.context} numberOfLines={2}>
            {prev.type === 'dialogue' ? `${prev.role}  ${prev.text}` : prev.text}
          </Text>
        ) : (
          <View style={{ height: 8 }} />
        )}

        {isDirection ? (
          <View style={styles.directionCard}>
            <Text style={styles.direction}>{line.text}</Text>
          </View>
        ) : (
          <View style={[styles.card, myTurn ? styles.cardMine : styles.cardOther]}>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, myTurn ? styles.badgeMine : styles.badgeOther]}>
                <Text style={styles.badgeText}>{line ? (line as any).role : ''}</Text>
              </View>
              {myTurn ? (
                <View style={styles.listening}>
                  <View style={styles.dot} />
                  <Text style={styles.listeningText}>듣고 있어요</Text>
                </View>
              ) : (
                <Feather name="volume-2" size={18} color="rgba(255,255,255,0.7)" />
              )}
            </View>
            <Text style={styles.lineText}>{shownText}</Text>
          </View>
        )}

        {next ? (
          <Text style={styles.next} numberOfLines={1}>
            다음 · {next.type === 'dialogue' ? `${next.role}  ${next.text}` : next.text}
          </Text>
        ) : (
          <Text style={styles.next}>다음 · 마지막 대사예요</Text>
        )}

        {myTurn && heard ? (
          <View style={styles.heardBox}>
            <Feather name="mic" size={14} color={palette.blue} />
            <Text style={styles.heardText} numberOfLines={2}>{heard}</Text>
          </View>
        ) : null}

        <Text style={styles.hint}>
          {myTurn ? '대사를 읽으면 자동으로 넘어가요 (안 되면 다음)' : '상대가 읽는 중 · 끝나면 내 차례'}
        </Text>
      </View>

      <View style={[styles.controls, { paddingBottom: insets.bottom + 12 }]}>
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

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  exitBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  exitText: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  revealBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: palette.bgSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  revealOn: { backgroundColor: palette.blueSoft },
  revealText: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  revealTextOn: { color: palette.blue },
  counter: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  progressTrack: { height: 4, backgroundColor: palette.bgSoft, marginHorizontal: 16, borderRadius: 2, overflow: 'hidden', marginTop: 8 },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: palette.blue },

  body: { flex: 1, justifyContent: 'center', padding: 20, gap: 16 },
  context: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  directionCard: { backgroundColor: palette.bgSubtle, borderRadius: 16, padding: 20 },
  direction: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 16, lineHeight: 24, textAlign: 'center', fontStyle: 'italic' },
  card: { borderRadius: 20, padding: 24, gap: 16 },
  cardOther: { backgroundColor: palette.navy },
  cardMine: { backgroundColor: palette.blueDeep },
  badgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: 'rgba(255,255,255,0.16)' },
  badgeMine: {},
  badgeOther: {},
  badgeText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  listening: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#7DD3FC' },
  listeningText: { color: '#BAE6FD', fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  lineText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 26, lineHeight: 37 },
  next: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 14, textAlign: 'center' },
  heardBox: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', maxWidth: '92%', backgroundColor: palette.blueSoft, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  heardText: { flex: 1, color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  hint: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, textAlign: 'center', marginTop: 2 },

  controls: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, borderTopColor: palette.borderSoft, borderTopWidth: 1 },
  ctrl: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 15 },
  ctrlGhost: { backgroundColor: palette.bgSoft },
  ctrlGhostText: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 16 },
  ctrlPrimary: { backgroundColor: palette.blue },
  ctrlPrimaryText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 16 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  pillGhost: { backgroundColor: palette.bgSoft },
  pillGhostText: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  memorizeLink: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.blueSoft, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, marginTop: 6 },
  memorizeLinkText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
});
