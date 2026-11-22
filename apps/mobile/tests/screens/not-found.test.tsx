import { screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Text } from 'react-native';

import NotFound from '@/app/+not-found';
import { logEvent } from '@/lib/analytics';

jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));

const ROUTES = { index: () => <Text>홈 화면</Text>, '+not-found': NotFound };

describe('+not-found', () => {
  beforeEach(() => jest.mocked(logEvent).mockClear());

  it('앱에 없는 주소로 들어오면 홈으로 보내고, 어떤 주소였는지 남긴다', async () => {
    const view = renderRouter(ROUTES, { initialUrl: '/kakaolink/oops' });
    await view;
    expect(await screen.findByText('홈 화면')).toBeTruthy();
    expect(view.getPathname()).toBe('/');
    expect(logEvent).toHaveBeenCalledWith('route_not_found', { path: '/kakaolink/oops' });
  });

  it('남기는 주소는 100자까지만 자른다', async () => {
    await renderRouter(ROUTES, { initialUrl: '/' + 'a'.repeat(200) });
    expect(await screen.findByText('홈 화면')).toBeTruthy();
    const params = jest.mocked(logEvent).mock.calls[0]?.[1] as { path: string };
    expect(params.path).toHaveLength(100);
  });
});
