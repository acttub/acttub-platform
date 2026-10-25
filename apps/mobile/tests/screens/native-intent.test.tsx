import { redirectSystemPath } from '@/app/+native-intent';

describe('+native-intent', () => {
  it('네이버 로그인 결과 주소는 라우터가 열지 않는다', () => {
    expect(redirectSystemPath({ path: 'actingapp://auth/naver?code=c&state=s', initial: false })).toBeNull();
  });

  it('앱이 그 주소로 켜졌으면 첫 화면으로 보낸다', () => {
    expect(redirectSystemPath({ path: 'actingapp://auth/naver?code=c&state=s', initial: true })).toBe('/');
  });

  it('다른 주소는 그대로 둔다', () => {
    expect(redirectSystemPath({ path: 'actingapp://entry/12', initial: false })).toBe('actingapp://entry/12');
    expect(redirectSystemPath({ path: '/consent', initial: true })).toBe('/consent');
  });
});
