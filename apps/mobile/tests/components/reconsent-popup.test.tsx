import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { ReconsentPopup } from '@/components/reconsent-popup';
import { api, type ConsentEntryDocument, type ConsentEntryResponse } from '@/lib/api';
import type { ConsentEntryState } from '@/lib/auth';
import { showMarketingNotice } from '@/lib/marketing-notice';

jest.mock('@/lib/api', () => ({ api: { recordConsent: jest.fn() } }));
jest.mock('@/lib/marketing-notice', () => ({ showMarketingNotice: jest.fn() }));

type AuthMock = { consentEntry: ConsentEntryState; refreshConsentEntry: jest.Mock };
let mockAuth: AuthMock;
jest.mock('@/lib/auth', () => ({ useAuth: () => mockAuth }));

const recordConsent = api.recordConsent as jest.Mock;

function doc(overrides: Partial<ConsentEntryDocument> & Pick<ConsentEntryDocument, 'id' | 'type' | 'title' | 'required'>): ConsentEntryDocument {
  return {
    version: '2',
    body: `# ${overrides.title}\n\n제1조 목적`,
    published_at: '2026-10-01T00:00:00+09:00',
    current_decision: null,
    ...overrides,
  };
}

const TERMS = doc({ id: 'd-terms', type: 'terms', title: '서비스 이용약관', required: true });
const PRIVACY = doc({ id: 'd-privacy', type: 'privacy', title: '개인정보 수집·이용 동의', required: true });
const RETENTION = doc({ id: 'd-retention', type: 'retention', title: '탈퇴 후 영상 보관', required: false });
const MAIL = doc({ id: 'd-mail', type: 'marketing_email', title: '광고성 정보 수신 동의 (이메일)', required: false });

function entry(documents: ConsentEntryDocument[]): ConsentEntryResponse {
  return { entry_status: 'decision_required', documents, undecided_documents: documents };
}

function decisionRequired(documents: ConsentEntryDocument[]): ConsentEntryState {
  return { status: 'decision_required', entry: entry(documents), error: null };
}

const ALLOWED: ConsentEntryResponse = { entry_status: 'allowed', documents: [], undecided_documents: [] };

function rowLabels() {
  return screen.getAllByRole('checkbox').map((row) => within(row).getByText(/^\[/).props.children);
}

function row(title: string) {
  return screen.getAllByRole('checkbox').find((item) => within(item).queryByText(new RegExp(title.replace(/[()]/g, '\\$&'))))!;
}

// 안드로이드 뒤로 가기는 팝업 모달의 onRequestClose 로 온다.
function modalOf(element: ReturnType<typeof screen.getByText>) {
  let node: typeof element | null = element;
  while (node && typeof node.props.onRequestClose !== 'function') node = node.parent;
  return node!;
}

const cta = () => screen.getByRole('button', { name: '동의하고 계속하기' });

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = {
    consentEntry: decisionRequired([RETENTION, TERMS]),
    refreshConsentEntry: jest.fn(async () => ALLOWED),
  };
});

test('제목과 바뀐 문서 줄을 필수부터 보여 주고, 필수에 모두 체크해야 계속할 수 있다', async () => {
  await render(<ReconsentPopup visible />);

  expect(screen.getByText('동의 문서가 바뀌었어요')).toBeOnTheScreen();
  // pen S4.8 — 흰 전체 화면, 제목 아래 회색 설명.
  expect(screen.getByText('바뀐 내용을 보고 「동의하고 계속하기」를 누르세요.')).toBeOnTheScreen();
  expect(rowLabels()).toEqual(['[필수] 서비스 이용약관 (바뀜)', '[선택] 탈퇴 후 영상 보관']);
  expect(cta()).toBeDisabled();

  await fireEvent.press(row('서비스 이용약관'));
  expect(row('서비스 이용약관')).toBeChecked();
  expect(cta()).toBeEnabled();

  await fireEvent.press(row('서비스 이용약관'));
  expect(row('서비스 이용약관')).not.toBeChecked();
  expect(cta()).toBeDisabled();
});

test('계속하면 문서마다 결정을 보내고, 안 고른 선택 문서는 거절로 보낸 뒤 다시 확인한다', async () => {
  recordConsent.mockResolvedValue(undefined);
  await render(<ReconsentPopup visible />);

  await fireEvent.press(row('서비스 이용약관'));
  await fireEvent.press(cta());

  expect(recordConsent.mock.calls).toEqual([
    ['d-terms', 'granted'],
    ['d-retention', 'declined'],
  ]);
  expect(mockAuth.refreshConsentEntry).toHaveBeenCalledTimes(1);
  expect(showMarketingNotice).not.toHaveBeenCalled();
  expect(row('서비스 이용약관')).toBeDisabled();
  expect(row('탈퇴 후 영상 보관')).toBeDisabled();
});

test('광고성 정보 수신에 동의하면 저장 뒤 처리 결과를 알린다', async () => {
  mockAuth.consentEntry = decisionRequired([TERMS, MAIL]);
  recordConsent.mockResolvedValue(undefined);
  await render(<ReconsentPopup visible />);

  await fireEvent.press(row('서비스 이용약관'));
  await fireEvent.press(row('광고성 정보 수신 동의 (이메일)'));
  await fireEvent.press(cta());

  expect(recordConsent.mock.calls).toEqual([
    ['d-terms', 'granted'],
    ['d-mail', 'granted'],
  ]);
  expect(showMarketingNotice).toHaveBeenCalledTimes(1);
  const [notice] = (showMarketingNotice as jest.Mock).mock.calls[0];
  expect(notice.title).toBe('광고성 정보 수신에 동의했어요');
  expect(notice.rows).toEqual([{ channel: '이메일', result: '수신 동의', granted: true }]);
});

test('광고성 문서를 비워 두면 거절로 보내고 알림은 띄우지 않는다', async () => {
  mockAuth.consentEntry = decisionRequired([TERMS, MAIL]);
  recordConsent.mockResolvedValue(undefined);
  await render(<ReconsentPopup visible />);

  await fireEvent.press(row('서비스 이용약관'));
  await fireEvent.press(cta());

  expect(recordConsent.mock.calls).toEqual([
    ['d-terms', 'granted'],
    ['d-mail', 'declined'],
  ]);
  expect(showMarketingNotice).not.toHaveBeenCalled();
});

test('일부만 저장되면 저장된 줄은 잠그고 실패한 줄의 체크만 풀어, 다시 누르면 실패한 문서만 보낸다', async () => {
  mockAuth.consentEntry = decisionRequired([TERMS, PRIVACY]);
  recordConsent.mockImplementation(async (id: string) => {
    if (id === 'd-privacy') throw new Error('network');
  });
  await render(<ReconsentPopup visible />);

  await fireEvent.press(row('서비스 이용약관'));
  await fireEvent.press(row('개인정보 수집·이용 동의'));
  await fireEvent.press(cta());

  expect(row('서비스 이용약관')).toBeDisabled();
  expect(row('서비스 이용약관')).toBeChecked();
  expect(row('개인정보 수집·이용 동의')).toBeEnabled();
  expect(row('개인정보 수집·이용 동의')).not.toBeChecked();
  expect(cta()).toBeDisabled();
  expect(screen.getByText('일부 문서를 저장하지 못했어요. 다시 체크해 주세요.')).toBeOnTheScreen();
  expect(mockAuth.refreshConsentEntry).not.toHaveBeenCalled();

  recordConsent.mockClear();
  recordConsent.mockResolvedValue(undefined);
  await fireEvent.press(row('개인정보 수집·이용 동의'));
  await fireEvent.press(cta());

  expect(recordConsent.mock.calls).toEqual([['d-privacy', 'granted']]);
  expect(mockAuth.refreshConsentEntry).toHaveBeenCalledTimes(1);
});

test('보내는 동안에는 줄과 버튼을 잠근다', async () => {
  let finish!: () => void;
  recordConsent.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  mockAuth.consentEntry = decisionRequired([TERMS]);
  await render(<ReconsentPopup visible />);

  await fireEvent.press(row('서비스 이용약관'));
  await fireEvent.press(cta());

  expect(screen.queryByText('동의하고 계속하기')).not.toBeOnTheScreen();
  expect(row('서비스 이용약관')).toBeDisabled();

  await act(async () => finish());
  expect(screen.getByText('동의하고 계속하기')).toBeOnTheScreen();
});

describe('저장 뒤 다시 확인하지 못했을 때', () => {
  test('오류를 보이고 버튼이 다시 확인하기로 바뀐다. 다시 확인이 실패하면 그 오류를 보인다', async () => {
    recordConsent.mockResolvedValue(undefined);
    mockAuth.consentEntry = decisionRequired([TERMS]);
    mockAuth.refreshConsentEntry.mockRejectedValueOnce(new Error('게이트 확인 실패'));
    const view = await render(<ReconsentPopup visible />);

    await fireEvent.press(row('서비스 이용약관'));
    await fireEvent.press(cta());

    expect(screen.getByText('게이트 확인 실패')).toBeOnTheScreen();
    const again = screen.getByRole('button', { name: '저장 결과 다시 확인하기' });
    expect(again).toBeEnabled();

    // 다시 읽는 사이 auth 가 오류 상태가 돼도 목록과 다시 확인 버튼은 남는다.
    mockAuth = { ...mockAuth, consentEntry: { status: 'error', entry: null, error: new Error('offline') } };
    await view.rerender(<ReconsentPopup visible />);
    expect(rowLabels()).toEqual(['[필수] 서비스 이용약관 (바뀜)']);

    mockAuth.refreshConsentEntry.mockRejectedValueOnce('timeout');
    await fireEvent.press(screen.getByRole('button', { name: '저장 결과 다시 확인하기' }));

    expect(screen.getByText('저장 결과를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.')).toBeOnTheScreen();
    expect(recordConsent).toHaveBeenCalledTimes(1);
  });

  test('오류가 Error 가 아니면 기본 문구를 보이고, 새 목록이 오면 처음 상태로 돌아간다', async () => {
    recordConsent.mockResolvedValue(undefined);
    mockAuth.consentEntry = decisionRequired([TERMS]);
    mockAuth.refreshConsentEntry.mockRejectedValueOnce({ code: 'x' });
    const view = await render(<ReconsentPopup visible />);

    await fireEvent.press(row('서비스 이용약관'));
    await fireEvent.press(cta());
    expect(screen.getByText('저장 결과를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.')).toBeOnTheScreen();

    mockAuth = { ...mockAuth, consentEntry: decisionRequired([PRIVACY]) };
    await view.rerender(<ReconsentPopup visible />);

    expect(rowLabels()).toEqual(['[필수] 개인정보 수집·이용 동의 (바뀜)']);
    expect(row('개인정보 수집·이용 동의')).not.toBeChecked();
    expect(screen.queryByText('저장 결과를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.')).not.toBeOnTheScreen();
    expect(cta()).toBeDisabled();
  });
});

test('선택 문서만 바뀌었으면 고르지 않고도 "선택한 대로 계속하기"로 넘어간다', async () => {
  recordConsent.mockResolvedValue(undefined);
  mockAuth.consentEntry = decisionRequired([RETENTION]);
  await render(<ReconsentPopup visible />);

  const button = screen.getByRole('button', { name: '선택한 대로 계속하기' });
  expect(button).toBeEnabled();
  await fireEvent.press(button);

  expect(recordConsent.mock.calls).toEqual([['d-retention', 'declined']]);
});

test('목록을 확인하는 중에는 줄 없이 기다린다', async () => {
  mockAuth.consentEntry = { status: 'checking', entry: null, error: null };
  await render(<ReconsentPopup visible />);

  expect(screen.getByText('동의 문서가 바뀌었어요')).toBeOnTheScreen();
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  expect(screen.queryByRole('button')).not.toBeOnTheScreen();
});

describe('목록을 못 불러왔을 때', () => {
  test('오류 상자와 다시 시도를 보이고, 누르면 다시 읽는다', async () => {
    mockAuth.consentEntry = { status: 'error', entry: null, error: new Error('서버 점검 중') };
    mockAuth.refreshConsentEntry.mockRejectedValueOnce(new Error('again'));
    await render(<ReconsentPopup visible />);

    expect(screen.getByText('동의 문서를 불러오지 못했어요')).toBeOnTheScreen();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);

    await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));

    expect(mockAuth.refreshConsentEntry).toHaveBeenCalledTimes(1);
    expect(screen.getByText('동의 문서를 불러오지 못했어요')).toBeOnTheScreen();
  });

  test('다시 불러와도 풀리지 않을 때를 위해 로그아웃으로 나갈 수 있다(SOMA-925)', async () => {
    const signOut = jest.fn().mockResolvedValue(undefined);
    mockAuth = { ...mockAuth, consentEntry: { status: 'error', entry: null, error: new Error('세션이 만료됐어요') }, signOut };
    await render(<ReconsentPopup visible />);

    await fireEvent.press(screen.getByRole('button', { name: '로그아웃' }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

test('문서 보기는 시트로 본문을 열고, 닫기나 뒤로 가기는 시트만 닫는다', async () => {
  await render(<ReconsentPopup visible />);

  await fireEvent.press(within(row('서비스 이용약관')).getByRole('button', { name: '보기' }));
  expect(screen.getByText('제1조 목적')).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '닫기' }));
  expect(screen.queryByText('제1조 목적')).not.toBeOnTheScreen();
  expect(screen.getByText('동의 문서가 바뀌었어요')).toBeOnTheScreen();

  await fireEvent.press(within(row('탈퇴 후 영상 보관')).getByRole('button', { name: '보기' }));
  expect(screen.getByText('제1조 목적')).toBeOnTheScreen();
  await fireEvent(modalOf(screen.getByText('동의 문서가 바뀌었어요')), 'requestClose');
  expect(screen.queryByText('제1조 목적')).not.toBeOnTheScreen();
  expect(rowLabels()).toEqual(['[필수] 서비스 이용약관 (바뀜)', '[선택] 탈퇴 후 영상 보관']);
});

test('문서 시트 바깥의 어두운 곳을 눌러도 시트만 닫힌다', async () => {
  await render(<ReconsentPopup visible />);
  await fireEvent.press(within(row('서비스 이용약관')).getByRole('button', { name: '보기' }));

  // 시트 층의 첫 자식이 바깥 덮개다(시트 제목 → 시트 → 시트 층).
  const sheetLayer = screen.getAllByText('서비스 이용약관')[0].parent!.parent!;
  await fireEvent.press(sheetLayer.children[0] as typeof sheetLayer);

  expect(screen.queryByText('제1조 목적')).not.toBeOnTheScreen();
  expect(screen.getByText('동의 문서가 바뀌었어요')).toBeOnTheScreen();
});
