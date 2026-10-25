import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { createAudioPlayer } from 'expo-audio';
import { router } from 'expo-router';
import { AppState, Linking, Platform, Text } from 'react-native';

import { AnnouncementPoster } from '@/components/announcement-poster';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { localDay, type Poster } from '@/lib/poster';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('@/lib/api', () => ({ api: { getPosters: jest.fn() }, APP_VERSION: '0.1.9' }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn() }));
jest.mock('expo-image', () => ({
  Image: (props: object) => require('react').createElement(require('react-native').View, { ...props, testID: 'poster-image' }),
}));

type CloudState = {
  status: { available: boolean; consent: 'granted' | 'denied' | 'unknown' } | null;
  statusFailed: boolean;
  enable: jest.Mock;
  consentSheet: React.ReactNode;
};
let mockCloud: CloudState;
jest.mock('@/hooks/use-cloud-voice', () => ({ useCloudVoice: () => mockCloud }));

const getPosters = api.getPosters as jest.Mock;
const log = logEvent as jest.Mock;
const push = router.push as jest.Mock;
const newPlayer = createAudioPlayer as jest.Mock;
// 패키지 목의 jest.fn 이다 — spyOn 은 같은 함수를 돌려주므로 실패는 Once 로만 꽂는다.
const storageGetItem = AsyncStorage.getItem as jest.Mock;
const storageSetItem = AsyncStorage.setItem as jest.Mock;

// 2026-10-20 01:00 KST — UTC 로는 아직 19일이라 한국 날짜로 적는지 함께 본다.
const NOW = Date.parse('2026-10-19T16:00:00Z');
const TODAY = localDay(NOW);

function poster(overrides: Partial<Poster> = {}): Poster {
  return {
    slug: 'challenge-week',
    revision: 2,
    frequency: 'daily',
    audience: 'all',
    dismissible: true,
    badge: null,
    title: '이번 주 챌린지',
    body: null,
    image_url: null,
    image_asset: null,
    audio_asset: null,
    cta_label: null,
    cta_action: 'none',
    cta_target: null,
    ...overrides,
  };
}

async function storedState() {
  return JSON.parse((await AsyncStorage.getItem('acttub.posters')) ?? 'null');
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  mockCloud = {
    status: { available: true, consent: 'unknown' },
    statusFailed: false,
    enable: jest.fn(async () => true),
    consentSheet: null,
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('로그아웃 상태에서는 포스터를 묻지 않고, 로그인하면 서버가 준 첫 포스터를 띄우고 본 날로 적는다', async () => {
  getPosters.mockResolvedValue({
    posters: [poster({ badge: '새 소식', body: '새 대사가 올라왔어요' })],
  });

  const view = await render(<AnnouncementPoster loggedIn={false} />);
  expect(getPosters).not.toHaveBeenCalled();
  expect(screen.queryByText('이번 주 챌린지')).not.toBeOnTheScreen();

  await view.rerender(<AnnouncementPoster loggedIn />);

  expect(await screen.findByText('이번 주 챌린지')).toBeOnTheScreen();
  expect(screen.getByText('새 소식')).toBeOnTheScreen();
  expect(screen.getByText('새 대사가 올라왔어요')).toBeOnTheScreen();
  expect(screen.getByText('오늘 하루 안 보기')).toBeOnTheScreen();
  expect(getPosters).toHaveBeenCalledWith({ platform: 'ios', locale: 'ko', app_version: '0.1.9' });
  expect(log.mock.calls).toEqual([['poster_shown', { slug: 'challenge-week', revision: 2 }]]);
  await waitFor(async () =>
    expect(await storedState()).toEqual({
      'challenge-week': { revision: 2, lastShownDay: TODAY, shownOnce: true, dismissedForever: false },
    }),
  );
});

test('안드로이드에서는 platform=android 로 묻는다', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  getPosters.mockResolvedValue({ posters: [poster()] });

  await render(<AnnouncementPoster loggedIn />);

  expect(await screen.findByText('이번 주 챌린지')).toBeOnTheScreen();
  expect(getPosters).toHaveBeenCalledWith({ platform: 'android', locale: 'ko', app_version: '0.1.9' });
});

test('오늘 이미 본 daily 포스터는 넘기고 다음 순서의 포스터를 띄운다', async () => {
  await AsyncStorage.setItem(
    'acttub.posters',
    JSON.stringify({ 'challenge-week': { revision: 2, lastShownDay: TODAY, shownOnce: true, dismissedForever: false } }),
  );
  getPosters.mockResolvedValue({
    posters: [poster(), poster({ slug: 'audition-open', revision: 1, title: '오디션 열림' })],
  });

  await render(<AnnouncementPoster loggedIn />);

  expect(await screen.findByText('오디션 열림')).toBeOnTheScreen();
  expect(screen.queryByText('이번 주 챌린지')).not.toBeOnTheScreen();
  expect(log.mock.calls).toEqual([['poster_shown', { slug: 'audition-open', revision: 1 }]]);
});

test('띄울 수 있는 포스터가 없으면 아무것도 띄우지 않고 기록도 남기지 않는다', async () => {
  await AsyncStorage.setItem(
    'acttub.posters',
    JSON.stringify({ 'challenge-week': { revision: 2, lastShownDay: null, shownOnce: true, dismissedForever: true } }),
  );
  getPosters.mockResolvedValue({ posters: [poster()] });

  await render(<AnnouncementPoster loggedIn />);
  await act(async () => {});

  expect(screen.queryByText('이번 주 챌린지')).not.toBeOnTheScreen();
  expect(log.mock.calls).toEqual([]);
  expect(await storedState()).toEqual({
    'challenge-week': { revision: 2, lastShownDay: null, shownOnce: true, dismissedForever: true },
  });
});

test('포스터 요청이 실패하거나 빈 목록이면 아무것도 띄우지 않는다', async () => {
  getPosters.mockRejectedValueOnce(new Error('down'));
  const failed = await render(<AnnouncementPoster loggedIn />);
  await act(async () => {});
  expect(screen.toJSON()).toBeNull();
  await failed.unmount();

  getPosters.mockResolvedValueOnce({ posters: [] });
  await render(<AnnouncementPoster loggedIn />);
  await act(async () => {});
  expect(screen.toJSON()).toBeNull();
  expect(log.mock.calls).toEqual([]);
});

test('응답을 받기 전에 화면을 떠나면 아무것도 띄우지 않는다', async () => {
  let resolve!: (value: { posters: Poster[] }) => void;
  getPosters.mockReturnValue(new Promise((r) => { resolve = r; }));

  const view = await render(<AnnouncementPoster loggedIn />);
  await view.unmount();
  await act(async () => resolve({ posters: [poster()] }));
  expect(log.mock.calls).toEqual([]);
  expect(await storedState()).toBeNull();

  getPosters.mockResolvedValue({ posters: [poster()] });
  await render(<AnnouncementPoster loggedIn />);
  expect(await screen.findByText('이번 주 챌린지')).toBeOnTheScreen();
  expect(log.mock.calls).toEqual([['poster_shown', { slug: 'challenge-week', revision: 2 }]]);
});

test('다른 시트가 떠 있거나 온보딩 직후면 기다렸다가, 풀린 뒤 한 번만 띄운다', async () => {
  getPosters.mockResolvedValue({ posters: [poster()] });

  const view = await render(<AnnouncementPoster loggedIn blocked />);
  await act(async () => {});
  expect(screen.queryByText('이번 주 챌린지')).not.toBeOnTheScreen();

  await view.rerender(<AnnouncementPoster loggedIn onboardingJustFinished />);
  await act(async () => {});
  expect(screen.queryByText('이번 주 챌린지')).not.toBeOnTheScreen();

  await view.rerender(<AnnouncementPoster loggedIn />);
  expect(await screen.findByText('이번 주 챌린지')).toBeOnTheScreen();

  await view.rerender(<AnnouncementPoster loggedIn blocked />);
  await view.rerender(<AnnouncementPoster loggedIn />);
  await act(async () => {});
  expect(log.mock.calls).toEqual([['poster_shown', { slug: 'challenge-week', revision: 2 }]]);
});

test('기기 상태를 읽는 사이 조건이 바뀌어도 포스터는 한 번만 띄운다', async () => {
  getPosters.mockResolvedValue({ posters: [poster()] });
  const realGetItem = storageGetItem.getMockImplementation()!;
  const pending: (() => void)[] = [];
  const held = (key: string) => new Promise((r) => pending.push(() => r(realGetItem(key))));
  storageGetItem.mockImplementationOnce(held).mockImplementationOnce(held);

  const view = await render(<AnnouncementPoster loggedIn />);
  await act(async () => {});
  expect(pending).toHaveLength(2);
  await view.rerender(<AnnouncementPoster loggedIn blocked />);
  await view.rerender(<AnnouncementPoster loggedIn />);
  await act(async () => { pending.forEach((go) => go()); });

  expect(await screen.findByText('이번 주 챌린지')).toBeOnTheScreen();
  expect(log.mock.calls).toEqual([['poster_shown', { slug: 'challenge-week', revision: 2 }]]);
});

test('기기 상태를 못 읽으면 포스터를 띄우지 않는다', async () => {
  getPosters.mockResolvedValue({ posters: [poster()] });
  storageGetItem.mockRejectedValueOnce(new Error('disk')).mockRejectedValueOnce(new Error('disk'));

  await render(<AnnouncementPoster loggedIn />);
  await act(async () => {});

  expect(screen.queryByText('이번 주 챌린지')).not.toBeOnTheScreen();
  expect(log.mock.calls).toEqual([]);
  expect(await storedState()).toBeNull();
});

test('본 날 저장이 실패해도 포스터는 그대로 뜬다', async () => {
  getPosters.mockResolvedValue({ posters: [poster()] });
  storageSetItem.mockRejectedValueOnce(new Error('disk full'));

  await render(<AnnouncementPoster loggedIn />);

  expect(await screen.findByText('이번 주 챌린지')).toBeOnTheScreen();
  expect(log.mock.calls).toEqual([['poster_shown', { slug: 'challenge-week', revision: 2 }]]);
});

describe('cloud_voice_off 포스터', () => {
  const promo = poster({
    slug: 'cloud-voice-launch',
    revision: 1,
    audience: 'cloud_voice_off',
    title: '고품질 목소리 출시',
    cta_label: '무료로 켜기',
    cta_action: 'cloud_voice_enable',
  });

  test('고품질 목소리 상태를 받을 때까지 고르지 않고, 받은 뒤 아직 안 켠 사람에게 띄운다', async () => {
    mockCloud.status = null;
    getPosters.mockResolvedValue({ posters: [promo, poster()] });

    const view = await render(<AnnouncementPoster loggedIn />);
    await act(async () => {});
    expect(screen.queryByText('고품질 목소리 출시')).not.toBeOnTheScreen();
    expect(screen.queryByText('이번 주 챌린지')).not.toBeOnTheScreen();

    mockCloud = { ...mockCloud, status: { available: true, consent: 'unknown' } };
    await view.rerender(<AnnouncementPoster loggedIn />);

    expect(await screen.findByText('고품질 목소리 출시')).toBeOnTheScreen();
  });

  test('상태 요청이 실패하면 기다리지 않고 그 포스터만 빼고 고른다', async () => {
    mockCloud.status = null;
    mockCloud.statusFailed = true;
    getPosters.mockResolvedValue({ posters: [promo, poster()] });

    await render(<AnnouncementPoster loggedIn />);

    expect(await screen.findByText('이번 주 챌린지')).toBeOnTheScreen();
    expect(screen.queryByText('고품질 목소리 출시')).not.toBeOnTheScreen();
  });

  test('이미 동의한 사람에게는 띄우지 않는다', async () => {
    mockCloud.status = { available: true, consent: 'granted' };
    getPosters.mockResolvedValue({ posters: [promo, poster()] });

    await render(<AnnouncementPoster loggedIn />);

    expect(await screen.findByText('이번 주 챌린지')).toBeOnTheScreen();
    expect(screen.queryByText('고품질 목소리 출시')).not.toBeOnTheScreen();
  });

  test('버튼을 누르면 포스터를 닫고 0.35초 뒤 동의 시트를 연다', async () => {
    getPosters.mockResolvedValue({ posters: [promo] });
    await render(<AnnouncementPoster loggedIn />);

    await fireEvent.press(await screen.findByText('무료로 켜기'));

    expect(screen.queryByText('고품질 목소리 출시')).not.toBeOnTheScreen();
    expect(log.mock.calls).toEqual([
      ['poster_shown', { slug: 'cloud-voice-launch', revision: 1 }],
      ['poster_cta', { slug: 'cloud-voice-launch', revision: 1 }],
    ]);
    expect(mockCloud.enable).not.toHaveBeenCalled();
    await waitFor(() => expect(mockCloud.enable.mock.calls).toEqual([[]]));
  });

  test('떠 있는 사이 고품질 목소리를 켜면 포스터를 닫는다', async () => {
    getPosters.mockResolvedValue({ posters: [promo] });
    const view = await render(<AnnouncementPoster loggedIn />);
    expect(await screen.findByText('고품질 목소리 출시')).toBeOnTheScreen();

    mockCloud = { ...mockCloud, status: { available: true, consent: 'granted' } };
    await view.rerender(<AnnouncementPoster loggedIn />);
    expect(screen.queryByText('고품질 목소리 출시')).not.toBeOnTheScreen();
  });

  test('고품질 목소리 동의 시트는 포스터가 있든 없든 함께 그린다', async () => {
    mockCloud.consentSheet = <Text>동의 시트</Text>;
    getPosters.mockResolvedValue({ posters: [promo] });

    await render(<AnnouncementPoster loggedIn />);
    expect(screen.getByText('동의 시트')).toBeOnTheScreen();

    expect(await screen.findByText('고품질 목소리 출시')).toBeOnTheScreen();
    expect(screen.getByText('동의 시트')).toBeOnTheScreen();
  });
});

describe('포스터 안의 버튼', () => {
  test('닫기를 누르면 닫고 poster_close 를 남긴다', async () => {
    getPosters.mockResolvedValue({ posters: [poster()] });
    await render(<AnnouncementPoster loggedIn />);

    await fireEvent.press(await screen.findByLabelText('닫기'));

    expect(screen.queryByText('이번 주 챌린지')).not.toBeOnTheScreen();
    expect(log.mock.calls[1]).toEqual(['poster_close', { slug: 'challenge-week', revision: 2 }]);
  });

  test('오늘 하루 안 보기를 누르면 그 판을 다시 띄우지 않게 적고 닫는다', async () => {
    getPosters.mockResolvedValue({ posters: [poster()] });
    await render(<AnnouncementPoster loggedIn />);

    await fireEvent.press(await screen.findByText('오늘 하루 안 보기'));

    await waitFor(() => expect(screen.queryByText('이번 주 챌린지')).not.toBeOnTheScreen());
    expect(log.mock.calls[1]).toEqual(['poster_dismiss', { slug: 'challenge-week', revision: 2 }]);
    expect(await storedState()).toEqual({
      'challenge-week': { revision: 2, lastShownDay: TODAY, shownOnce: true, dismissedForever: false, hiddenDay: TODAY },
    });
  });

  test('오늘 하루 안 보기 저장이 실패해도 닫고 이벤트를 남긴다', async () => {
    getPosters.mockResolvedValue({ posters: [poster()] });
    await render(<AnnouncementPoster loggedIn />);
    await screen.findByText('이번 주 챌린지');
    storageGetItem.mockRejectedValueOnce(new Error('disk')).mockRejectedValueOnce(new Error('disk'));

    await fireEvent.press(screen.getByText('오늘 하루 안 보기'));

    await waitFor(() => expect(screen.queryByText('이번 주 챌린지')).not.toBeOnTheScreen());
    expect(log.mock.calls[1]).toEqual(['poster_dismiss', { slug: 'challenge-week', revision: 2 }]);
  });

  test('dismissible 이 false 면 오늘 하루 안 보기를 숨긴다', async () => {
    getPosters.mockResolvedValue({ posters: [poster({ dismissible: false })] });
    await render(<AnnouncementPoster loggedIn />);

    expect(await screen.findByText('이번 주 챌린지')).toBeOnTheScreen();
    expect(screen.queryByText('오늘 하루 안 보기')).not.toBeOnTheScreen();
  });

  test('route 버튼은 닫고 그 앱 경로로 간다', async () => {
    getPosters.mockResolvedValue({
      posters: [poster({ cta_label: '보러 가기', cta_action: 'route', cta_target: '/challenges' })],
    });
    await render(<AnnouncementPoster loggedIn />);

    await fireEvent.press(await screen.findByText('보러 가기'));

    expect(screen.queryByText('이번 주 챌린지')).not.toBeOnTheScreen();
    await waitFor(() => expect(push.mock.calls).toEqual([['/challenges']]));
    expect(log.mock.calls[1]).toEqual(['poster_cta', { slug: 'challenge-week', revision: 2 }]);
  });

  test('url 버튼은 닫고 외부 브라우저로 연다. 열지 못해도 앱은 그대로다', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no browser'));
    getPosters.mockResolvedValue({
      posters: [poster({ cta_label: '자세히', cta_action: 'url', cta_target: 'https://acttub.com/notice' })],
    });
    await render(<AnnouncementPoster loggedIn />);

    await fireEvent.press(await screen.findByText('자세히'));
    await act(async () => {});

    expect(screen.queryByText('이번 주 챌린지')).not.toBeOnTheScreen();
    expect(openURL.mock.calls).toEqual([['https://acttub.com/notice']]);
    expect(push).not.toHaveBeenCalled();
  });

  test('안전하지 않은 대상이면 버튼을 숨긴다', async () => {
    getPosters.mockResolvedValue({
      posters: [poster({ cta_label: '자세히', cta_action: 'url', cta_target: 'http://acttub.com' })],
    });
    await render(<AnnouncementPoster loggedIn />);

    expect(await screen.findByText('이번 주 챌린지')).toBeOnTheScreen();
    expect(screen.queryByText('자세히')).not.toBeOnTheScreen();
  });
});

describe('그림과 샘플 소리', () => {
  test('서버 이미지 주소가 있으면 그 주소를 그린다', async () => {
    getPosters.mockResolvedValue({ posters: [poster({ image_url: 'https://cdn.acttub.com/posters/a.png' })] });
    await render(<AnnouncementPoster loggedIn />);

    expect((await screen.findByTestId('poster-image')).props.source).toEqual({
      uri: 'https://cdn.acttub.com/posters/a.png',
    });
    expect(screen.queryByText('들어보기')).not.toBeOnTheScreen();
  });

  test('앱이 모르는 자산 이름이면 그림 칸을 숨긴다', async () => {
    getPosters.mockResolvedValue({ posters: [poster({ image_asset: 'mascot-dancing', audio_asset: 'unknown' })] });
    await render(<AnnouncementPoster loggedIn />);

    expect(await screen.findByText('이번 주 챌린지')).toBeOnTheScreen();
    expect(screen.queryByTestId('poster-image')).not.toBeOnTheScreen();
    expect(screen.queryByText('들어보기')).not.toBeOnTheScreen();
  });

  test('그림 없이 샘플 소리만 있으면 재생 버튼만 보인다', async () => {
    getPosters.mockResolvedValue({ posters: [poster({ audio_asset: 'cloud-voice-sample' })] });
    await render(<AnnouncementPoster loggedIn />);

    expect(await screen.findByText('들어보기')).toBeOnTheScreen();
    expect(screen.queryByTestId('poster-image')).not.toBeOnTheScreen();
  });

  test('번들 그림과 샘플 소리:들어보기·멈추기를 오가고, 떠나면 재생기를 놓는다', async () => {
    const player = { play: jest.fn(), pause: jest.fn(), remove: jest.fn(), release: jest.fn() };
    newPlayer.mockReturnValue(player);
    getPosters.mockResolvedValue({
      posters: [poster({ image_asset: 'mascot-reading', audio_asset: 'cloud-voice-sample' })],
    });
    const view = await render(<AnnouncementPoster loggedIn />);

    expect((await screen.findByTestId('poster-image')).props.source).toEqual({ testUri: '../../../assets/images/mascot-reading.png' });

    await fireEvent.press(screen.getByText('들어보기'));
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(screen.getByText('멈추기')).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('멈추기'));
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(screen.getByText('들어보기')).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('들어보기'));
    expect(player.play).toHaveBeenCalledTimes(2);
    expect(newPlayer).toHaveBeenCalledTimes(1);

    await view.unmount();
    expect(player.remove).toHaveBeenCalledTimes(1);
    expect(player.release).toHaveBeenCalledTimes(1);
  });
});

test('일반 닫기 뒤 다음 공지를 띄워 상위 every 공지가 다른 공지를 가리지 않는다', async () => {
  getPosters.mockResolvedValue({ posters: [poster({ frequency: 'every' }), poster({ slug: 'next', title: '다음 공지', frequency: 'every' })] });
  await render(<AnnouncementPoster loggedIn />);
  await fireEvent.press(await screen.findByLabelText('닫기'));
  expect(await screen.findByText('다음 공지')).toBeOnTheScreen();
});
test('백그라운드에서 활성화되면 서버를 다시 조회하고 every 공지를 다시 띄운다', async () => {
  let change: (state: any) => void = () => {};
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    change = listener;
    return { remove: jest.fn() };
  });
  getPosters.mockResolvedValue({ posters: [poster({ frequency: 'every' })] });
  await render(<AnnouncementPoster loggedIn />);
  await fireEvent.press(await screen.findByLabelText('닫기'));
  await act(() => { change('background'); change('active'); });
  expect(await screen.findByText('이번 주 챌린지')).toBeOnTheScreen();
  expect(getPosters).toHaveBeenCalledTimes(2);
});
