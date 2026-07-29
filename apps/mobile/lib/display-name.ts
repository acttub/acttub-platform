/**
 * 홈 인사말에 쓸 표시 이름.
 *
 * 이름은 가입 마무리(동의) 화면에서만 로컬(SecureStore)에 저장돼서, 이미 동의를 마친 계정으로
 * 새 기기에 로그인하면 저장된 이름이 없어 인사말에 아무것도 안 뜬다.
 * → 저장된 이름이 없으면 로그인 계정 이메일의 앞부분으로 대신 부른다.
 */
export function displayNameFor(
  savedName: string | null | undefined,
  email: string | null | undefined,
): string | null {
  const name = savedName?.trim();
  if (name) return name;

  const local = email?.trim().split('@')[0] ?? '';
  if (!local) return null;
  // 이메일 앞부분에 흔한 구분자·숫자 꼬리를 떼서 부르기 좋은 형태로 만든다.
  const cleaned = local.replace(/[._-]+/g, ' ').replace(/\s*\d+\s*$/, '').trim();
  return cleaned || local;
}
