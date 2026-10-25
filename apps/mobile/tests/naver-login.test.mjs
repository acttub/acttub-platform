import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';

import {
  base64Url,
  isNaverReturnUrl,
  naverAuthRequest,
  naverCallbackCode,
  naverRedirectUri,
} from '../lib/naver-login.ts';

test('base64url 은 채움 문자 없이 Node 와 같은 값을 만든다', () => {
  for (let length = 0; length < 40; length += 1) {
    const bytes = new Uint8Array(randomBytes(length));
    assert.equal(base64Url(bytes), Buffer.from(bytes).toString('base64url'));
  }
});

test('code_challenge 는 RFC 7636 부록 B 의 S256 예시와 같다', async () => {
  const verifierBytes = new Uint8Array([
    116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214,
    191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
  ]);
  let calls = 0;
  const request = await naverAuthRequest({
    clientId: 'id',
    apiUrl: undefined,
    crypto: {
      randomBytes: (count) => (calls++ === 0 ? verifierBytes : new Uint8Array(count)),
      sha256: async (data) => new Uint8Array(createHash('sha256').update(data).digest()),
    },
  });
  assert.equal(request.codeVerifier, 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
  assert.equal(new URL(request.url).searchParams.get('code_challenge'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  // API 주소가 없으면 앱과 같이 dev 를 본다.
  assert.equal(request.redirectUri, 'https://dev.acttub.com/auth/naver/callback');
});

test('콜백 주소는 API 와 같은 호스트의 웹 페이지다', () => {
  assert.equal(naverRedirectUri(' https://dev.acttub.com// '), 'https://dev.acttub.com/auth/naver/callback');
  assert.equal(naverRedirectUri('https://acttub.com'), 'https://acttub.com/auth/naver/callback');
  assert.equal(naverRedirectUri(''), 'https://dev.acttub.com/auth/naver/callback');
});

test('돌아온 주소의 퍼센트·+ 인코딩을 풀고 첫 값만 쓴다', () => {
  assert.equal(naverCallbackCode('actingapp://auth/naver?code=a%2Bb+c&state=s%3D1&code=other#frag', 's=1'), 'a+b c');
  assert.throws(() => naverCallbackCode('actingapp://auth/naver', 's'), /mismatched state/);
});

test('네이버 결과 주소만 골라낸다', () => {
  assert.equal(isNaverReturnUrl('actingapp://auth/naver?code=1&state=2'), true);
  assert.equal(isNaverReturnUrl('ACTINGAPP://auth/naver'), true);
  assert.equal(isNaverReturnUrl('actingapp://auth/naverx'), false);
  assert.equal(isNaverReturnUrl('actingapp://entry/1'), false);
  assert.equal(isNaverReturnUrl('/auth/naver'), false);
});
