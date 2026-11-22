import { redirectSystemPath } from '@/app/+native-intent';
import { markEntryPath } from '@/lib/crashlytics';

jest.mock('@/lib/crashlytics', () => ({ markEntryPath: jest.fn() }));

describe('+native-intent', () => {
  beforeEach(() => jest.mocked(markEntryPath).mockClear());

  it('들어온 주소와 콜드 스타트 여부를 크래시 기록에 남긴다 — 없는 주소로 켜진 크래시가 화면 기록 없이 왔다(SOMA-1091)', () => {
    redirectSystemPath({ path: 'actingapp://somewhere?x=1', initial: true });
    expect(markEntryPath).toHaveBeenCalledWith('actingapp://somewhere?x=1', true);
  });

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
