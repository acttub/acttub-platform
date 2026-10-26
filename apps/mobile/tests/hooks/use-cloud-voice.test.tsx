import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { useCloudVoice } from '@/hooks/use-cloud-voice';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
}));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/api', () => ({
  api: { getCloudVoiceStatus: jest.fn(), consentEntry: jest.fn(), recordConsent: jest.fn() },
}));

const apiMock = api as unknown as Record<string, jest.Mock>;
const status = (over = {}) => ({ available: true, free_until: null, consent: 'undecided', daily_limit: 30, daily_used: 0, ...over });
const cloudDoc = { id: 'doc-cloud', type: 'cloud_voice', title: '고품질 목소리 동의', body: '# 고품질 목소리 동의\n\n목소리를 서버에서 만들어요.' };

let voice: ReturnType<typeof useCloudVoice>;
function Host() {
  voice = useCloudVoice();
  return (
    <>
      <Text>{`enabled:${voice.enabled}`}</Text>
      <Text>{`consent:${voice.status?.consent ?? '-'}`}</Text>
      <Text>{`failed:${voice.statusFailed}`}</Text>
      {voice.consentSheet}
    </>
  );
}
const flush = () => act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); });
const show = async () => { await render(<Host />); await flush(); };
const seen = (text: string) => expect(screen.getByText(text)).toBeOnTheScreen();

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  apiMock.getCloudVoiceStatus.mockResolvedValue(status());
  apiMock.consentEntry.mockResolvedValue({ entry_status: 'allowed', documents: [cloudDoc] });
  apiMock.recordConsent.mockResolvedValue(undefined);
});

test('열 때 기기 설정과 서버 상태를 읽는다', async () => {
  await AsyncStorage.setItem('acttub.cloudVoice', 'on');
  await show();
  seen('enabled:true');
  seen('consent:undecided');
  seen('failed:false');
});

test('한 번도 안 건드린 기기는 켜짐으로 읽는다(10/25 사용자 결정)', async () => {
  await show();
  seen('enabled:true');
});

test('서버 상태를 못 읽으면 실패를 알린다', async () => {
  apiMock.getCloudVoiceStatus.mockRejectedValue(new Error('down'));
  await show();
  seen('failed:true');
  seen('consent:-');
});

test('이미 동의했으면 바로 켜고 안내를 잠시 띄운다', async () => {
  jest.useFakeTimers();
  try {
    apiMock.getCloudVoiceStatus.mockResolvedValue(status({ consent: 'granted' }));
    await show();

    let result = false;
    await act(async () => { result = await voice.enable('promo'); });

    expect(result).toBe(true);
    expect(await AsyncStorage.getItem('acttub.cloudVoice')).toBe('on');
    expect(logEvent).toHaveBeenCalledWith('cloud_voice_enabled', { source: 'promo' });
    seen('enabled:true');
    seen('고품질 목소리를 켰어요.');

    await act(async () => { jest.advanceTimersByTime(2200); });
    expect(screen.queryByText('고품질 목소리를 켰어요.')).not.toBeOnTheScreen();
  } finally {
    jest.useRealTimers();
  }
});

test('쓸 수 없는 상태면 켜지 않는다', async () => {
  // 끈 적이 있는 기기에서 켜는 흐름을 본다(기본은 켜짐).
  await AsyncStorage.setItem('acttub.cloudVoice', 'off');
  await show();
  apiMock.getCloudVoiceStatus.mockResolvedValue(status({ available: false }));
  let result = true;
  await act(async () => { result = await voice.enable('settings'); });
  expect(result).toBe(false);
  expect(apiMock.consentEntry).not.toHaveBeenCalled();
  seen('enabled:false');
});

test('상태 확인이 실패하면 켜지 않는다', async () => {
  await show();
  apiMock.getCloudVoiceStatus.mockRejectedValue(new Error('down'));
  let result = true;
  await act(async () => { result = await voice.enable('settings'); });
  expect(result).toBe(false);
});

test('동의 문서가 없으면 시트를 띄우지 않는다', async () => {
  apiMock.consentEntry.mockResolvedValue({ entry_status: 'allowed', documents: [] });
  await show();
  let result = true;
  await act(async () => { result = await voice.enable('settings'); });
  expect(result).toBe(false);
  expect(screen.queryByText('동의하고 켜기')).not.toBeOnTheScreen();
});

test('동의하지 않았으면 동의 시트를 띄우고, 동의하면 기록하고 켠다', async () => {
  await show();
  let result = true;
  await act(async () => { result = await voice.enable('promo'); });
  expect(result).toBe(false);
  seen('고품질 목소리 동의');
  seen('목소리를 서버에서 만들어요.');

  await fireEvent.press(screen.getByText('동의하고 켜기'));
  await flush();

  expect(apiMock.recordConsent).toHaveBeenCalledWith('doc-cloud', 'granted');
  expect(logEvent).toHaveBeenCalledWith('cloud_voice_enabled', { source: 'promo' });
  expect(await AsyncStorage.getItem('acttub.cloudVoice')).toBe('on');
  seen('enabled:true');
  seen('consent:granted');
  expect(screen.queryByText('동의하고 켜기')).not.toBeOnTheScreen();
});

test('동의하지 않기를 누르면 거절을 기록하고 꺼 둔다', async () => {
  await AsyncStorage.setItem('acttub.cloudVoice', 'on');
  await show();
  await act(async () => { await voice.enable('settings'); });

  await fireEvent.press(screen.getByText('동의하지 않기'));
  await flush();

  expect(apiMock.recordConsent).toHaveBeenCalledWith('doc-cloud', 'declined');
  expect(await AsyncStorage.getItem('acttub.cloudVoice')).toBe('off');
  seen('enabled:false');
  seen('consent:denied');
});

test('켜는 중에 다시 누르면 두 번째는 바로 false다', async () => {
  let resolveStatus!: (value: unknown) => void;
  await show();
  apiMock.getCloudVoiceStatus.mockImplementationOnce(() => new Promise(resolve => { resolveStatus = resolve; }));

  let first: Promise<boolean>;
  await act(async () => { first = voice.enable('settings'); });
  let second = true;
  await act(async () => { second = await voice.enable('settings'); });
  expect(second).toBe(false);

  await act(async () => { resolveStatus(status({ consent: 'granted' })); await first; });
  seen('enabled:true');
});

test('끄면 기기 설정을 끈다', async () => {
  await AsyncStorage.setItem('acttub.cloudVoice', 'on');
  await show();
  await act(() => voice.disable());
  expect(await AsyncStorage.getItem('acttub.cloudVoice')).toBe('off');
  seen('enabled:false');
});

test('다시 읽기는 최신 서버 상태를 돌려준다', async () => {
  apiMock.getCloudVoiceStatus.mockRejectedValueOnce(new Error('down'));
  await show();
  seen('failed:true');

  apiMock.getCloudVoiceStatus.mockResolvedValue(status({ consent: 'granted' }));
  let next: unknown;
  await act(async () => { next = await voice.refresh(); });
  expect(next).toEqual(status({ consent: 'granted' }));
  seen('failed:false');
  seen('consent:granted');
});

test('안드로이드 뒤로 가기로 동의 시트를 닫으면 아무것도 기록하지 않는다', async () => {
  // 끈 적이 있는 기기에서 켜는 흐름을 본다(기본은 켜짐).
  await AsyncStorage.setItem('acttub.cloudVoice', 'off');
  await show();
  await act(async () => { await voice.enable('settings'); });
  seen('동의하고 켜기');

  await fireEvent(screen.getByText('동의하고 켜기'), 'requestClose');

  expect(screen.queryByText('동의하고 켜기')).not.toBeOnTheScreen();
  expect(apiMock.recordConsent).not.toHaveBeenCalled();
  seen('enabled:false');
});

test('동의 기록이 실패하면 시트에 남아 실패를 알리고, 다시 누르면 켠다', async () => {
  // 끈 적이 있는 기기에서 켜는 흐름을 본다(기본은 켜짐).
  await AsyncStorage.setItem('acttub.cloudVoice', 'off');
  await show();
  await act(async () => { await voice.enable('settings'); });
  apiMock.recordConsent.mockRejectedValueOnce(new Error('down'));

  await fireEvent.press(screen.getByText('동의하고 켜기'));
  await flush();

  seen('동의 기록에 실패했어요. 다시 시도해 주세요.');
  seen('동의하고 켜기');
  seen('enabled:false');
  expect(await AsyncStorage.getItem('acttub.cloudVoice')).toBe('off');

  await fireEvent.press(screen.getByText('동의하고 켜기'));
  await flush();

  expect(apiMock.recordConsent).toHaveBeenCalledTimes(2);
  seen('enabled:true');
  expect(screen.queryByText('동의 기록에 실패했어요. 다시 시도해 주세요.')).not.toBeOnTheScreen();
});

test('거절 기록이 실패해도 시트에 남아 실패를 알린다', async () => {
  await show();
  await act(async () => { await voice.enable('settings'); });
  apiMock.recordConsent.mockRejectedValueOnce(new Error('down'));

  await fireEvent.press(screen.getByText('동의하지 않기'));
  await flush();

  seen('동의 기록에 실패했어요. 다시 시도해 주세요.');
  seen('동의하지 않기');
  seen('consent:undecided');
});
