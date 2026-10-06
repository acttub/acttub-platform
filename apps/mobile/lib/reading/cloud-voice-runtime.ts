import { File, Paths } from 'expo-file-system';

import { api } from '@/lib/api';
import { currentLanguage } from '@/lib/i18n';
import type { CloudVoicePreset } from '@/lib/reading/cloud-voice';
import { speechScriptFileName } from '@/lib/reading/tts/speech-file';
import { speechKey } from '@/lib/reading/tts/speech-key';

export async function synthesizeCloudSpeech(text: string, scriptId: string, preset: string): Promise<string> {
  const clean = text.trim();
  const key = speechKey({ text: clean, locale: currentLanguage(), preset, variant: 'remote', steps: 0, speed: 1, source: 'cloud' });
  const out = new File(Paths.cache, speechScriptFileName(scriptId, key));
  if (out.exists) return out.uri;
  const result = await api.synthesizeCloudVoice(clean, preset as CloudVoicePreset);
  await File.downloadFileAsync(result.audio_url, out);
  return out.uri;
}
