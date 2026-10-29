import { File, Paths } from 'expo-file-system';

import { api } from '@/lib/api';
import { currentLanguage } from '@/lib/i18n';
import type { CloudVoicePreset } from '@/lib/reading/cloud-voice';
import { speechScriptFileName } from '@/lib/reading/tts/speech-file';
import { speechKey } from '@/lib/reading/tts/speech-key';

/** lang 은 그 줄의 말(SOMA-751) — 서버 목소리는 글의 말을 스스로 알아듣고, 여기서는 저장본 열쇠만 가른다. */
export async function synthesizeCloudSpeech(text: string, scriptId: string, preset: string, lang?: string, sessionId?: string): Promise<string> {
  const clean = text.trim();
  const key = speechKey({ text: clean, locale: lang || currentLanguage(), preset, variant: 'remote', steps: 0, speed: 1, source: 'cloud' });
  const out = new File(Paths.cache, speechScriptFileName(scriptId, key));
  if (out.exists) return out.uri;
  const result = await api.synthesizeCloudVoice(clean, preset as CloudVoicePreset, sessionId);
  await File.downloadFileAsync(result.audio_url, out);
  return out.uri;
}
