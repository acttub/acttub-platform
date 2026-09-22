import AsyncStorage from '@react-native-async-storage/async-storage';
import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { hasMicPermission, useReadingMic } from '@/hooks/use-reading-mic';
import { detectSttPolicy, useReadingStt } from '@/hooks/use-reading-stt';
import {
  MEMO_MODES,
  maskTokens,
  memorizationHeading,
  memorizationProgress,
  memorizationTargets,
  recite,
  type MemoMode,
  type RecitalOutcome,
  type TargetLine,
} from '@/lib/reading/memorization';
import { createMemorizationSync, type MemorizationSync } from '@/lib/reading/memorization-sync';
import { speakableText } from '@/lib/reading/parse';
import { getCurrent, listMemorization, setLineMemorization } from '@/lib/reading/store';
import type { SttPolicy } from '@/lib/reading/stt-policy';
import { speakWithDevice, stopDeviceVoice } from '@/lib/reading/tts/device-voice';
import * as engine from '@/lib/reading/tts/engine';
import type { LineMemorization } from '@/lib/reading/types';
import type { VadEvent } from '@/lib/reading/vad';
import { assignVoices } from '@/lib/reading/voices';
import { translate as t } from '@/lib/i18n';

/**
 * 암기 화면(R04·R04.1, reading.memorization). 내 배역의 대사 가운데 아직 외웠다고 표시하지 않은 줄을 네 모드(가리고·
 * 빈칸·첫 글자·듣고 따라 하기)로 익히고 "이 대사 외웠어요/아직 헷갈려요"를 남긴다. 표시는 서버에 남아 어느 기기에서나
 * 같다. 완료 화면(R05)에서 sessionId·lineIds 로 들어오면 그 회차의 다시 볼 줄이 대상이고 memorized 여도 열되 표시는
 * 바꾸지 않는다. 회차·녹음을 만들지 않고, 대조는 기기 안에서 끝나며 점수·맞음·틀림을 내지 않는다.
 * "듣고 따라 말하기"를 눌렀을 때만 재생이 끝난 뒤 음성인식을 시작하고, "원문 듣기"만 누르면 마이크를 열지 않는다.
 */
type Recital =
  | { kind: 'idle' }
  | { kind: 'listening' }
  | { kind: 'typing' }
  | { kind: 'retry'; misses: number }
  | { kind: 'passed' };

const SLOW = 0.7;

export default function ReadingMemorize() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ sessionId?: string; lineIds?: string }>();
  const script = getCurrent();
  const mic = useReadingMic();
  const stt = useReadingStt();

  const fromReview = useMemo(() => (params.lineIds ? String(params.lineIds).split(',').filter(Boolean) : null), [params.lineIds]);
  const [roles, setRoles] = useState<string[]>(() => {
    if (!script) return [];
    const last = script.lastSession?.my_character_names ?? [];
    if (last.length > 0) return last;
    if (script.myRoles.length > 0) return script.myRoles;
    return script.characters.length > 0 ? [script.characters[0].name] : [];
  });
  const [entries, setEntries] = useState<LineMemorization[] | null>(null);
  const [includeMemorized, setIncludeMemorized] = useState(false);
  const [mode, setMode] = useState<MemoMode>('hidden');
  const [hint, setHint] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [pos, setPos] = useState(0);
  const [slow, setSlow] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [recital, setRecital] = useState<Recital>({ kind: 'idle' });
  const [typed, setTyped] = useState('');
  const [sttMode, setSttMode] = useState<SttPolicy | null>(null);
  const [pending, setPending] = useState(0);
  const syncRef = useRef<MemorizationSync | null>(null);
  const misses = useRef(0);
  const mounted = useRef(true);

  const voices = useMemo(() => (script ? assignVoices(script.characters, []) : {}), [script]);

  // 서버 목록 한 번 + 기기의 미전송 값 복원(기기 값이 먼저다).
  useEffect(() => {
    mounted.current = true;
    if (!script) return;
    void (async () => {
      const initial = await listMemorization(script.id);
      if (!mounted.current) return;
      const sync = createMemorizationSync({
        storage: AsyncStorage,
        send: setLineMemorization,
        initial,
        onChange: () => {
          if (!mounted.current) return;
          setEntries(sync.entries());
          setPending(sync.pending());
        },
      });
      syncRef.current = sync;
      await sync.restore();
      setEntries(sync.entries());
      setPending(sync.pending());
      void sync.flush();
      if (await hasMicPermission()) setSttMode(await detectSttPolicy());
      else setSttMode({ kind: 'typing', reason: 'denied' });
    })();
    return () => {
      mounted.current = false;
      engine.stop();
      stopDeviceVoice();
      stt.abort();
      void mic.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script?.id]);

  const targets = useMemo(
    () =>
      script && entries
        ? memorizationTargets(script, roles, entries, fromReview ? { onlyLineIds: fromReview } : { includeMemorized })
        : null,
    [script, roles, entries, includeMemorized, fromReview],
  );
  const lines: TargetLine[] = targets?.lines ?? [];
  const cur = lines[Math.min(pos, Math.max(0, lines.length - 1))] ?? null;

  // 줄이 바뀌면 힌트·원문 보기·대조 상태를 되돌린다.
  useEffect(() => {
    setHint(false);
    setRevealed(false);
    setRecital({ kind: 'idle' });
    setTyped('');
    misses.current = 0;
    engine.stop();
    stopDeviceVoice();
    stt.abort();
    void mic.stop();
    setPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.lineId, mode]);

  const stopListening = useCallback(() => {
    stt.abort();
    void mic.stop();
  }, [stt, mic]);

  if (!script) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.dim}>{t('reading.noScript')}</Text>
        <Pressable style={styles.pill} onPress={() => router.replace('/reading')}>
          <Text style={styles.pillText}>{t('reading.toMyScripts')}</Text>
        </Pressable>
      </View>
    );
  }
  if (!targets || !entries) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={palette.blue} />
      </View>
    );
  }

  const goNextUnmemorized = () => {
    if (lines.length === 0) return;
    for (let k = 1; k <= lines.length; k++) {
      const p = (pos + k) % lines.length;
      if (!lines[p].memorized || fromReview) {
        setPos(p);
        return;
      }
    }
  };
  const goNext = () => setPos((p) => Math.min(p + 1, Math.max(0, lines.length - 1)));

  // ── 표시 ──────────────────────────────────────────────────────────────────
  const mark = async (status: 'memorized' | 'not_yet') => {
    if (!cur || !syncRef.current) return;
    await syncRef.current.set(cur.lineId, status);
    if (status === 'memorized' && !includeMemorized && !fromReview) {
      // 대상에서 빠지므로 자리는 그대로 두면 다음 줄이 온다.
      setPos((p) => Math.min(p, Math.max(0, lines.length - 2)));
    }
  };

  // ── 원문 듣기·듣고 따라 하기 ───────────────────────────────────────────────
  const playOriginal = async (): Promise<void> => {
    if (!cur) return;
    const text = speakableText(cur.text);
    const speed = slow ? SLOW : 1.0;
    setPlaying(true);
    try {
      if (engine.isReady()) {
        const preset = voices[script.characters.find((c) => c.name === cur.role)?.id ?? ''] ?? 'F1';
        await engine.speak(text, preset, { speed, scriptId: script.id });
      } else {
        await speakWithDevice(text, 'F1', { rate: speed });
      }
    } catch {
      // 못 읽으면 조용히 끝낸다 — 화면은 글로 남아 있다.
    } finally {
      if (mounted.current) setPlaying(false);
    }
  };

  const startRecital = async () => {
    if (!cur) return;
    if (sttMode?.kind !== 'stt') {
      setRecital({ kind: 'typing' });
      return;
    }
    const lineId = cur.lineId;
    const onEvent = (event: VadEvent) => {
      if (event === 'speech_end' || event === 'timeout') void finishRecital(lineId);
    };
    const ok = stt.start({ onEvent, onInterim: () => undefined });
    if (!ok) {
      setRecital({ kind: 'typing' });
      return;
    }
    setRecital({ kind: 'listening' });
  };

  const finishRecital = async (lineId: string) => {
    const text = await stt.finish();
    stopListening();
    if (!mounted.current || !cur || cur.lineId !== lineId) return;
    applyRecital(recite(text, cur.text, misses.current));
  };

  const applyRecital = (outcome: RecitalOutcome) => {
    if (outcome.kind === 'nothing') {
      setRecital({ kind: 'idle' });
      return;
    }
    if (outcome.kind === 'pass') {
      setRecital({ kind: 'passed' });
      return;
    }
    misses.current = outcome.misses;
    if (outcome.kind === 'advance') {
      // 같은 줄 2회 미달 — 안내 없이 다음 줄. 암기 표시는 바꾸지 않는다.
      goNext();
      return;
    }
    setRecital({ kind: 'retry', misses: outcome.misses });
  };

  const submitTyped = () => {
    if (!cur) return;
    const text = typed.trim();
    if (!text) return;
    setTyped('');
    applyRecital(recite(text, cur.text, misses.current));
  };

  /** "듣고 따라 말하기" — 재생이 끝난 뒤에만 마이크를 연다. 재생 중에 말한 것은 대조되지 않는다. */
  const listenThenRepeat = async () => {
    await playOriginal();
    if (mounted.current) await startRecital();
  };

  // ── 화면 ────────────────────────────────────────────────────────────────────
  const heading = memorizationHeading(roles, lines.filter((l) => !l.memorized).length);
  const progress = memorizationProgress(targets);
  const pickable = script.characters.length > 1 && !fromReview;

  if (lines.length === 0) {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.head}>{script.title}</Text>
          <Text style={styles.sub}>{heading} · {progress}</Text>
          {pickable && <RoleChips roles={roles} characters={script.characters.map((c) => c.name)} onPick={(r) => { setRoles([r]); setPos(0); }} />}
          <View style={styles.emptyBox}>
            <Feather name="check-circle" size={30} color={palette.green} />
            <Text style={styles.emptyTitle}>{t('reading.memoEmpty')}</Text>
            {!fromReview && (
              <Pressable style={styles.aid} onPress={() => setIncludeMemorized(true)}>
                <Text style={styles.aidText}>{t('reading.memoShowMemorized')}</Text>
              </Pressable>
            )}
            <Pressable style={styles.pill} onPress={() => router.replace('/reading/detail')}>
              <Text style={styles.pillText}>{t('reading.memoEmptyGo')}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  const line = cur!;
  const tokens = maskTokens(line.text, mode, { hint: hint || revealed });
  const showFull = revealed;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.head}>{script.title}</Text>
        <Text style={styles.sub}>
          {heading} · {pos + 1}/{lines.length}
        </Text>
        <View style={styles.progressRow}>
          <Text style={styles.progress}>{progress}</Text>
          {pending > 0 && <Text style={styles.pending}>{t('reading.memoSaving', { count: pending })}</Text>}
          {fromReview && <Text style={styles.pending}>{t('reading.memoFromReview')}</Text>}
        </View>
        {pickable && <RoleChips roles={roles} characters={script.characters.map((c) => c.name)} onPick={(r) => { setRoles([r]); setPos(0); }} />}
        {!fromReview && (
          <Pressable style={styles.toggle} onPress={() => { setIncludeMemorized((v) => !v); setPos(0); }}>
            <Feather name={includeMemorized ? 'eye-off' : 'eye'} size={13} color={palette.blueDeep} />
            <Text style={styles.toggleText}>{includeMemorized ? t('reading.memoHideMemorized') : t('reading.memoShowMemorized')}</Text>
          </Pressable>
        )}

        <View style={styles.tabs}>
          {MEMO_MODES.map((m) => (
            <Pressable key={m.value} style={[styles.tab, mode === m.value && styles.tabOn]} onPress={() => setMode(m.value)}>
              <Text style={[styles.tabText, mode === m.value && styles.tabTextOn]}>{m.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.metaRole}>
            {line.role} · {t('reading.lineNo', { n: line.dialogueNo })}
          </Text>
          <View style={[styles.state, line.memorized && styles.stateDone]}>
            <Text style={[styles.stateText, line.memorized && styles.stateTextDone]}>{line.memorized ? t('reading.memorized') : t('reading.memorizing')}</Text>
          </View>
        </View>

        {line.previousPartner && (
          <Text style={styles.context} numberOfLines={2}>
            바로 전 · {line.previousPartner.role} {line.previousPartner.text}
          </Text>
        )}

        <View style={styles.card}>
          {mode !== 'listen' && !showFull && <Text style={styles.cardHint}>빈칸에 들어갈 말을 떠올려 보세요</Text>}
          {mode === 'listen' && <Text style={styles.cardHint}>{playing ? t('reading.memoPlaying') : t('reading.memoModeListen')}</Text>}
          <Text style={styles.lineText}>
            {showFull
              ? line.text
              : tokens.map((tok, i) => (
                  <Text key={i} style={tok.masked ? styles.maskedWord : undefined}>
                    {tok.masked ? `${tok.shown}${'_'.repeat(Math.max(1, Array.from(tok.text).length - Array.from(tok.shown).length))}` : tok.text}
                    {i < tokens.length - 1 ? ' ' : ''}
                  </Text>
                ))}
          </Text>
        </View>

        {/* 보조 동작 — 첫 글자 힌트(가리고·빈칸), 원문 듣기, 원문 보기(일시 해제) */}
        <View style={styles.aidRow}>
          {(mode === 'hidden' || mode === 'blanks') && !showFull && (
            <Pressable style={styles.aid} onPress={() => setHint((h) => !h)}>
              <Feather name="type" size={14} color={palette.blueDeep} />
              <Text style={styles.aidText}>{hint ? t('reading.hintOff') : t('reading.hintFirst')}</Text>
            </Pressable>
          )}
          <Pressable style={[styles.aid, playing && styles.aidBusy]} disabled={playing} onPress={() => void playOriginal()}>
            <Feather name="volume-2" size={14} color={palette.blueDeep} />
            <Text style={styles.aidText}>{mode === 'listen' && playing ? t('reading.memoPlaying') : t('reading.memoListenOriginal')}</Text>
          </Pressable>
          <Pressable style={styles.aid} onPress={() => setRevealed((v) => !v)}>
            <Feather name={showFull ? 'eye-off' : 'eye'} size={14} color={palette.blueDeep} />
            <Text style={styles.aidText}>{showFull ? t('reading.hintOff') : t('reading.showOriginal')}</Text>
          </Pressable>
          {mode === 'listen' && (
            <Pressable style={styles.aid} onPress={() => setSlow((v) => !v)}>
              <Feather name="clock" size={14} color={palette.blueDeep} />
              <Text style={styles.aidText}>{slow ? t('reading.memoSlow') : t('reading.memoNormal')}</Text>
            </Pressable>
          )}
        </View>

        {/* 외워서 말해보기 / 듣고 따라 말하기 */}
        <View style={styles.reciteBox}>
          {recital.kind === 'idle' && (
            <View style={styles.aidRow}>
              {mode === 'listen' ? (
                <Pressable style={styles.recite} disabled={playing} onPress={() => void listenThenRepeat()}>
                  <Feather name="headphones" size={15} color="#fff" />
                  <Text style={styles.reciteText}>{t('reading.memoListenRepeat')}</Text>
                </Pressable>
              ) : (
                <Pressable style={styles.recite} onPress={() => void startRecital()}>
                  <Feather name="mic" size={15} color="#fff" />
                  <Text style={styles.reciteText}>{sttMode?.kind === 'stt' ? t('reading.memoRecite') : t('reading.memoTypeRecite')}</Text>
                </Pressable>
              )}
              {sttMode?.kind === 'stt' && (
                <Pressable style={styles.aid} onPress={() => setRecital({ kind: 'typing' })}>
                  <Feather name="edit-3" size={14} color={palette.blueDeep} />
                  <Text style={styles.aidText}>{t('reading.memoTypeRecite')}</Text>
                </Pressable>
              )}
            </View>
          )}
          {recital.kind === 'listening' && (
            <View style={styles.aidRow}>
              <View style={styles.listening}>
                <View style={styles.dot} />
                <Text style={styles.listeningText}>{t('reading.memoReciting')}</Text>
              </View>
              <Pressable style={styles.aid} onPress={() => void finishRecital(line.lineId)}>
                <Text style={styles.aidText}>{t('reading.compareTyped')}</Text>
              </Pressable>
            </View>
          )}
          {recital.kind === 'typing' && (
            <View style={styles.typeRow}>
              <TextInput
                style={styles.typeInput}
                value={typed}
                onChangeText={setTyped}
                placeholder={t('reading.typePlaceholder')}
                placeholderTextColor={palette.textFaint}
                onSubmitEditing={submitTyped}
                returnKeyType="done"
                autoFocus
              />
              <Pressable style={styles.typeBtn} onPress={submitTyped}>
                <Text style={styles.typeBtnText}>{t('reading.compareTyped')}</Text>
              </Pressable>
            </View>
          )}
          {recital.kind === 'retry' && (
            <View style={styles.aidRow}>
              <Pressable style={styles.recite} onPress={() => void startRecital()}>
                <Feather name="rotate-ccw" size={15} color="#fff" />
                <Text style={styles.reciteText}>{t('reading.memoRetry')}</Text>
              </Pressable>
              <Pressable style={styles.aid} onPress={() => setRevealed(true)}>
                <Feather name="eye" size={14} color={palette.blueDeep} />
                <Text style={styles.aidText}>{t('reading.showOriginal')}</Text>
              </Pressable>
              <Pressable style={styles.aid} onPress={goNext}>
                <Text style={styles.aidText}>{t('reading.skipLine')}</Text>
              </Pressable>
            </View>
          )}
          {recital.kind === 'passed' && (
            <View style={styles.aidRow}>
              <Pressable style={styles.recite} onPress={goNext}>
                <Feather name="arrow-right" size={15} color="#fff" />
                <Text style={styles.reciteText}>{t('reading.memoPassed')}</Text>
              </Pressable>
              <Pressable style={styles.aid} onPress={() => setRecital({ kind: 'idle' })}>
                <Text style={styles.aidText}>{t('reading.memoRetry')}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.markRow}>
          <Pressable style={[styles.mark, styles.markGhost]} onPress={() => void mark('not_yet')}>
            <Text style={styles.markGhostText}>{t('reading.memoMarkNotYet')}</Text>
          </Pressable>
          <Pressable style={[styles.mark, styles.markPrimary]} onPress={() => void mark('memorized')}>
            <Feather name="check" size={15} color="#fff" />
            <Text style={styles.markPrimaryText}>{t('reading.memoMarkDone')}</Text>
          </Pressable>
        </View>
        <View style={styles.navRow}>
          <Pressable style={styles.nav} onPress={() => setPos((p) => Math.max(0, p - 1))} disabled={pos === 0}>
            <Feather name="chevron-left" size={18} color={pos === 0 ? palette.checkOff : palette.textDim} />
            <Text style={[styles.navText, pos === 0 && styles.navOff]}>{t('reading.memoPrev')}</Text>
          </Pressable>
          <Pressable style={styles.nav} onPress={goNextUnmemorized}>
            <Text style={styles.navText}>{t('reading.memoNext')}</Text>
            <Feather name="chevron-right" size={18} color={palette.textDim} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function RoleChips({ roles, characters, onPick }: { roles: string[]; characters: string[]; onPick: (role: string) => void }) {
  return (
    <View style={styles.roleRow}>
      <Text style={styles.roleLabel}>{t('reading.memoPickRole')}</Text>
      {characters.map((name) => {
        const on = roles.includes(name);
        return (
          <Pressable key={name} style={[styles.roleChip, on && styles.roleChipOn]} onPress={() => onPick(name)}>
            <Text style={[styles.roleChipText, on && styles.roleChipTextOn]}>{name}</Text>
          </Pressable>
        );
      })}
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
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  progress: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  pending: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 11 },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  roleLabel: { color: palette.textFaint, fontFamily: 'Pretendard-SemiBold', fontSize: 12, marginRight: 2 },
  roleChip: { backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  roleChipOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  roleChipText: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  roleChipTextOn: { color: palette.blueDeep },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
  toggleText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  tabs: { flexDirection: 'row', backgroundColor: palette.bgSoft, borderRadius: 10, padding: 3 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  tabOn: { backgroundColor: palette.card },
  tabText: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 11 },
  tabTextOn: { color: palette.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  metaRole: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 14 },
  state: { backgroundColor: palette.amberSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  stateDone: { backgroundColor: palette.greenSoft },
  stateText: { color: palette.amber, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  stateTextDone: { color: palette.green, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  context: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: palette.blueMist, borderColor: palette.blueLine, borderWidth: 1, borderRadius: 16, padding: 20, gap: 10, minHeight: 140, justifyContent: 'center' },
  cardHint: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  lineText: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 22, lineHeight: 34 },
  maskedWord: { color: palette.textFaint },
  aidRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  aid: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: palette.blueSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  aidBusy: { opacity: 0.5 },
  aidText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  reciteBox: { gap: 8, marginTop: 4 },
  recite: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  reciteText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  listening: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.bgSubtle, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.danger },
  listeningText: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  typeRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  typeInput: { flex: 1, backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: palette.text, fontFamily: 'Pretendard', fontSize: 15 },
  typeBtn: { backgroundColor: palette.blue, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  typeBtnText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  emptyBox: { alignItems: 'center', gap: 10, paddingVertical: 48 },
  emptyTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 17 },
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
