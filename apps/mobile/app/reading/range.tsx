import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { getCurrent, updateCurrent, type MaskMode } from '@/lib/reading/store';

const MASKS: { key: MaskMode; label: string }[] = [
  { key: 'none', label: '모든 대사 보기' },
  { key: 'mine', label: '내 대사만 가리기' },
  { key: 'all', label: '모든 대사 가리기' },
];

export default function ReadingRange() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const script = getCurrent();
  const lines = script?.lines ?? [];

  // 대사(지문 제외) 줄만 번호와 함께
  const dialogues = useMemo(
    () => lines.map((l, i) => ({ l, i })).filter((x) => x.l.type === 'dialogue'),
    [lines],
  );
  // 장면: 지문을 경계로 끊는다
  const scenes = useMemo(() => {
    const out: { label: string; from: number; to: number }[] = [];
    let curFrom = -1;
    let sceneNo = 0;
    lines.forEach((l, i) => {
      if (l.type === 'direction') {
        if (curFrom >= 0) out.push({ label: `장면 ${sceneNo}`, from: curFrom, to: i - 1 });
        sceneNo += 1;
        curFrom = i;
      } else if (curFrom < 0) {
        curFrom = i;
        sceneNo = 1;
      }
    });
    if (curFrom >= 0) out.push({ label: `장면 ${Math.max(1, sceneNo)}`, from: curFrom, to: lines.length - 1 });
    return out;
  }, [lines]);

  const [tab, setTab] = useState<'line' | 'scene'>('line');
  const [mask, setMask] = useState<MaskMode>(script?.maskMode ?? 'none');
  const [start, setStart] = useState(script?.startIndex ?? 0);
  const [end, setEnd] = useState(script?.endIndex ?? Math.max(0, lines.length - 1));
  const [picking, setPicking] = useState<'start' | 'end'>('start');

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

  // 두 단계: 시작 지점 탭 → 끝 지점 탭. 끝이 시작보다 앞이면 자동으로 뒤바꾼다.
  const pickLine = (i: number) => {
    if (picking === 'start') {
      setStart(i);
      if (i > end) setEnd(i);
      setPicking('end');
    } else {
      if (i < start) {
        setEnd(start);
        setStart(i);
      } else {
        setEnd(i);
      }
      setPicking('start');
    }
  };
  const pickScene = (from: number, to: number) => {
    setStart(from);
    setEnd(to);
    setPicking('start');
  };

  const dlgIn = dialogues.filter((x) => x.i >= start && x.i <= end).length;
  const startLine = lines[start];
  const endLine = lines[end];

  const onStart = async () => {
    await updateCurrent({ startIndex: start, endIndex: end, maskMode: mask, status: 'reading', index: start });
    router.replace('/reading/play');
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.step}>STEP 3 · 시작 위치</Text>
        <Text style={styles.title}>어디부터 어디까지 연습할까요?</Text>
        <Text style={styles.sub}>{script.title} · 대사 {script.dialogueCount}개</Text>

        <View style={styles.tabs}>
          {(['line', 'scene'] as const).map((k) => (
            <Pressable key={k} style={[styles.tab, tab === k && styles.tabOn]} onPress={() => setTab(k)}>
              <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>{k === 'line' ? '대사로 찾기' : '장면으로 찾기'}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.maskRow}>
          {MASKS.map((m) => (
            <Pressable key={m.key} style={[styles.maskChip, mask === m.key && styles.maskChipOn]} onPress={() => setMask(m.key)}>
              <Text style={[styles.maskText, mask === m.key && styles.maskTextOn]}>{m.label}</Text>
            </Pressable>
          ))}
        </View>

        {tab === 'line' && (
          <View style={styles.pickBar}>
            <Text style={styles.pickText}>
              {picking === 'start' ? '① 시작할 대사를 탭하세요' : '② 끝낼 대사를 탭하세요'}
            </Text>
            <Pressable onPress={() => { setStart(0); setEnd(Math.max(0, lines.length - 1)); setPicking('start'); }}>
              <Text style={styles.pickReset}>전체 선택</Text>
            </Pressable>
          </View>
        )}

        {tab === 'line' ? (
          <View style={styles.list}>
            {dialogues.map(({ l, i }, n) => {
              const inRange = i >= start && i <= end;
              const isStart = i === start;
              const isEnd = i === end;
              return (
                <Pressable key={i} style={[styles.row, inRange && styles.rowIn]} onPress={() => pickLine(i)}>
                  <Text style={styles.rowNo}>{n + 1}</Text>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowRole}>{(l as any).role}</Text>
                    <Text style={styles.rowLine} numberOfLines={1}>{(l as any).text}</Text>
                  </View>
                  {isStart && <View style={styles.tag}><Text style={styles.tagText}>시작</Text></View>}
                  {isEnd && !isStart && <View style={[styles.tag, styles.tagEnd]}><Text style={styles.tagText}>끝</Text></View>}
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View style={styles.list}>
            {scenes.map((s, n) => {
              const active = start <= s.from && end >= s.to;
              return (
                <Pressable key={n} style={[styles.sceneRow, active && styles.rowIn]} onPress={() => pickScene(s.from, s.to)}>
                  <View>
                    <Text style={styles.rowRole}>{s.label}</Text>
                    <Text style={styles.rowLine} numberOfLines={1}>
                      {lines[s.from]?.type === 'direction' ? (lines[s.from] as any).text : `${(lines[s.from] as any)?.role ?? ''} …`}
                    </Text>
                  </View>
                  {active && <Feather name="check" size={18} color={palette.blue} />}
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.preview}>
          <Text style={styles.previewText} numberOfLines={1}>
            시작 · {startLine?.type === 'dialogue' ? `${(startLine as any).role} ${(startLine as any).text}` : (startLine as any)?.text}
          </Text>
          <Text style={styles.previewText} numberOfLines={1}>
            끝 · {endLine?.type === 'dialogue' ? `${(endLine as any).role} ${(endLine as any).text}` : (endLine as any)?.text}
          </Text>
        </View>
        <Pressable style={styles.primary} onPress={onStart}>
          <Text style={styles.primaryText}>이 구간 대사 {dlgIn}개 연습하기</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  dim: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 15 },
  content: { padding: 20, gap: 10 },
  step: { color: palette.blue, fontFamily: 'Pretendard-SemiBold', fontSize: 12, letterSpacing: 0.3 },
  title: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 22, marginTop: 2 },
  sub: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, marginBottom: 4 },
  tabs: { flexDirection: 'row', backgroundColor: palette.bgSoft, borderRadius: 10, padding: 3 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8 },
  tabOn: { backgroundColor: palette.card },
  tabText: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  tabTextOn: { color: palette.text },
  maskRow: { flexDirection: 'row', gap: 6, marginTop: 2 },
  maskChip: { flex: 1, alignItems: 'center', backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 999, paddingVertical: 8 },
  maskChipOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  maskText: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 11 },
  maskTextOn: { color: palette.blueDeep },
  pickBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: palette.blueSoft, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginTop: 4 },
  pickText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  pickReset: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  list: { gap: 8, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 12, padding: 14 },
  rowIn: { backgroundColor: palette.blueMist, borderColor: palette.blueLine },
  rowNo: { color: palette.textFaint, fontFamily: 'Pretendard-SemiBold', fontSize: 13, width: 22, textAlign: 'center' },
  rowBody: { flex: 1, gap: 2 },
  rowRole: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 14 },
  rowLine: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13 },
  sceneRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 12, padding: 14 },
  tag: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  tagEnd: { backgroundColor: palette.textDim },
  tagText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopColor: palette.borderSoft, borderTopWidth: 1, backgroundColor: palette.bg, gap: 10 },
  preview: { gap: 2 },
  previewText: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  primary: { backgroundColor: palette.blue, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  primaryText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 16 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
});
