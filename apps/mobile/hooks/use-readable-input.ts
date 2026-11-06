import { useCallback, useState } from 'react';

import { translate as t } from '@/lib/i18n';
import { sanitizeInput, type InputCharsetMode } from '@/lib/practice/readable-text';

/**
 * 입력칸에서 허용 범위 밖 글자를 입력 단계에서 뺀다(SOMA-922). `hint` 가 있으면 입력칸 아래에 한 줄로 알린다.
 * 한글 조합 중인 입력값은 뺄 게 없으면 그대로 넘긴다.
 */
export function useReadableInput(onChange: (text: string) => void, mode: InputCharsetMode = 'strict') {
  const [stripped, setStripped] = useState(false);
  const onChangeText = useCallback(
    (text: string) => {
      const kept = sanitizeInput(text, mode);
      setStripped(kept !== text);
      onChange(kept);
    },
    [mode, onChange],
  );
  return { onChangeText, hint: stripped ? t('input.stripped') : null };
}
