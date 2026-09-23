import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';

import { useAppDialog } from '@/components/app-dialog';
import { useAuth } from '@/lib/auth';
import { translate as t } from '@/lib/i18n';
import { migrateLegacyArchive, readLegacyArchive } from '@/lib/library/legacy-archive';
import { enqueueLibraryUpload, flushLibraryUploads } from '@/lib/library/library-runner';
import { newRequestId } from '@/lib/request-id';

/**
 * 옛 앱의 기기 보관함(계정 구분 없는 목록)을 1.0.0 첫 실행 때 "이 영상들을 지금 계정의 보관함으로 옮길까요?"로 한 번
 * 묻는다(practice.record). 확인하면 업로드 대기 큐에 넣고 옛 목록을 비우며, 나중에를 고르면 기기에 남겨 다음 실행에 다시
 * 묻는다. 탭 레이아웃(게이트를 지난 뒤)에 붙어 실행마다 한 번만 묻는다.
 */
let askedThisRun = false;

export function LegacyArchivePrompt() {
  const { user } = useAuth();
  const { confirm, alert, dialog } = useAppDialog();
  const owner = user?.id ?? null;

  useEffect(() => {
    if (!owner || askedThisRun) return;
    askedThisRun = true;
    void (async () => {
      const list = await readLegacyArchive(AsyncStorage);
      if (list.length === 0) return;
      const ok = await confirm({
        title: t('archive.legacyTitle'),
        message: t('archive.legacyBody', { count: list.length }),
        confirmLabel: t('archive.legacyConfirm'),
        cancelLabel: t('archive.legacyLater'),
      });
      if (!ok) return;
      const { moved } = await migrateLegacyArchive({ storage: AsyncStorage, owner, enqueue: enqueueLibraryUpload, newRequestId });
      void flushLibraryUploads(owner);
      void alert({ title: t('archive.title'), message: t('archive.legacyMoved', { count: moved }) });
    })();
  }, [owner, confirm, alert]);

  return dialog;
}
