/* eslint-disable */
// @ts-nocheck
/**
 * SPIKE (SOMA-500) — 버리는 화면이다.
 * onnxruntime-react-native 가 Supertonic 모델 4개를 실기기에서 돌려
 * 한국어 한 줄을 합성/재생하는지, 그리고 속도(RTF)/음질을 재는 최소 화면.
 *
 * 라우트: /spike-tts  (딥링크: actingapp:///spike-tts)
 */
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

import { downloadAssets, variantBytes } from '@/lib/spike-tts/assets';
import {
  loadOnnx,
  loadVoiceStyleFromObjects,
  TextToSpeech,
  UnicodeProcessor,
  writeWavFile,
} from '@/lib/spike-tts/helper.native.js';

const SAMPLE = '나는 이 무대에서 처음으로 진심을 말했다. 관객은 모르겠지만, 나는 안다.';

type Variant = 'fp32' | 'int8';
type EP = 'xnnpack' | 'cpu' | 'nnapi';

const MODEL_KEYS = ['durationPredictor', 'textEncoder', 'vectorEstimator', 'vocoder'] as const;

export default function SpikeTts() {
  const [variant, setVariant] = useState<Variant>('fp32');
  const [ep, setEp] = useState<EP>('xnnpack');
  const [threads, setThreads] = useState('4');
  const [steps, setSteps] = useState('8');
  const [preset] = useState('M1');
  const [text, setText] = useState(SAMPLE);
  const [log, setLog] = useState<string[]>(['대기 중. 다운로드 → 로드 → 합성 순서로.']);
  const [busy, setBusy] = useState(false);
  const [metric, setMetric] = useState<string>('');

  const ttsRef = useRef<any>(null);
  const styleRef = useRef<any>(null);
  const playerRef = useRef<any>(null);

  const append = (line: string) => setLog((prev) => [...prev, line]);

  const guard = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      append(`✗ 에러: ${e?.message ?? String(e)}`);
      if (e?.stack) append(String(e.stack).split('\n').slice(0, 3).join('\n'));
    } finally {
      setBusy(false);
    }
  };

  const onDownload = () =>
    guard(async () => {
      const res = await downloadAssets(variant, preset, append);
      (globalThis as any).__spikeAssets = res;
      append('다운로드 완료. 이제 [모델 로드].');
    });

  const onLoad = () =>
    guard(async () => {
      const assets = (globalThis as any).__spikeAssets;
      if (!assets) {
        append('먼저 [다운로드] 를 눌러라.');
        return;
      }
      const nThreads = Math.max(1, parseInt(threads, 10) || 1);
      const options: any = {
        executionProviders: [ep],
        graphOptimizationLevel: 'all',
        intraOpNumThreads: nThreads,
      };
      append(`모델 로드 (ep=${ep}, threads=${nThreads})...`);

      const sessions: any = {};
      for (const k of MODEL_KEYS) {
        const t0 = Date.now();
        try {
          sessions[k] = await loadOnnx(assets.modelPaths[k], options);
        } catch (e: any) {
          append(`  ✗ ${k} 로드 실패(${ep}): ${e?.message ?? e}`);
          append('  → cpu 로 재시도...');
          sessions[k] = await loadOnnx(assets.modelPaths[k], { ...options, executionProviders: ['cpu'] });
        }
        append(`  ✓ ${k} — ${Date.now() - t0}ms`);
      }

      const processor = new UnicodeProcessor(assets.indexer);
      styleRef.current = loadVoiceStyleFromObjects([assets.style]);
      ttsRef.current = new TextToSpeech(
        assets.cfgs,
        processor,
        sessions.durationPredictor,
        sessions.textEncoder,
        sessions.vectorEstimator,
        sessions.vocoder,
      );
      await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
      append(`엔진 준비 완료 (sampleRate=${ttsRef.current.sampleRate}). [합성+재생] 눌러라.`);
    });

  const onSynth = () =>
    guard(async () => {
      const tts = ttsRef.current;
      const style = styleRef.current;
      if (!tts || !style) {
        append('먼저 [모델 로드].');
        return;
      }
      const nSteps = Math.max(1, parseInt(steps, 10) || 8);
      append(`합성 시작 (steps=${nSteps}): "${text.slice(0, 30)}${text.length > 30 ? '…' : ''}"`);

      const t0 = Date.now();
      const { wav, duration } = await tts.call(text, 'ko', style, nSteps, 1.0, 0.1);
      const wallMs = Date.now() - t0;
      const durSec = duration[0];
      const rtf = wallMs / 1000 / durSec;

      const samples = Float32Array.from(wav);
      const bytes = writeWavFile(samples, tts.sampleRate);
      const out = new File(Paths.cache, `spike-${Date.now()}.wav`);
      out.write(bytes);

      setMetric(
        `RTF ${rtf.toFixed(3)} | 합성 ${(wallMs / 1000).toFixed(2)}s | 음성 ${durSec.toFixed(2)}s | ${samples.length}샘플`,
      );
      append(`✓ RTF=${rtf.toFixed(3)}  (합성 ${wallMs}ms / 음성 ${durSec.toFixed(2)}s)  ${rtf < 0.7 ? '👍 통과선' : '⚠ 느림'}`);

      try {
        playerRef.current?.remove?.();
        const player = createAudioPlayer({ uri: out.uri });
        playerRef.current = player;
        player.play();
        append('▶ 재생 중...');
      } catch (e: any) {
        append(`재생 실패: ${e?.message ?? e}`);
      }
    });

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>대본 리딩 ONNX 스파이크 (SOMA-500)</Text>
      <Text style={styles.sub}>총 다운로드: {(variantBytes(variant) / 1024 / 1024).toFixed(0)}MB</Text>

      <Row label="가중치">
        <Seg options={['fp32', 'int8']} value={variant} onChange={(v) => setVariant(v as Variant)} />
      </Row>
      <Row label="실행기(EP)">
        <Seg options={['xnnpack', 'cpu', 'nnapi']} value={ep} onChange={(v) => setEp(v as EP)} />
      </Row>
      <Row label="스레드">
        <TextInput style={styles.num} value={threads} onChangeText={setThreads} keyboardType="number-pad" />
        <Text style={styles.hint}>  되돌리기 단계</Text>
        <TextInput style={styles.num} value={steps} onChangeText={setSteps} keyboardType="number-pad" />
      </Row>

      <TextInput
        style={styles.textArea}
        value={text}
        onChangeText={setText}
        multiline
        placeholder="합성할 한국어 문장"
      />

      <View style={styles.btnRow}>
        <Btn label="1. 다운로드" onPress={onDownload} disabled={busy} />
        <Btn label="2. 모델 로드" onPress={onLoad} disabled={busy} />
        <Btn label="3. 합성+재생" onPress={onSynth} disabled={busy} primary />
      </View>

      {metric ? <Text style={styles.metric}>{metric}</Text> : null}

      <View style={styles.logBox}>
        {log.map((l, i) => (
          <Text key={i} style={styles.logLine}>
            {l}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

function Row({ label, children }: any) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowBody}>{children}</View>
    </View>
  );
}

function Seg({ options, value, onChange }: any) {
  return (
    <View style={styles.seg}>
      {options.map((o: string) => (
        <Pressable
          key={o}
          onPress={() => onChange(o)}
          style={[styles.segItem, value === o && styles.segItemOn]}
        >
          <Text style={[styles.segText, value === o && styles.segTextOn]}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Btn({ label, onPress, disabled, primary }: any) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.btn, primary && styles.btnPrimary, disabled && styles.btnOff]}
    >
      <Text style={[styles.btnText, primary && styles.btnTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d0d0f' },
  content: { padding: 16, paddingTop: 60, gap: 10 },
  h1: { color: '#fff', fontSize: 18, fontWeight: '700' },
  sub: { color: '#9aa', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel: { color: '#ccd', width: 76, fontSize: 13 },
  rowBody: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  seg: { flexDirection: 'row', backgroundColor: '#1c1c22', borderRadius: 8, padding: 2 },
  segItem: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  segItemOn: { backgroundColor: '#3b82f6' },
  segText: { color: '#aab', fontSize: 13 },
  segTextOn: { color: '#fff', fontWeight: '700' },
  num: { backgroundColor: '#1c1c22', color: '#fff', width: 56, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, textAlign: 'center' },
  hint: { color: '#889', fontSize: 12 },
  textArea: { backgroundColor: '#1c1c22', color: '#fff', borderRadius: 8, padding: 12, minHeight: 70, textAlignVertical: 'top' },
  btnRow: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, backgroundColor: '#1c1c22', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  btnPrimary: { backgroundColor: '#22c55e' },
  btnOff: { opacity: 0.4 },
  btnText: { color: '#dde', fontSize: 13, fontWeight: '600' },
  btnTextPrimary: { color: '#052e12' },
  metric: { color: '#fde047', fontSize: 14, fontWeight: '700', paddingVertical: 4 },
  logBox: { backgroundColor: '#000', borderRadius: 8, padding: 10, gap: 2, minHeight: 200 },
  logLine: { color: '#8f8', fontSize: 11, fontFamily: 'monospace' },
});
