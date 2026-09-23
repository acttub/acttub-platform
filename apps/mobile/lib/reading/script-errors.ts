/**
 * 대본 저장·수정의 422 사유 코드 → 화면 문구(reading.script 「한도」·「예외」). 공통 규칙대로
 * 코드가 글자면 사유로 가르고, 모르는 코드나 다른 오류는 요청 계층의 문구를 그대로 쓴다.
 */
import { ApiError, classifyUnprocessable } from '../api-request.ts';
import { translate as t } from '../i18n.ts';
import { SCRIPT_ERROR_CODES, type ScriptErrorCode } from './types.ts';

const MESSAGE_KEY: Record<ScriptErrorCode, string> = {
  script_too_long: 'reading.errorScriptTooLong',
  script_limit: 'reading.errorScriptLimit',
  no_characters: 'reading.errorNoCharacters',
  invalid_characters: 'reading.errorInvalidCharacters',
  request_fingerprint_mismatch: 'reading.errorFingerprintMismatch',
};

export function isScriptErrorCode(code: unknown): code is ScriptErrorCode {
  return typeof code === 'string' && (SCRIPT_ERROR_CODES as readonly string[]).includes(code);
}

/** 오류(또는 기기 사전 검사의 코드 문자열)에서 사유 코드를 꺼낸다. 아니면 null. */
export function scriptErrorCodeOf(error: unknown): ScriptErrorCode | null {
  if (isScriptErrorCode(error)) return error;
  const kind = classifyUnprocessable(error);
  return kind?.kind === 'reason' && isScriptErrorCode(kind.code) ? kind.code : null;
}

export function scriptErrorMessage(error: unknown): string {
  const code = scriptErrorCodeOf(error);
  if (code) return t(MESSAGE_KEY[code]);
  if (error instanceof ApiError) return error.message;
  return error instanceof Error && error.message ? error.message : t('errors.generic', { status: '?' });
}
