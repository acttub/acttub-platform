import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { speakableText } from '@/lib/reading/parse';
import { getCurrent, updateCurrent } from '@/lib/reading/store';
import * as engine from '@/lib/reading/tts/engine';
import { translate as t } from '@/lib/i18n';

type Mode = 'blank' | 'first' | 'hide' | 'full';
const MODES: { key: Mode; label: string }[] = [
  { key: 'blank', label: t('reading.memorizeBlank') },
  { key: 'first', label: t('reading.memorizeFirst') },
  { key: 'hide', label: t('reading.memorizeHide') },
  { key: 'full', label: t('reading.memorizeShow') },
];

/** 어절 단위로, 짝수번째 실단어를 가린다(결정적). */
function renderMasked(text: string, mode: Mode, hint: boolean): string {
  if (mode === 'full') return text;
  if (mode === 'hide') return '⋯⋯⋯⋯';
  const words = text.split(/(\s+)/); // 공백 유지
  let wi = 0;
  return words
    .map((w) => {
      if (/^\s+$/.test(w) || w.length === 0) return w;
      const mask = wi % 2 === 1; // 홀수번째 어절을 가림
      wi += 1;
      if (!mask) return w;
      if (mode === 'first' || hint) return w[0] + '⎯'.repeat(Math.max(1, w.length - 1));
      return '⎯'.repeat(w.length);
    })
    .join('');
}

export default function ReadingMemorize() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const script = getCurrent();
  const lines = script?.lines ?? [];

  const myLines = useMemo(
    () => lines.map((l, i) => ({ l, i })).filter((x) => x.l.type === 'dialogue' && (script?.myRoles ?? []).includes((x.l as any).role)),
    [lines, script?.myRoles],
  );

  const [pos, setPos] = useState(0);
  const [mode, setMode] = useState<Mode>('blank');
  const [hint, setHint] = useState(false);
  const [memo, setMemo] = useState<number[]>(script?.memorized ?? []);

  if (!script || myLines.length === 0) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.dim}>내 배역 대사가 없어요.</Text>
        <Pressable style={styles.pill} onPress={() => router.replace('/reading')}>
          <Text style={styles.pillText}>내 대본으로</Text>
        </Pressable>
      </View>
    );
  }

  const cur = myLines[Math.min(pos, myLines.length - 1)];
  const gi = cur.i;
  const done = memo.includes(gi);
  const remaining = myLines.filter((x) => !memo.includes(x.i)).length;
  const prevLine = gi - 1 >= 0 ? lines[gi - 1] : undefined;

  const setMode2 = (m: Mode) => {
    setMode(m);
    setHint(false);
  };
  const go = (d: number) => {
    setHint(false);
    setPos((p) => Math.min(Math.max(p + d, 0), myLines.length - 1));
  };
  const nextUnmemorized = () => {
    setHint(false);
    for (let k = 1; k <= myLines.length; k++) {
      const p = (pos + k) % myLines.length;
      if (!memo.includes(myLines[p].i)) {
        setPos(p);
        return;
      }
    }
  };
  const toggleMemo = async (on: boolean) => {
    const nextMemo = on ? Array.from(new Set([...memo, gi])) : memo.filter((x) => x !== gi);
    setMemo(nextMemo);
    await updateCurrent({ memorized: nextMemo });
    if (on) setTimeout(nextUnmemorized, 200);
  };
  const listen = () => {
    void (async () => {
      try {
        await engine.ensureReady(() => {});
        await engine.speak(speakableText((cur.l as any).text));
      } catch {}
    })();
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.head}>{script.title}</Text>
        <Text style={styles.sub}>
          {(script.myRoles[0] ?? t('reading.myRole'))} · 암기 안 한 대사 {remaining}개 · {pos + 1}/{myLines.length}
        </Text>

        <View style={styles.tabs}>
          {MODES.map((m) => (
            <Pressable key={m.key} style={[styles.tab, mode === m.key && styles.tabOn]} onPress={() => setMode2(m.key)}>
              <Text style={[styles.tabText, mode === m.key && styles.tabTextOn]}>{m.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.metaRole}>{(cur.l as any).role} · {pos + 1}번째 대사</Text>
          <View style={[styles.state, done && styles.stateDone]}>
            <Text style={[styles.stateText, done && styles.stateTextDone]}>{done ? t('reading.memorized') : t('reading.memorizing')}</Text>
          </View>
        </View>

        {prevLine && (
          <Text style={styles.context} numberOfLines={2}>
            바로 전 · {prevLine.type === 'dialogue' ? `${(prevLine as any).role} ${(prevLine as any).text}` : (prevLine as any).text}
          </Text>
        )}

        <View style={styles.card}>
          {mode !== 'full' && <Text style={styles.cardHint}>빈칸에 들어갈 말을 떠올려 보세요</Text>}
          <Text style={styles.lineText}>{renderMasked((cur.l as any).text, mode, hint)}</Text>
        </View>

        <View style={styles.aidRow}>
          {(mode === 'blank' || mode === 'hide') && (
            <Pressable style={styles.aid} onPress={() => setHint((h) => !h)}>
              <Feather name="type" size={15} color={palette.blueDeep} />
              <Text style={styles.aidText}>{hint ? t('reading.hintOff') : t('reading.hintFirst')}</Text>
            </Pressable>
          )}
          <Pressable style={styles.aid} onPress={listen}>
            <Feather name="volume-2" size={15} color={palette.blueDeep} />
            <Text style={styles.aidText}>원문 듣기</Text>
          </Pressable>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.markRow}>
          <Pressable style={[styles.mark, styles.markGhost]} onPress={() => toggleMemo(false)}>
            <Text style={styles.markGhostText}>아직 헷갈려요</Text>
          </Pressable>
          <Pressable style={[styles.mark, styles.markPrimary]} onPress={() => toggleMemo(true)}>
            <Feather name="check" size={15} color="#fff" />
            <Text style={styles.markPrimaryText}>외웠어요</Text>
          </Pressable>
        </View>
        <View style={styles.navRow}>
          <Pressable style={styles.nav} onPress={() => go(-1)} disabled={pos === 0}>
            <Feather name="chevron-left" size={18} color={pos === 0 ? palette.checkOff : palette.textDim} />
            <Text style={[styles.navText, pos === 0 && styles.navOff]}>이전</Text>
          </Pressable>
          <Pressable style={styles.nav} onPress={nextUnmemorized}>
            <Text style={styles.navText}>다음 미암기 대사</Text>
            <Feather name="chevron-right" size={18} color={palette.textDim} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  dim: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 15 },
  content: { padding: 20, gap: 12 },
  head: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 18 },
  sub: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13 },
  tabs: { flexDirection: 'row', backgroundColor: palette.bgSoft, borderRadius: 10, padding: 3 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  tabOn: { backgroundColor: palette.card },
  tabText: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  tabTextOn: { color: palette.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  metaRole: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 14 },
  state: { backgroundColor: palette.amberSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  stateDone: { backgroundColor: palette.greenSoft },
  stateText: { color: palette.amber, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  stateTextDone: { color: palette.green },
  context: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: palette.blueMist, borderColor: palette.blueLine, borderWidth: 1, borderRadius: 16, padding: 20, gap: 10, minHeight: 140, justifyContent: 'center' },
  cardHint: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  lineText: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 22, lineHeight: 34 },
  aidRow: { flexDirection: 'row', gap: 8 },
  aid: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: palette.blueSoft, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  aidText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopColor: palette.borderSoft, borderTopWidth: 1, backgroundColor: palette.bg, gap: 10 },
  markRow: { flexDirection: 'row', gap: 10 },
  mark: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 12, paddingVertical: 14 },
  markGhost: { backgroundColor: palette.bgSoft },
  markGhostText: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 15 },
  markPrimary: { backgroundColor: palette.green },
  markPrimaryText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 15 },
  navRow: { flexDirection: 'row', justifyContent: 'space-between' },
  nav: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 4 },
  navText: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  navOff: { color: palette.checkOff },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
});
