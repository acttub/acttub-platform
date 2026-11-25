import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { EntryShareSheet, type ShareSheetEntry } from '@/components/entry-share-sheet';
import * as native from '@/lib/challenge/share-native';
import { ShareError } from '@/lib/challenge/share';

import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';

jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/api', () => ({ api: { getEntry: jest.fn(), requestShareFrame: jest.fn(), getShareFramePreview: jest.fn() } }));
jest.mock('@/lib/challenge/share-native', () => ({
  videoDeps: { download: jest.fn(), remove: jest.fn() },
  isInstagramInstalled: jest.fn(),
  instagramStoreUrl: jest.fn(() => 'market://details?id=com.instagram.android'),
  shareVideoToInstagramStory: jest.fn(),
  saveVideoToLibrary: jest.fn(),
  copyText: jest.fn(),
  openSystemShare: jest.fn(),
  openSystemShareWithVideo: jest.fn(),
  openUrl: jest.fn(),
  shareKakaoFeed: jest.fn(),
}));

const m = native as unknown as {
  videoDeps: { download: jest.Mock; remove: jest.Mock };
  isInstagramInstalled: jest.Mock;
  shareVideoToInstagramStory: jest.Mock;
  saveVideoToLibrary: jest.Mock;
  copyText: jest.Mock;
  openSystemShare: jest.Mock;
  openSystemShareWithVideo: jest.Mock;
  openUrl: jest.Mock;
  shareKakaoFeed: jest.Mock;
};

const mine: ShareSheetEntry = { id: 'e1', is_mine: true, published_at: '2026-10-20T00:00:00Z', playback_url: 'https://v/1.mp4', authorName: '지성' };

async function open(entry: ShareSheetEntry = mine) {
  const onClose = jest.fn();
  await render(<EntryShareSheet visible entry={entry} line="잘 지내, 진짜로." onClose={onClose} />);
  return onClose;
}

/** 프레임 「없음」 — 지금까지처럼 재생 주소의 영상을 그대로 보낸다. */
async function openWithoutFrame() {
  await open();
  await fireEvent.press(screen.getByLabelText('없음'));
}

const frames = api as unknown as { requestShareFrame: jest.Mock; getShareFramePreview: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  frames.getShareFramePreview.mockImplementation((_id: string, frame: string) => Promise.resolve({ image_url: `https://p/${frame}.jpg` }));
  frames.requestShareFrame.mockResolvedValue({ status: 'ready', video_url: 'https://f/framed.mp4' });
  m.videoDeps.download.mockResolvedValue({ uri: 'file:///c/a.mp4', size: 1000 });
  m.isInstagramInstalled.mockResolvedValue(true);
  m.shareVideoToInstagramStory.mockResolvedValue(undefined);
  m.saveVideoToLibrary.mockResolvedValue(undefined);
  m.openSystemShare.mockResolvedValue(undefined);
  m.openSystemShareWithVideo.mockResolvedValue(undefined);
  m.openUrl.mockResolvedValue(undefined);
  m.shareKakaoFeed.mockResolvedValue(true);
});

describe('EntryShareSheet', () => {
  it('내 공개 참여작은 대상 다섯 개와 영상 저장을 보인다', async () => {
    await open();
    for (const label of ['인스타', '카카오톡', '스레드', '링크 복사', '더 보기', '영상으로 저장']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('내 연기 공유하기')).toBeTruthy();
  });

  it('남의 참여작은 링크 대상만 보이고 영상 저장은 없다', async () => {
    await open({ ...mine, is_mine: false });
    expect(screen.queryByText('인스타')).toBeNull();
    expect(screen.queryByText('영상으로 저장')).toBeNull();
    expect(screen.getByText('카카오톡')).toBeTruthy();
  });

  it('인스타: 영상을 받아 스토리로 보내고, 인스타가 읽기 전에 파일을 지우지 않는다', async () => {
    await openWithoutFrame();
    await fireEvent.press(screen.getByLabelText('인스타'));
    await waitFor(() => expect(m.shareVideoToInstagramStory).toHaveBeenCalledWith('file:///c/a.mp4'));
    expect(m.videoDeps.download).toHaveBeenCalledWith('https://v/1.mp4');
    expect(m.videoDeps.remove).not.toHaveBeenCalled();
    expect(frames.requestShareFrame).not.toHaveBeenCalled();
  });

  it('인스타: 받는 동안 준비 중 문구를 보인다', async () => {
    let finish: (v: { uri: string; size: number }) => void = () => undefined;
    m.videoDeps.download.mockReturnValue(new Promise((r) => (finish = r)));
    await openWithoutFrame();
    await fireEvent.press(screen.getByLabelText('인스타'));
    expect(await screen.findByText('영상을 준비하는 중…')).toBeTruthy();
    await act(async () => finish({ uri: 'f', size: 1 }));
    await waitFor(() => expect(screen.queryByText('영상을 준비하는 중…')).toBeNull());
  });

  it('인스타: 받기에 실패하면 안내를 보이고 스토리를 열지 않는다', async () => {
    m.videoDeps.download.mockRejectedValue(new Error('net'));
    await open();
    await fireEvent.press(screen.getByLabelText('인스타'));
    expect(await screen.findByText('영상을 받지 못했어요. 연결을 확인하고 다시 해 주세요.')).toBeTruthy();
    expect(m.shareVideoToInstagramStory).not.toHaveBeenCalled();
  });

  it('인스타: 너무 큰 영상은 링크 공유를 안내한다', async () => {
    m.videoDeps.download.mockResolvedValue({ uri: 'f', size: 999 * 1024 * 1024 });
    await open();
    await fireEvent.press(screen.getByLabelText('인스타'));
    expect(await screen.findByText(/너무 커서 스토리에 올릴 수 없어요/)).toBeTruthy();
  });

  it('인스타가 없으면 설치 안내와 함께 스토어를 연다', async () => {
    m.isInstagramInstalled.mockResolvedValue(false);
    await open();
    await fireEvent.press(screen.getByLabelText('인스타'));
    expect(await screen.findByText(/인스타그램이 없어요/)).toBeTruthy();
    expect(m.openUrl).toHaveBeenCalledWith('market://details?id=com.instagram.android');
    expect(m.videoDeps.download).not.toHaveBeenCalled();
  });

  it('스토리를 닫아 오류가 나도 안내하지 않는다', async () => {
    m.shareVideoToInstagramStory.mockRejectedValue(new Error('User did not share'));
    await open();
    await fireEvent.press(screen.getByLabelText('인스타'));
    await waitFor(() =>
      expect(logEvent).toHaveBeenCalledWith('challenge_share_story_error', { id: 'e1', reason: 'User did not share' }),
    );
    expect(screen.queryByText(/받지 못했어요/)).toBeNull();
  });

  it('카카오톡은 영상 파일 없이 카카오톡 공유 카드(대사·「영상 보기」 버튼·참여작 링크)로 보낸다', async () => {
    await open();
    await fireEvent.press(screen.getByLabelText('카카오톡'));
    await waitFor(() =>
      expect(m.shareKakaoFeed).toHaveBeenCalledWith({
        title: '지성의 연기',
        description: '“잘 지내, 진짜로.” — Acttub 챌린지',
        imageUrl: 'https://acttub.com/opengraph-image',
        linkUrl: 'https://acttub.com/e/e1',
        buttonTitle: '영상 보기',
      }),
    );
    expect(m.videoDeps.download).not.toHaveBeenCalled();
    expect(m.openSystemShareWithVideo).not.toHaveBeenCalled();
    expect(m.openSystemShare).not.toHaveBeenCalled();
  });

  it('카카오톡 공유를 쓸 수 없거나 실패하면 기기 공유 창으로 링크 문장을 보낸다', async () => {
    m.shareKakaoFeed.mockResolvedValueOnce(false);
    await open({ ...mine, is_mine: false });
    await fireEvent.press(screen.getByLabelText('카카오톡'));
    await waitFor(() => expect(m.openSystemShare).toHaveBeenCalledWith(expect.stringContaining('https://acttub.com/e/e1')));
    m.shareKakaoFeed.mockRejectedValueOnce(new Error('KOE006'));
    await fireEvent.press(screen.getByLabelText('카카오톡'));
    await waitFor(() => expect(m.openSystemShare).toHaveBeenCalledTimes(2));
    expect(logEvent).toHaveBeenCalledWith('challenge_share_kakao_error', { id: 'e1', reason: 'KOE006' });
  });

  it('내 참여작의 더 보기는 영상 파일과 링크 문장을 같이 넘기고, 스레드는 intent 주소를 연다', async () => {
    await open();
    await fireEvent.press(screen.getByLabelText('더 보기'));
    await waitFor(() =>
      expect(m.openSystemShareWithVideo).toHaveBeenCalledWith('file:///c/a.mp4', expect.stringContaining('https://acttub.com/e/e1')),
    );
    expect(m.videoDeps.download).toHaveBeenCalledWith('https://v/1.mp4');
    expect(m.openSystemShare).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('스레드'));
    await waitFor(() => expect(m.openUrl).toHaveBeenCalledWith(expect.stringContaining('https://www.threads.net/intent/post?text=')));
  });

  it('영상을 못 받으면 더 보기에 링크 문장만 보낸다', async () => {
    m.videoDeps.download.mockRejectedValue(new Error('network'));
    await open();
    await fireEvent.press(screen.getByLabelText('더 보기'));
    await waitFor(() => expect(m.openSystemShare).toHaveBeenCalledWith(expect.stringContaining('https://acttub.com/e/e1')));
    expect(m.openSystemShareWithVideo).not.toHaveBeenCalled();
  });

  it('링크 복사는 복사하고 토스트를 보인다', async () => {
    await open();
    await fireEvent.press(screen.getByLabelText('링크 복사'));
    expect(await screen.findByText('링크를 복사했어요')).toBeTruthy();
    expect(m.copyText).toHaveBeenCalledWith(expect.stringContaining('https://acttub.com/e/e1'));
  });

  it('영상 저장: 받아서 사진첩에 저장하고 완료 토스트를 보인다', async () => {
    await open();
    await fireEvent.press(screen.getByText('영상으로 저장'));
    expect(await screen.findByText('사진첩에 저장했어요')).toBeTruthy();
    expect(m.saveVideoToLibrary).toHaveBeenCalledWith('file:///c/a.mp4');
    expect(m.videoDeps.remove).toHaveBeenCalledWith('file:///c/a.mp4');
  });

  it('영상 저장: 권한이 없으면 안내를 보인다', async () => {
    m.saveVideoToLibrary.mockRejectedValue(new ShareError('permission_denied'));
    await open();
    await fireEvent.press(screen.getByText('영상으로 저장'));
    expect(await screen.findByText('사진첩 저장 권한이 없어요. 설정에서 허용해 주세요.')).toBeTruthy();
  });

  it('프레임: 내 참여작은 미리보기와 흰색·파랑·검정·없음을 보이고 흰색이 먼저 골라져 있다', async () => {
    await open();
    expect(screen.getByText('프레임')).toBeTruthy();
    expect(screen.getByText('인스타·영상 저장에 들어가요')).toBeTruthy();
    for (const label of ['흰색', '파랑', '검정', '없음']) expect(screen.getByLabelText(label)).toBeTruthy();
    expect(screen.getByLabelText('흰색').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByLabelText('파랑').props.accessibilityState).toMatchObject({ selected: false });
    await waitFor(() => expect(frames.getShareFramePreview).toHaveBeenCalledTimes(4));
    expect(frames.getShareFramePreview.mock.calls.map((call) => call[1])).toEqual(['white', 'blue', 'black', 'none']);
    expect(await screen.findByLabelText('흰색 프레임 미리보기')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('검정'));
    expect(screen.getByLabelText('검정').props.accessibilityState).toMatchObject({ selected: true });
    expect(await screen.findByLabelText('검정 프레임 미리보기')).toBeTruthy();
  });

  it('프레임: 남의 참여작에는 프레임 줄이 없고 미리보기를 받지 않는다', async () => {
    await open({ ...mine, is_mine: false });
    expect(screen.queryByText('프레임')).toBeNull();
    expect(frames.getShareFramePreview).not.toHaveBeenCalled();
  });

  it('프레임: 인스타는 고른 프레임 영상이 준비될 때까지 「프레임 넣는 중…」을 보이고 그 영상을 보낸다', async () => {
    let ready: (v: { status: string; video_url: string }) => void = () => undefined;
    frames.requestShareFrame.mockReturnValue(new Promise((r) => (ready = r)));
    await open();
    await fireEvent.press(screen.getByLabelText('인스타'));
    expect(await screen.findByText('프레임 넣는 중…')).toBeTruthy();
    expect(frames.requestShareFrame).toHaveBeenCalledWith('e1', 'white');
    await act(async () => ready({ status: 'ready', video_url: 'https://f/framed.mp4' }));
    await waitFor(() => expect(m.shareVideoToInstagramStory).toHaveBeenCalledWith('file:///c/a.mp4'));
    expect(m.videoDeps.download).toHaveBeenCalledWith('https://f/framed.mp4');
    expect(m.videoDeps.download).not.toHaveBeenCalledWith('https://v/1.mp4');
  });

  it('프레임: 넣지 못하면 다시 시도할 수 있는 안내를 보이고 원본 영상으로 대신 보내지 않는다', async () => {
    frames.requestShareFrame.mockResolvedValueOnce({ status: 'failed', video_url: null });
    await open();
    await fireEvent.press(screen.getByLabelText('인스타'));
    expect(await screen.findByText('프레임을 넣지 못했어요. 다시 해 주세요.')).toBeTruthy();
    expect(m.videoDeps.download).not.toHaveBeenCalled();
    expect(m.shareVideoToInstagramStory).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('다시 시도'));
    await waitFor(() => expect(m.shareVideoToInstagramStory).toHaveBeenCalledWith('file:///c/a.mp4'));
    expect(frames.requestShareFrame).toHaveBeenCalledTimes(2);
  });

  it('프레임: 영상 저장도 고른 프레임 영상을 저장한다', async () => {
    await open();
    await fireEvent.press(screen.getByLabelText('파랑'));
    await fireEvent.press(screen.getByText('영상으로 저장'));
    expect(await screen.findByText('사진첩에 저장했어요')).toBeTruthy();
    expect(frames.requestShareFrame).toHaveBeenCalledWith('e1', 'blue');
    expect(m.videoDeps.download).toHaveBeenCalledWith('https://f/framed.mp4');
    expect(logEvent).toHaveBeenCalledWith('challenge_share_save', { id: 'e1', frame: 'blue' });
  });

  it('프레임: 얼굴 가림이 준비되지 않았으면 안내를 보이고 원본에 씌우거나 원본을 보내지 않는다', async () => {
    const notReady = Object.assign(new Error('mosaic'), { status: 422, code: 'mosaic_not_ready' });
    frames.getShareFramePreview.mockImplementation((_id: string, frame: string) =>
      frame === 'none' ? Promise.resolve({ image_url: 'https://p/none.jpg' }) : Promise.reject(notReady),
    );
    frames.requestShareFrame.mockRejectedValue(notReady);
    await open();
    const message = '얼굴 가림을 준비하고 있어요. 잠시 후 다시 해 주세요.';
    expect(await screen.findByText(message)).toBeTruthy();
    await fireEvent.press(screen.getByText('영상으로 저장'));
    await waitFor(() => expect(frames.requestShareFrame).toHaveBeenCalledWith('e1', 'white'));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText('다시 시도')).toBeNull();
    expect(m.videoDeps.download).not.toHaveBeenCalled();
    expect(m.saveVideoToLibrary).not.toHaveBeenCalled();

    // 「없음」은 지금처럼 재생 주소의 영상을 그대로 저장한다.
    await fireEvent.press(screen.getByLabelText('없음'));
    expect(screen.queryByText(message)).toBeNull();
    await fireEvent.press(screen.getByText('영상으로 저장'));
    expect(await screen.findByText('사진첩에 저장했어요')).toBeTruthy();
    expect(m.videoDeps.download).toHaveBeenCalledWith('https://v/1.mp4');
  });

  it('바깥을 누르면 닫는다', async () => {
    const onClose = await open();
    await fireEvent.press(screen.getByLabelText('닫기'));
    expect(onClose).toHaveBeenCalled();
  });

  it('entry 가 없으면 아무것도 그리지 않는다', async () => {
    await render(<EntryShareSheet visible entry={null} line="" onClose={jest.fn()} />);
    expect(screen.queryByText('내 연기 공유하기')).toBeNull();
  });
});

import { Text, Pressable } from 'react-native';
import { useEntryShare } from '@/components/entry-share-sheet';

function Host({ onUnavailable, id }: { onUnavailable: () => void; id: string }) {
  const share = useEntryShare('잘 지내', onUnavailable);
  return (
    <>
      <Pressable onPress={() => void share.openById(id)}>
        <Text>go</Text>
      </Pressable>
      <Pressable
        onPress={() => share.open({ id: 'x', is_mine: false, published_at: null, playback_url: null, author: { name: 'a' } })}>
        <Text>closed</Text>
      </Pressable>
      {share.sheet}
    </>
  );
}

describe('useEntryShare', () => {
  it('참여작을 받아 시트를 연다', async () => {
    (api.getEntry as jest.Mock).mockResolvedValue({ ...mine, author: { name: '지성' } });
    await render(<Host id="e1" onUnavailable={jest.fn()} />);
    await fireEvent.press(screen.getByText('go'));
    expect(await screen.findByText('내 연기 공유하기')).toBeTruthy();
  });

  it('불러오지 못하거나 공유할 길이 없으면 알린다', async () => {
    (api.getEntry as jest.Mock).mockRejectedValue(new Error('x'));
    const onUnavailable = jest.fn();
    await render(<Host id="e1" onUnavailable={onUnavailable} />);
    await fireEvent.press(screen.getByText('go'));
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByText('closed'));
    expect(onUnavailable).toHaveBeenCalledTimes(2);
  });
});
