import { useState } from 'react';
import { VideoSourceSheet, type VideoSourceOption } from '@/components/video-source-sheet';
import { logEvent } from '@/lib/analytics';
import { translate as t } from '@/lib/i18n';

type Reason = 'no_video' | 'privacy' | 'other';
export function UploadReasonSheet({ onClose, onTalk, onScript, onRecord }: {
  onClose: () => void; onTalk: () => void; onScript: () => void; onRecord: () => void;
}) {
  const [reason, setReason] = useState<Reason | null>(null);
  const choose = (value: Reason) => {
    void logEvent('practice_upload_decline_reason', { reason: value });
    setReason(value);
  };
  const action = (destination: string, go: () => void) => () => {
    void logEvent('practice_upload_decline_route', { reason: reason ?? 'skipped', destination });
    go();
  };
  const options: VideoSourceOption[] = reason ? [
    { key: 'talk', icon: 'archive', title: t('coachingTab.talk'), sub: t('uploadReason.talkSub'), onPress: action('talk', onTalk) },
    { key: 'script', icon: 'archive', title: t('uploadReason.script'), sub: t('uploadReason.scriptSub'), onPress: action('script', onScript) },
    { key: 'record', icon: 'video', title: t('upload.sourceRecord'), sub: t('uploadReason.recordSub'), onPress: action('record', onRecord) },
  ] : (['no_video', 'privacy', 'other'] as const).map((value) => ({
    key: value, icon: 'video', title: t('uploadReason.' + value), sub: '', onPress: () => choose(value),
  }));
  options.push({ key: 'skip', icon: 'archive', title: t('uploadReason.skip'), sub: '', onPress: action('skip', onClose) });
  return <VideoSourceSheet visible title={t(reason ? 'uploadReason.next' : 'uploadReason.title')}
    sub={t(reason === 'privacy' ? 'uploadReason.privacyHelp' : 'uploadReason.optional')}
    options={options} onClose={action('skip', onClose)} />;
}
