import type { ConsentDocument, TokenPair } from './api.ts';
import { ApiError, conflictProviders } from './api-request.ts';
import { translate } from './i18n.ts';

/**
 * 로그인 화면의 순수 로직(account.login).
 *
 * 버튼 순서는 서버 응답 순서가 아니라 여기 적힌 순서다. 서버 목록은 "켜져 있는가"만 말한다.
 */
export const LOGIN_PROVIDERS = ['google', 'apple', 'kakao', 'naver'] as const;

export type LoginProvider = (typeof LOGIN_PROVIDERS)[number];

export function isLoginProvider(value: unknown): value is LoginProvider {
  return (LOGIN_PROVIDERS as readonly unknown[]).includes(value);
}

/**
 * 버튼으로 그릴 제공자 = 서버가 켠 것 ∩ 이 빌드가 지원하는 것.
 *
 * 서버가 켰어도 SDK가 없는 빌드에서는 그리지 않는다 — 눌러서 실패하는 버튼을 만들지 않기
 * 위해서다. 안드로이드에서 애플을 빼는 것은 앱의 몫이다(서버는 켜져 있는 것을 모두 알려 준다).
 */
export function visibleLoginProviders(input: {
  enabled: readonly unknown[];
  supported: readonly LoginProvider[];
  platform: string;
}): LoginProvider[] {
  return LOGIN_PROVIDERS.filter(
    (provider) =>
      input.enabled.includes(provider) &&
      input.supported.includes(provider) &&
      !(provider === 'apple' && input.platform !== 'ios'),
  );
}

/** 마지막에 쓴 제공자가 지금 버튼으로 나와 있을 때만 강조한다. */
export function highlightedProvider(
  visible: readonly LoginProvider[],
  lastProvider: LoginProvider | null,
): LoginProvider | null {
  return lastProvider !== null && visible.includes(lastProvider) ? lastProvider : null;
}

/**
 * 제공자가 준, 서버에 넘길 자격 값. 제공자마다 모양이 달라 id_token 하나에 묶지 않는다.
 *
 * - 구글·카카오: 제공자가 발급한 ID 토큰.
 * - 애플: ID 토큰과 authorization code. code는 5분 동안 한 번만 쓸 수 있어 로그인 요청에
 *   바로 실어 보낸다(서버가 애플 토큰으로 바꿔 탈퇴 때 폐기에 쓴다).
 * - 네이버: ID 토큰이 아니라 브라우저 인증 세션(PKCE S256 + state)으로 받은 authorization
 *   code와 그 code verifier·redirect uri. 교환은 서버가 client secret으로 한다 — 비밀은
 *   앱에 두지 않는다.
 */
type WithDisplayName = {
  /** 제공자가 준 이름. 저장하지 않고 프로필 화면의 이름 칸을 미리 채우는 데만 쓴다. */
  displayName?: string | null;
};

export type ProviderCredential =
  | ({ provider: 'google' | 'kakao'; idToken: string } & WithDisplayName)
  | ({
      provider: 'apple';
      idToken: string;
      authorizationCode: string | null | undefined;
    } & WithDisplayName)
  | ({
      provider: 'naver';
      authorizationCode: string;
      codeVerifier: string;
      redirectUri: string;
      /** 인가 요청에 쓴 값. 네이버는 토큰 발급 때 state 를 받는다 — 없으면 서버가 난수를 채운다. */
      state?: string;
    } & WithDisplayName);

export type LoginRequestBody =
  | { provider: 'google' | 'kakao'; id_token: string }
  | { provider: 'apple'; id_token: string; authorization_code: string }
  | {
      provider: 'naver';
      authorization_code: string;
      code_verifier: string;
      redirect_uri: string;
      state?: string;
    };

/**
 * 자격 값을 제공자별 요청 본문으로 옮긴다. 값이 빠진 자격은 앱 버그라 서버에 보내기 전에
 * 막는다(애플의 code가 없으면 서버도 422 authorization_code_required로 거절한다).
 */
export function loginRequestBody(credential: ProviderCredential): LoginRequestBody {
  const incomplete = () => new Error(translate('login.failed'));
  if (credential.provider === 'naver') {
    if (!credential.authorizationCode || !credential.codeVerifier || !credential.redirectUri) {
      throw incomplete();
    }
    return {
      provider: 'naver',
      authorization_code: credential.authorizationCode,
      code_verifier: credential.codeVerifier,
      redirect_uri: credential.redirectUri,
      // 쓰지 않은 값은 키 자체를 싣지 않는다. 서버는 state 가 없거나 비어 있으면 난수를 채운다.
      ...(credential.state ? { state: credential.state } : {}),
    };
  }
  if (!credential.idToken) throw incomplete();
  if (credential.provider === 'apple') {
    if (!credential.authorizationCode) throw incomplete();
    return {
      provider: 'apple',
      id_token: credential.idToken,
      authorization_code: credential.authorizationCode,
    };
  }
  return { provider: credential.provider, id_token: credential.idToken };
}

export type SignedInResponse = TokenPair & { result: 'signed_in' };

export type SignupRequiredResponse = {
  result: 'signup_required';
  signup_token: string;
  expires_in: number;
  documents: ConsentDocument[];
};

export type LoginResponse = SignedInResponse | SignupRequiredResponse;

/** 처음 온 신원이 동의 화면에서 들고 있는 것. 계정은 아직 없고, 화면에서 나가면 버린다. */
export type PendingSignup = {
  provider: LoginProvider;
  signupToken: string;
  documents: ConsentDocument[];
  expiresAt: number;
  displayName: string | null;
};

export type LoginOutcome =
  | { kind: 'signed_in'; pair: TokenPair }
  | { kind: 'signup_required'; signup: PendingSignup };

/** 로그인 응답은 어느 쪽이든 200이고 본문의 result로 가른다. */
export function resolveLoginOutcome(
  response: unknown,
  context: { provider: LoginProvider; displayName: string | null; now: number },
): LoginOutcome {
  const body = (response ?? {}) as Partial<SignedInResponse> & Partial<SignupRequiredResponse>;
  if (
    body.result === 'signed_in' &&
    typeof body.access_token === 'string' &&
    typeof body.refresh_token === 'string' &&
    body.user
  ) {
    return { kind: 'signed_in', pair: body as TokenPair };
  }
  if (
    body.result === 'signup_required' &&
    typeof body.signup_token === 'string' &&
    Array.isArray(body.documents)
  ) {
    return {
      kind: 'signup_required',
      signup: {
        provider: context.provider,
        signupToken: body.signup_token,
        documents: body.documents,
        expiresAt: context.now + (body.expires_in ?? 0) * 1000,
        displayName: context.displayName,
      },
    };
  }
  throw new Error(translate('login.failed'));
}

export function isSignupExpired(signup: Pick<PendingSignup, 'expiresAt'>, now: number): boolean {
  return now >= signup.expiresAt;
}

export function providerLabel(provider: string): string {
  return isLoginProvider(provider) ? translate(`login.providerName.${provider}`) : provider;
}

/** 로그인 화면으로 돌려보내며 남기는 것. */
export type LoginNotice =
  /** 회색 상자. 만 14세 미만으로 계정이 닫혔을 때의 안전망. */
  | { kind: 'notice'; message: string }
  /** 팝업. provider는 서버 목록의 첫 번째. */
  | { kind: 'email_conflict'; provider: string | null };

type EmailConflictNotice = Extract<LoginNotice, { kind: 'email_conflict' }>;

/**
 * 이메일 겹침 409를 팝업 안내로 바꾼다. 아니면 null.
 *
 * 서버 목록의 첫 번째만 쓴다 — 여럿이면 가장 최근에 쓴 것을 앞에 두는 것은 서버의 몫이다.
 */
export function emailConflictNotice(error: unknown): EmailConflictNotice | null {
  if (
    !(error instanceof ApiError) ||
    error.status !== 409 ||
    error.code !== 'account_exists_with_different_provider'
  ) {
    return null;
  }
  return { kind: 'email_conflict', provider: conflictProviders(error)[0] ?? null };
}

/**
 * 이메일 겹침 팝업의 문구와 "계속하기"로 시작할 제공자.
 *
 * 이 빌드가 못 쓰는 제공자(안드로이드의 애플 등)나 모르는 값이면 계속하기를 두지 않는다 —
 * 눌러서 실패하는 버튼을 만들지 않기 위해서다.
 */
export function emailConflictDialog(
  provider: string | null,
  supported: readonly LoginProvider[],
): { title: string; message: string; continueWith: LoginProvider | null } {
  const title = translate('login.emailConflictTitle');
  if (provider === null || !isLoginProvider(provider)) {
    return { title, message: translate('login.emailConflictUnknown'), continueWith: null };
  }
  const name = providerLabel(provider);
  if (!supported.includes(provider)) {
    return {
      title,
      message: translate('login.emailConflictUnavailable', { provider: name }),
      continueWith: null,
    };
  }
  return {
    title,
    message: translate('login.emailConflictBody', { provider: name }),
    continueWith: provider,
  };
}
