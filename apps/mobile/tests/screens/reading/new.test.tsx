import { usePreventRemove } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';

import ReadingNew from '@/app/reading/new';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-request';
import { SAMPLE_SCRIPT } from '@/lib/reading/sample';
import { resetReadingState } from '@/lib/reading/store';
import type { ScriptImport } from '@/lib/reading/types';

import { closeModalOf, fakeServer, scriptDetail, TWO_ROLE_LINES } from './fixtures';

jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = require('@react-native-async-storage/async-storage/jest/async-storage-mock');
  return { __esModule: true, default: storage };
});
const mockRouter = { replace: jest.fn(), push: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@react-navigation/native', () => ({ usePreventRemove: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  File: class {
    size = 4096;
  },
}));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn(async () => undefined) }));
jest.mock('@/lib/api', () => ({
  api: {
    importScript: jest.fn(),
    getScriptImport: jest.fn(),
    createScriptUpload: jest.fn(),
    startUploadToUrl: jest.fn(),
    completeScriptUpload: jest.fn(),
    consentEntry: jest.fn(),
    recordConsent: jest.fn(),
  },
}));

const PASTED = '민재: 오늘 왔구나.\n서연: 응, 늦어서 미안해.\n민재: 괜찮아.';

function job(over: Partial<ScriptImport> = {}): ScriptImport {
  return { id: 'i1', status: 'succeeded', progress: { done_lines: 3, total_lines: 3 }, script_id: 's1', failure: null, ...over };
}

const CONSENT_DOC = {
  id: 'd1',
  type: 'script_split',
  version: '1',
  title: '대본 나누기 동의',
  body: '# 대본 나누기 동의\n\n대본 글을 나누는 데만 써요.',
  required: false,
  published_at: '2026-10-01T00:00:00Z',
  current_decision: null,
};
const consentRequired = () => new ApiError(403, 'consent', 'script_split_consent_required');

let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  resetReadingState();
  server = fakeServer(scriptDetail(TWO_ROLE_LINES));
  jest.mocked(api.importScript).mockResolvedValue({ import_id: 'i1', duplicate_script_id: null });
  jest.mocked(api.getScriptImport).mockResolvedValue(job());
  jest.mocked(api.createScriptUpload).mockResolvedValue({ upload_id: 'u1', upload_url: 'https://upload.test/u1', content_type: 'text/plain', expires_at: '2026-10-20T00:15:00Z' });
  jest.mocked(api.startUploadToUrl).mockReturnValue({ result: Promise.resolve({ kind: 'uploaded' }), cancel: jest.fn() });
  jest.mocked(api.completeScriptUpload).mockResolvedValue(undefined);
  jest.mocked(api.consentEntry).mockResolvedValue({ entry_status: 'decision_required', documents: [CONSENT_DOC], undecided_documents: [CONSENT_DOC] } as never);
  jest.mocked(api.recordConsent).mockResolvedValue(undefined);
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///cache/대본.txt', name: '대본.txt', size: 2048 }],
  } as never);
});

async function paste(text = PASTED) {
  await fireEvent.press(screen.getByRole('tab', { name: /글 붙여넣기/ }));
  await fireEvent.changeText(screen.getByPlaceholderText('복사한 대본을 여기에 붙여넣어 주세요.\n형식은 그대로 둬도 괜찮아요.'), text);
}

test('처음에는 파일 탭을 보이고, 넣은 것이 없으면 다음을 누를 수 없다', async () => {
  await render(<ReadingNew />);

  expect(screen.getByRole('tab', { name: /파일 업로드/ })).toBeSelected();
  expect(screen.getByText('연습할 대본을\n넣어 주세요')).toBeOnTheScreen();
  expect(screen.getByText('파일을 올리거나 내용을 붙여넣어\n바로 연습할 수 있어요.')).toBeOnTheScreen();
  expect(screen.getByText('대본 파일 첨부')).toBeOnTheScreen();
  expect(screen.getByText('TXT · DOCX · PDF · HWP · 50MB까지')).toBeOnTheScreen();
  expect(screen.getByText('파일 선택하기')).toBeOnTheScreen();
  expect(screen.getByPlaceholderText('예) 옥상, 밤 · 갈매기 · 입시 1차 등')).toBeOnTheScreen();
  // 예시 대본은 「대본 같이 만들기」에서 고른다 — 이 화면에는 링크가 없다(10/25).
  expect(screen.queryByText('예시 대본으로 시작해보기')).not.toBeOnTheScreen();
  expect(screen.getByText('다음')).toBeDisabled();
});

test('붙여넣은 글과 제목을 보내 나누고, 대본 상세로 간다(목소리는 자동)', async () => {
  await render(<ReadingNew />);
  await fireEvent.changeText(screen.getByLabelText('제목 (선택)'), '  봄날의 대화  ');
  await paste();

  await fireEvent.press(screen.getByText('다음'));

  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/reading/detail'));
  expect(api.importScript).toHaveBeenCalledWith({
    request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    allow_duplicate: false,
    skip_script_check: false,
    title: '봄날의 대화',
    source: 'paste',
    raw_text: PASTED,
  });
  expect(server.get).toHaveBeenCalledWith('s1');
});

test('배역이 하나뿐인 대본은 나눈 뒤 대본 상세로 간다', async () => {
  server.get.mockResolvedValue(scriptDetail([['dialogue', '민재', '혼자야.']]));
  await render(<ReadingNew />);
  await paste('민재: 혼자야.');

  await fireEvent.press(screen.getByText('다음'));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/reading/detail'));
  expect(jest.mocked(api.importScript).mock.calls[0][0]).toEqual(expect.objectContaining({ source: 'typed', raw_text: '민재: 혼자야.' }));
});

const MONO_LINES: Parameters<typeof scriptDetail>[0] = [
  ['dialogue', '민지', '그래서 더 말하기 싫었어.'],
  ['dialogue', '민지', '네가 그걸 아니까.'],
  ['dialogue', '민지', '나도 내가 얼마나 준비했는지 알아.'],
  ['dialogue', '민지', '그래서 더 아팠어.'],
];

test('SOMA-597: 이름 없는 독백으로 나뉘면 「혼자 하는 대본이에요」에서 배역 이름을 받아 고친 뒤 대본 상세로 간다', async () => {
  const mono = scriptDetail(MONO_LINES);
  server.get.mockResolvedValue({ ...mono, characters: [{ ...mono.characters[0], name: '화자', unnamed: true }] });
  await render(<ReadingNew />);
  await paste('그래서 더 말하기 싫었어. 네가 그걸 아니까.');

  await fireEvent.press(screen.getByText('다음'));
  expect(await screen.findByText('혼자 하는 대본이에요')).toBeOnTheScreen();
  expect(screen.getByText('배역 이름이 없어서 한 사람의 독백으로 나눴어요.\n누구의 대사인지 이름을 정해 주세요.')).toBeOnTheScreen();
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '이 이름으로 저장' })).toBeDisabled();

  await fireEvent.changeText(screen.getByPlaceholderText('배역 이름'), '  민지 ');
  await fireEvent.press(screen.getByRole('button', { name: '이 이름으로 저장' }));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/reading/detail'));
  expect(server.patch).toHaveBeenCalledWith('s1', { characters: [{ id: 'c1', name: '민지' }] });
});

test('SOMA-597: 이름이 있는 독백은 이름을 묻지 않고 대본 상세로 간다', async () => {
  server.get.mockResolvedValue(scriptDetail(MONO_LINES));
  await render(<ReadingNew />);
  await paste('민지: 그래서 더 말하기 싫었어.');

  await fireEvent.press(screen.getByText('다음'));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/reading/detail'));
  expect(screen.queryByText('혼자 하는 대본이에요')).not.toBeOnTheScreen();
});

test('「대본 같이 만들기」는 화면을 넘기지 않고 아래에 예시 대본 고르기·새 대본 만들기를 펼친다', async () => {
  await render(<ReadingNew />);

  await fireEvent.press(screen.getByRole('tab', { name: /대본 같이 만들기/ }));
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(screen.queryByText('대본 파일 첨부')).not.toBeOnTheScreen();
  expect(screen.getByText('다음')).toBeDisabled();

  // 예시 대본 고르기 — 그 아래에 예시 카드와 고르기 칩이 바로 보인다.
  await fireEvent.press(screen.getByText('예시 대본 고르기'));
  expect(screen.getByText('대본 목록')).toBeOnTheScreen();
  expect(screen.getByText('이 대본으로 하기')).toBeOnTheScreen();
  expect(mockRouter.push).not.toHaveBeenCalled();

  // 새 대본 만들기 — 「다음」으로 대본 만들기의 감정 고르기부터 연다.
  await fireEvent.press(screen.getByText('새로 만들기'));
  await fireEvent.press(screen.getByText('다음'));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/script-cocreate', params: { mode: 'reading', start: 'make' } });

  // 다른 탭을 누르면 다시 파일 올리기로 돌아온다.
  await fireEvent.press(screen.getByRole('tab', { name: /파일 업로드/ }));
  expect(screen.getByText('대본 파일 첨부')).toBeOnTheScreen();
});

test('튜토리얼 예시로 들어오면 예시 대본을 채운 채 연다', async () => {
  mockParams = { sample: '1' };
  await render(<ReadingNew />);

  expect(screen.getByDisplayValue(SAMPLE_SCRIPT)).toBeOnTheScreen();
});

test('나누는 동안 서버가 알려 주는 줄 수를 보인다', async () => {
  jest.mocked(api.getScriptImport)
    .mockResolvedValueOnce(job({ status: 'running', progress: { done_lines: 3, total_lines: 10 }, script_id: null }))
    .mockResolvedValue(job());
  await render(<ReadingNew />);
  await paste();

  const pressing = fireEvent.press(screen.getByText('다음'));
  expect(await screen.findByText('배역과 대사를 찾고 있어요…')).toBeOnTheScreen();
  expect(await screen.findByText('30% · 3 / 10줄')).toBeOnTheScreen();
  expect(usePreventRemove).toHaveBeenLastCalledWith(true, expect.any(Function));
  await act(async () => pressing);
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled(), { timeout: 3000 });
});

test('같은 글의 대본이 있으면 그 대본을 열거나 새로 넣을 수 있다', async () => {
  jest.mocked(api.importScript).mockResolvedValueOnce({ import_id: null, duplicate_script_id: 's1' });
  await render(<ReadingNew />);
  await paste();

  await fireEvent.press(screen.getByText('다음'));
  expect(await screen.findByText('이미 넣은 대본이에요')).toBeOnTheScreen();
  expect(screen.getByText('「봄날의 대화」')).toBeOnTheScreen();
  expect(screen.getByText('「그 대본 열기」를 누르면 하던 데서 이어져요.')).toBeOnTheScreen();

  await fireEvent.press(screen.getByText('그래도 넣기'));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/reading/detail'));
  expect(jest.mocked(api.importScript).mock.calls[1][0]).toEqual(expect.objectContaining({ allow_duplicate: true, raw_text: PASTED }));
});

test('같은 글의 대본 열기를 고르면 그 대본 상세로 간다', async () => {
  jest.mocked(api.importScript).mockResolvedValueOnce({ import_id: null, duplicate_script_id: 's1' });
  await render(<ReadingNew />);
  await paste();
  await fireEvent.press(screen.getByText('다음'));

  await fireEvent.press(await screen.findByText('그 대본 열기'));
  expect(mockRouter.replace).toHaveBeenCalledWith('/reading/detail');
  expect(api.importScript).toHaveBeenCalledTimes(1);
});

test('같은 글의 대본을 불러오지 못하면 연결 문구를 띄운다', async () => {
  jest.mocked(api.importScript).mockResolvedValueOnce({ import_id: null, duplicate_script_id: 'gone' });
  server.get.mockRejectedValue(new ApiError(404, 'gone', 'script_not_found'));
  await render(<ReadingNew />);
  await paste();

  await fireEvent.press(screen.getByText('다음'));
  expect(await screen.findByText('네트워크 연결을 확인하고 다시 시도해 주세요.')).toBeOnTheScreen();
});

test('대본이 아닌 것 같다면 그래도 나누거나 다시 고를 수 있다', async () => {
  jest.mocked(api.getScriptImport).mockResolvedValueOnce(job({ status: 'failed', failure: 'not_script', script_id: null }));
  await render(<ReadingNew />);
  await paste();

  await fireEvent.press(screen.getByText('다음'));
  expect(await screen.findByText('대본이 아닌 것 같아요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('다시 고르기'));
  expect(screen.queryByText('대본이 아닌 것 같아요')).not.toBeOnTheScreen();

  jest.mocked(api.getScriptImport).mockResolvedValueOnce(job({ status: 'failed', failure: 'not_script', script_id: null }));
  await fireEvent.press(screen.getByText('다음'));
  await fireEvent.press(await screen.findByText('그래도 나누기'));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
  expect(jest.mocked(api.importScript).mock.calls.at(-1)![0]).toEqual(expect.objectContaining({ skip_script_check: true }));
});

test('배역을 못 찾으면 「대본을 못 나눴어요」 화면에 이유를 보이고, 뒤로 가면 닫는다', async () => {
  jest.mocked(api.getScriptImport).mockResolvedValueOnce(job({ status: 'failed', failure: 'no_characters', script_id: null }));
  await render(<ReadingNew />);
  await paste();

  await fireEvent.press(screen.getByText('다음'));
  expect(await screen.findByText('대본을 못 나눴어요')).toBeOnTheScreen();
  expect(screen.getByText('대본에 말하는 사람 이름이 있는지 확인하고 다시 넣어 주세요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByLabelText('뒤로'));
  expect(screen.queryByText('대본을 못 나눴어요')).not.toBeOnTheScreen();
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test.each([
  ['하루 한도를 넘으면', () => jest.mocked(api.importScript).mockRejectedValueOnce(new ApiError(429, 'limit', 'script_split_daily_limit')), '오늘은 대본을 더 넣을 수 없어요', '대본은 하루 20번까지 나눌 수 있어요.\n내일 다시 넣어 주세요.'],
  ['대본이 너무 길면', () => jest.mocked(api.getScriptImport).mockResolvedValueOnce(job({ status: 'failed', failure: 'script_too_long', script_id: null })), '저장', '대본이 너무 길어요. 원문 100,000자까지 저장할 수 있어요.'],
])('%s 알리고 확인을 누르면 닫는다', async (_name, arrange, title, message) => {
  arrange();
  await render(<ReadingNew />);
  await paste();

  await fireEvent.press(screen.getByText('다음'));
  expect(await screen.findByText(message)).toBeOnTheScreen();
  expect(screen.getAllByText(title).length).toBeGreaterThan(0);
  await fireEvent.press(screen.getByText('확인'));
  expect(screen.queryByText(message)).not.toBeOnTheScreen();
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test('나눈 대본을 불러오지 못하면 연결 문구를 띄운다', async () => {
  server.get.mockRejectedValue(new Error('offline'));
  await render(<ReadingNew />);
  await paste();

  await fireEvent.press(screen.getByText('다음'));
  expect(await screen.findByText('네트워크 연결을 확인하고 다시 시도해 주세요.')).toBeOnTheScreen();
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test('알림은 뒤로 가기로도 닫힌다', async () => {
  jest.mocked(api.importScript).mockRejectedValueOnce(new ApiError(429, 'limit', 'script_split_daily_limit'));
  await render(<ReadingNew />);
  await paste();
  await fireEvent.press(screen.getByText('다음'));

  await screen.findByText('오늘은 대본을 더 넣을 수 없어요');
  await closeModalOf('오늘은 대본을 더 넣을 수 없어요');
  expect(screen.queryByText('오늘은 대본을 더 넣을 수 없어요')).not.toBeOnTheScreen();
});

test('나누기 동의가 없으면 동의를 받고, 동의하면 같은 글을 이어서 나눈다', async () => {
  jest.mocked(api.importScript).mockRejectedValueOnce(consentRequired());
  await render(<ReadingNew />);
  await paste();

  await fireEvent.press(screen.getByText('다음'));
  expect(await screen.findByText('대본을 나누려면 동의가 필요해요')).toBeOnTheScreen();
  expect(screen.getByText('대본 글을 OpenAI로 보내 배역과 대사를 나눠요.')).toBeOnTheScreen();
  expect(screen.queryByText('대본 글을 나누는 데만 써요.')).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByText('자세히 보기'));
  expect(screen.getByText('대본 글을 나누는 데만 써요.')).toBeOnTheScreen();
  await closeModalOf('대본을 나누려면 동의가 필요해요');
  expect(screen.queryByText('대본을 나누려면 동의가 필요해요')).not.toBeOnTheScreen();

  jest.mocked(api.importScript).mockRejectedValueOnce(consentRequired());
  await fireEvent.press(screen.getByText('다음'));
  await fireEvent.press(await screen.findByText('동의하고 나누기'));

  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/reading/detail'));
  expect(api.recordConsent).toHaveBeenCalledWith('d1', 'granted');
  expect(api.importScript).toHaveBeenCalledTimes(3);
});

test('동의 시트에서 취소하면 닫고 나누지 않는다', async () => {
  jest.mocked(api.importScript).mockRejectedValueOnce(consentRequired());
  await render(<ReadingNew />);
  await paste();
  await fireEvent.press(screen.getByText('다음'));

  await fireEvent.press(await screen.findByText('취소'));
  expect(screen.queryByText('대본을 나누려면 동의가 필요해요')).not.toBeOnTheScreen();
  expect(api.recordConsent).not.toHaveBeenCalled();
});

test('동의를 기록하지 못하면 이유를 알린다', async () => {
  jest.mocked(api.importScript).mockRejectedValueOnce(consentRequired());
  jest.mocked(api.recordConsent).mockRejectedValue(new Error('동의를 저장하지 못했어요'));
  await render(<ReadingNew />);
  await paste();
  await fireEvent.press(screen.getByText('다음'));

  await fireEvent.press(await screen.findByText('동의하고 나누기'));
  expect(await screen.findByText('동의를 저장하지 못했어요')).toBeOnTheScreen();
  expect(api.importScript).toHaveBeenCalledTimes(1);
});

test('동의할 문서가 아직 없으면 권한 없음으로 알린다', async () => {
  jest.mocked(api.importScript).mockRejectedValueOnce(consentRequired());
  jest.mocked(api.consentEntry).mockResolvedValue({ entry_status: 'allowed', documents: [], undecided_documents: [] } as never);
  await render(<ReadingNew />);
  await paste();

  await fireEvent.press(screen.getByText('다음'));
  expect(await screen.findByText('이 작업을 할 권한이 없어요.')).toBeOnTheScreen();
});

test('동의 문서를 불러오지 못하면 이유를 알린다', async () => {
  jest.mocked(api.importScript).mockRejectedValueOnce(consentRequired());
  jest.mocked(api.consentEntry).mockRejectedValue(new Error('동의 항목을 못 불러왔어요'));
  await render(<ReadingNew />);
  await paste();

  await fireEvent.press(screen.getByText('다음'));
  expect(await screen.findByText('동의 항목을 못 불러왔어요')).toBeOnTheScreen();
});

test('파일을 고르면 올려 두고 이름과 크기를 보인 뒤, 다음을 누르면 그 파일로 나눈다', async () => {
  let uploaded: (v: { kind: 'uploaded' }) => void = () => undefined;
  jest.mocked(api.startUploadToUrl).mockReturnValue({ result: new Promise((resolve) => (uploaded = resolve)), cancel: jest.fn() });
  await render(<ReadingNew />);

  const picking = fireEvent.press(screen.getByText('대본 파일 첨부'));
  expect(await screen.findByText('읽는 중…')).toBeOnTheScreen();
  expect(screen.getByText('대본.txt · 2KB')).toBeOnTheScreen();
  expect(usePreventRemove).toHaveBeenLastCalledWith(true, expect.any(Function));
  await act(async () => uploaded({ kind: 'uploaded' }));
  await act(async () => picking);

  expect(screen.getByText('대본.txt')).toBeOnTheScreen();
  expect(screen.getByText('2KB')).toBeOnTheScreen();
  expect(screen.getByText('다른 파일로 바꾸기')).toBeOnTheScreen();
  expect(screen.queryByText('예시 대본으로 시작해보기')).not.toBeOnTheScreen();
  expect(api.createScriptUpload).toHaveBeenCalledWith({ file_name: '대본.txt', byte_size: 2048 });
  expect(api.startUploadToUrl).toHaveBeenCalledWith('https://upload.test/u1', 'file:///cache/대본.txt', 'text/plain');

  await fireEvent.press(screen.getByText('다음'));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
  expect(jest.mocked(api.importScript).mock.calls[0][0]).toEqual(expect.objectContaining({ source: 'file', upload_id: 'u1' }));
  expect(jest.mocked(api.completeScriptUpload).mock.calls).toEqual([['u1'], ['u1']]);
});

test('크기를 알려 주지 않는 파일은 파일에서 크기를 읽는다', async () => {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///cache/대본.hwp', name: '대본.hwp' }],
  } as never);
  await render(<ReadingNew />);

  await fireEvent.press(screen.getByText('대본 파일 첨부'));
  expect(await screen.findByText('4KB')).toBeOnTheScreen();
  expect(api.createScriptUpload).toHaveBeenCalledWith({ file_name: '대본.hwp', byte_size: 4096 });
});

test('파일 고르기를 그만두면 아무것도 바꾸지 않는다', async () => {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({ canceled: true, assets: null } as never);
  await render(<ReadingNew />);

  await fireEvent.press(screen.getByText('대본 파일 첨부'));
  expect(screen.getByText('대본 파일 첨부')).toBeOnTheScreen();
  expect(api.createScriptUpload).not.toHaveBeenCalled();
});

test('파일 고르기가 실패하면 이유를 알리고 빈 상태로 둔다', async () => {
  jest.mocked(DocumentPicker.getDocumentAsync).mockRejectedValue(new Error('파일 앱을 열 수 없어요'));
  await render(<ReadingNew />);

  await fireEvent.press(screen.getByText('대본 파일 첨부'));
  expect(await screen.findByText('파일 앱을 열 수 없어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('확인'));
  expect(screen.getByText('대본 파일 첨부')).toBeOnTheScreen();
});

test('50MB 를 넘는 파일은 올리지 않고 너무 크다고 알린다', async () => {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///cache/big.pdf', name: 'big.pdf', size: 60_000_000 }],
  } as never);
  await render(<ReadingNew />);

  await fireEvent.press(screen.getByText('대본 파일 첨부'));
  expect(await screen.findByText('파일이 너무 커요. 50MB까지 열 수 있어요.')).toBeOnTheScreen();
  expect(screen.getByText('파일을 읽지 못했어요')).toBeOnTheScreen();
  expect(api.createScriptUpload).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('확인'));
  expect(screen.getByText('대본 파일 첨부')).toBeOnTheScreen();
});

test('서버의 읽기 자리가 없으면 올린 파일은 두고 잠시 뒤 다시 하라고 알린다', async () => {
  jest.mocked(api.completeScriptUpload).mockRejectedValueOnce(new ApiError(429, 'busy', 'script_upload_busy'));
  await render(<ReadingNew />);

  await fireEvent.press(screen.getByText('대본 파일 첨부'));
  expect(await screen.findByText('요청이 잠시 몰렸어요. 1분 뒤에 다시 시도해 주세요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('확인'));
  expect(screen.getByText('대본.txt')).toBeOnTheScreen();
  expect(screen.getByText('다음')).toBeEnabled();
});

test('올리는 중에 끊기면 연결 문구를 띄우고 파일을 비운다', async () => {
  jest.mocked(api.startUploadToUrl).mockReturnValue({ result: Promise.resolve({ kind: 'cancelled' }), cancel: jest.fn() });
  await render(<ReadingNew />);

  await fireEvent.press(screen.getByText('대본 파일 첨부'));
  expect(await screen.findByText('네트워크 연결을 확인하고 다시 시도해 주세요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByLabelText('뒤로'));
  expect(screen.getByText('대본 파일 첨부')).toBeOnTheScreen();
});

test('파일을 올리다 동의가 필요하면 동의 뒤 올리기부터 나누기까지 잇는다', async () => {
  jest.mocked(api.completeScriptUpload).mockRejectedValueOnce(consentRequired());
  await render(<ReadingNew />);
  await fireEvent.changeText(screen.getByLabelText('제목 (선택)'), '파일 대본');

  await fireEvent.press(screen.getByText('대본 파일 첨부'));
  await fireEvent.press(await screen.findByText('동의하고 나누기'));

  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/reading/detail'));
  expect(api.createScriptUpload).toHaveBeenCalledTimes(2);
  expect(jest.mocked(api.importScript).mock.calls[0][0]).toEqual(expect.objectContaining({ source: 'file', upload_id: 'u1', title: '파일 대본' }));
});

test('동의 뒤 다시 올리다 실패하면 나누지 않는다', async () => {
  jest.mocked(api.completeScriptUpload).mockRejectedValueOnce(consentRequired()).mockRejectedValueOnce(new ApiError(422, 'bad', 'script_file_unreadable'));
  await render(<ReadingNew />);

  await fireEvent.press(screen.getByText('대본 파일 첨부'));
  await fireEvent.press(await screen.findByText('동의하고 나누기'));

  expect(await screen.findByText('대본을 읽지 못했어요. 스캔한 PDF이거나 지원하지 않는 형식일 수 있어요. 복사해서 붙여넣어 주세요.')).toBeOnTheScreen();
  expect(api.importScript).not.toHaveBeenCalled();
});

test('나누다 원본을 읽을 수 없다고 하면 파일 칸을 비운다', async () => {
  await render(<ReadingNew />);
  await fireEvent.press(screen.getByText('대본 파일 첨부'));
  await screen.findByText('다른 파일로 바꾸기');
  jest.mocked(api.completeScriptUpload).mockRejectedValueOnce(new ApiError(404, 'gone', 'script_upload_not_found'));

  await fireEvent.press(screen.getByText('다음'));
  expect(await screen.findByText('대본을 못 나눴어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByLabelText('뒤로'));
  expect(screen.getByText('대본 파일 첨부')).toBeOnTheScreen();
});

test('이미 대본이 된 원본이면 다시 올려 새 원본으로 나눈다', async () => {
  await render(<ReadingNew />);
  await fireEvent.press(screen.getByText('대본 파일 첨부'));
  await screen.findByText('다른 파일로 바꾸기');
  jest.mocked(api.importScript).mockRejectedValueOnce(new ApiError(409, 'used', 'script_upload_used'));
  jest.mocked(api.createScriptUpload).mockResolvedValueOnce({ upload_id: 'u2', upload_url: 'https://upload.test/u2', content_type: 'text/plain', expires_at: '2026-10-20T00:15:00Z' });

  await fireEvent.press(screen.getByText('다음'));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
  expect(jest.mocked(api.importScript).mock.calls.map(([body]) => (body as { upload_id: string }).upload_id)).toEqual(['u1', 'u2']);
});

test('나누는 중에 화면을 떠나면 끝나도 다른 화면으로 옮기지 않는다', async () => {
  let finish: (v: ScriptImport) => void = () => undefined;
  jest.mocked(api.getScriptImport).mockImplementation(() => new Promise((resolve) => (finish = resolve)));
  await render(<ReadingNew />);
  await paste();

  const pressing = fireEvent.press(screen.getByText('다음'));
  await screen.findByText('배역과 대사를 찾고 있어요…');
  await screen.unmount();
  finish(job());
  await act(async () => pressing);
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test('탭마다 넣은 것을 따로 들고, 보고 있는 탭의 것을 보낸다', async () => {
  await render(<ReadingNew />);
  await paste();
  await fireEvent.press(screen.getByRole('tab', { name: /파일/ }));

  expect(screen.getByText('대본 파일 첨부')).toBeOnTheScreen();
  expect(screen.getByText('다음')).toBeDisabled();
  await fireEvent.press(screen.getByRole('tab', { name: /글 붙여넣기/ }));
  expect(screen.getByDisplayValue(PASTED)).toBeOnTheScreen();
  expect(screen.getByText('다음')).toBeEnabled();
});

test('무료 대본 1개(free_script_limit)면 「무료는 대본 1개까지 보관해요」, 바꾸기를 확인하면 지우고 같은 글로 다시 나눈다 (SOMA-818)', async () => {
  jest.mocked(api.importScript)
    .mockRejectedValueOnce(new ApiError(403, 'limit', 'free_script_limit'))
    .mockResolvedValueOnce({ import_id: 'i1', duplicate_script_id: null });
  server.list.mockResolvedValue({
    scripts: [{ id: 'old', title: '옥상, 밤' }],
    total_count: 1,
    in_progress_count: 0,
  } as never);
  await render(<ReadingNew />);
  await paste();
  await fireEvent.press(screen.getByText('다음'));

  expect(await screen.findByText('무료는 대본 1개까지 보관해요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('지금 대본과 바꾸기'));
  expect(await screen.findByText('「옥상, 밤」을 지우고\n새 대본을 넣을까요?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('지우고 새 대본 넣기'));

  await waitFor(() => expect(server.remove).toHaveBeenCalledWith('old'));
  await waitFor(() => expect(api.importScript).toHaveBeenCalledTimes(2));
  expect(jest.mocked(api.importScript).mock.calls[1][0]).toEqual(expect.objectContaining({ raw_text: PASTED }));
});

test('무료 대본 시트의 [Pro 알아보기]는 Pro 안내로 간다', async () => {
  jest.mocked(api.importScript).mockRejectedValueOnce(new ApiError(403, 'limit', 'free_script_limit'));
  await render(<ReadingNew />);
  await paste();
  await fireEvent.press(screen.getByText('다음'));
  await fireEvent.press(await screen.findByText('Pro 알아보기'));
  expect(mockRouter.push).toHaveBeenCalledWith('/pro');
});
