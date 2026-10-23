import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { EntryShareSheet, type ShareSheetEntry } from '@/components/entry-share-sheet';
import * as native from '@/lib/challenge/share-native';
import { ShareError } from '@/lib/challenge/share';

jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/api', () => ({ api: { getEntry: jest.fn() } }));
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
};

const mine: ShareSheetEntry = { id: 'e1', is_mine: true, published_at: '2026-10-20T00:00:00Z', playback_url: 'https://v/1.mp4', authorName: '지성' };

async function open(entry: ShareSheetEntry = mine) {
  const onClose = jest.fn();
  await render(<EntryShareSheet visible entry={entry} line="잘 지내, 진짜로." onClose={onClose} />);
  return onClose;
}

beforeEach(() => {
  jest.clearAllMocks();
  m.videoDeps.download.mockResolvedValue({ uri: 'file:///c/a.mp4', size: 1000 });
  m.isInstagramInstalled.mockResolvedValue(true);
  m.shareVideoToInstagramStory.mockResolvedValue(undefined);
  m.saveVideoToLibrary.mockResolvedValue(undefined);
  m.openSystemShare.mockResolvedValue(undefined);
  m.openSystemShareWithVideo.mockResolvedValue(undefined);
  m.openUrl.mockResolvedValue(undefined);
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

  it('인스타: 영상을 받아 스토리로 보내고 임시 파일을 지운다', async () => {
    await open();
    fireEvent.press(screen.getByLabelText('인스타'));
    await waitFor(() => expect(m.shareVideoToInstagramStory).toHaveBeenCalledWith('file:///c/a.mp4'));
    expect(m.videoDeps.download).toHaveBeenCalledWith('https://v/1.mp4');
    await waitFor(() => expect(m.videoDeps.remove).toHaveBeenCalledWith('file:///c/a.mp4'));
  });

  it('인스타: 받는 동안 준비 중 문구를 보인다', async () => {
    let finish: (v: { uri: string; size: number }) => void = () => undefined;
    m.videoDeps.download.mockReturnValue(new Promise((r) => (finish = r)));
    await open();
    fireEvent.press(screen.getByLabelText('인스타'));
    expect(await screen.findByText('영상을 준비하고 있어요…')).toBeTruthy();
    await act(async () => finish({ uri: 'f', size: 1 }));
    await waitFor(() => expect(screen.queryByText('영상을 준비하고 있어요…')).toBeNull());
  });

  it('인스타: 받기에 실패하면 안내를 보이고 스토리를 열지 않는다', async () => {
    m.videoDeps.download.mockRejectedValue(new Error('net'));
    await open();
    fireEvent.press(screen.getByLabelText('인스타'));
    expect(await screen.findByText('영상을 받지 못했어요. 연결을 확인하고 다시 해 주세요.')).toBeTruthy();
    expect(m.shareVideoToInstagramStory).not.toHaveBeenCalled();
  });

  it('인스타: 너무 큰 영상은 링크 공유를 안내한다', async () => {
    m.videoDeps.download.mockResolvedValue({ uri: 'f', size: 999 * 1024 * 1024 });
    await open();
    fireEvent.press(screen.getByLabelText('인스타'));
    expect(await screen.findByText(/너무 커서 스토리에 올릴 수 없어요/)).toBeTruthy();
  });

  it('인스타가 없으면 설치 안내와 함께 스토어를 연다', async () => {
    m.isInstagramInstalled.mockResolvedValue(false);
    await open();
    fireEvent.press(screen.getByLabelText('인스타'));
    expect(await screen.findByText(/인스타그램이 없어요/)).toBeTruthy();
    expect(m.openUrl).toHaveBeenCalledWith('market://details?id=com.instagram.android');
    expect(m.videoDeps.download).not.toHaveBeenCalled();
  });

  it('스토리를 닫아 오류가 나도 안내하지 않는다', async () => {
    m.shareVideoToInstagramStory.mockRejectedValue(new Error('User did not share'));
    await open();
    fireEvent.press(screen.getByLabelText('인스타'));
    await waitFor(() => expect(m.videoDeps.remove).toHaveBeenCalled());
    expect(screen.queryByText(/받지 못했어요/)).toBeNull();
  });

  it('내 참여작의 카카오톡·더 보기는 영상 파일과 링크 문장을 같이 넘기고, 스레드는 intent 주소를 연다', async () => {
    await open();
    fireEvent.press(screen.getByLabelText('카카오톡'));
    await waitFor(() =>
      expect(m.openSystemShareWithVideo).toHaveBeenCalledWith('file:///c/a.mp4', expect.stringContaining('https://acttub.com/e/e1')),
    );
    expect(m.videoDeps.download).toHaveBeenCalledWith('https://v/1.mp4');
    fireEvent.press(screen.getByLabelText('더 보기'));
    await waitFor(() => expect(m.openSystemShareWithVideo).toHaveBeenCalledTimes(2));
    expect(m.openSystemShare).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText('스레드'));
    await waitFor(() => expect(m.openUrl).toHaveBeenCalledWith(expect.stringContaining('https://www.threads.net/intent/post?text=')));
  });

  it('영상을 못 받으면 카카오톡에 링크 문장만 보낸다', async () => {
    m.videoDeps.download.mockRejectedValue(new Error('network'));
    await open();
    fireEvent.press(screen.getByLabelText('카카오톡'));
    await waitFor(() => expect(m.openSystemShare).toHaveBeenCalledWith(expect.stringContaining('https://acttub.com/e/e1')));
    expect(m.openSystemShareWithVideo).not.toHaveBeenCalled();
  });

  it('링크 복사는 복사하고 토스트를 보인다', async () => {
    await open();
    fireEvent.press(screen.getByLabelText('링크 복사'));
    expect(await screen.findByText('링크를 복사했어요')).toBeTruthy();
    expect(m.copyText).toHaveBeenCalledWith(expect.stringContaining('https://acttub.com/e/e1'));
  });

  it('영상 저장: 받아서 사진첩에 저장하고 완료 토스트를 보인다', async () => {
    await open();
    fireEvent.press(screen.getByText('영상으로 저장'));
    expect(await screen.findByText('사진첩에 저장했어요')).toBeTruthy();
    expect(m.saveVideoToLibrary).toHaveBeenCalledWith('file:///c/a.mp4');
    expect(m.videoDeps.remove).toHaveBeenCalledWith('file:///c/a.mp4');
  });

  it('영상 저장: 권한이 없으면 안내를 보인다', async () => {
    m.saveVideoToLibrary.mockRejectedValue(new ShareError('permission_denied'));
    await open();
    fireEvent.press(screen.getByText('영상으로 저장'));
    expect(await screen.findByText('사진첩 저장 권한이 없어요. 설정에서 허용해 주세요.')).toBeTruthy();
  });

  it('바깥을 누르면 닫는다', async () => {
    const onClose = await open();
    fireEvent.press(screen.getByLabelText('닫기'));
    expect(onClose).toHaveBeenCalled();
  });

  it('entry 가 없으면 아무것도 그리지 않는다', async () => {
    await render(<EntryShareSheet visible entry={null} line="" onClose={jest.fn()} />);
    expect(screen.queryByText('내 연기 공유하기')).toBeNull();
  });
});

import { Text, Pressable } from 'react-native';
import { api } from '@/lib/api';
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
    fireEvent.press(screen.getByText('go'));
    expect(await screen.findByText('내 연기 공유하기')).toBeTruthy();
  });

  it('불러오지 못하거나 공유할 길이 없으면 알린다', async () => {
    (api.getEntry as jest.Mock).mockRejectedValue(new Error('x'));
    const onUnavailable = jest.fn();
    await render(<Host id="e1" onUnavailable={onUnavailable} />);
    fireEvent.press(screen.getByText('go'));
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledTimes(1));
    fireEvent.press(screen.getByText('closed'));
    expect(onUnavailable).toHaveBeenCalledTimes(2);
  });
});
