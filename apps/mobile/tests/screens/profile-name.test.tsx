import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ProfileEditScreen from '@/app/profile-edit';
import ProfileEditItemScreen from '@/app/profile-edit-item';
import ProfileNameScreen from '@/app/profile-name';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-request';
import { useAuth } from '@/lib/auth';
import { logMetaEvent } from '@/lib/meta-events';
import { takeProviderNameHint } from '@/lib/profile';
import type { ServerProfile } from '@/lib/profile-form';
import { pickAndUploadProfilePhoto, removeProfilePhoto } from '@/lib/profile-photo-upload';
import { readAttributedChannel, recordSignupCompleted } from '@/lib/signup-attribution-runtime';

const mockRouter = { back: jest.fn(), push: jest.fn() };
let mockParams: Record<string, string> = {};
// 머리 오른쪽 버튼(프로필 항목의 「완료」)은 화면 설정으로 넘어오므로 그대로 그려 누를 수 있게 한다.
jest.mock('expo-router', () => ({
  Stack: { Screen: ({ options }: { options?: { headerRight?: () => unknown } }) => (options?.headerRight ? options.headerRight() : null) },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/hooks/use-keyboard-height', () => ({ useKeyboardHeight: () => 0 }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/api', () => ({ api: { recordDiscoveryAnswer: jest.fn() } }));
jest.mock('@/lib/meta-events', () => ({ logMetaEvent: jest.fn() }));
jest.mock('@/lib/signup-attribution-runtime', () => ({ readAttributedChannel: jest.fn(), recordSignupCompleted: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/profile', () => ({ takeProviderNameHint: jest.fn() }));
jest.mock('@/lib/profile-photo-upload', () => ({ pickAndUploadProfilePhoto: jest.fn(), removeProfilePhoto: jest.fn() }));

const saveProfile = jest.fn();
const reloadProfile = jest.fn();
const setMe = jest.fn();
const closeAccountUnder14 = jest.fn();
const signOut = jest.fn();
const recordDiscovery = api.recordDiscoveryAnswer as jest.Mock;

const fullProfile: ServerProfile = {
  name: '김민지',
  gender: 'female',
  birth_date: '2004-03-14',
  directions: ['stage'],
  experience: 'y1_to_3',
  goal: 'audition',
  photo_url: 'https://cdn/me.jpg',
  bio: '무대를 사랑하는 배우',
};

function auth(me: unknown, status = 'ready') {
  (useAuth as jest.Mock).mockReturnValue({
    profile: { me, status },
    reloadProfile,
    saveProfile,
    setMe,
    closeAccountUnder14,
    signOut,
  });
}

const button = (name: string) => screen.getByRole('button', { name });
const radio = (name: string) => screen.getByRole('radio', { name });
const checkbox = (name: string) => screen.getByRole('checkbox', { name });
const next = () => button('다음');
const done = () => button('완료');

const THIS_YEAR = new Date().getFullYear();
const WHEEL_ITEM = 44;
/** 생년월일 돌림판을 돌려 세운다 — 연·월·일 줄마다 멈춘 자리(contentOffset)를 알린다. 연도 줄은 올해-100년부터다. */
async function setBirth(year: number, month: number, day: number) {
  const settle = async (id: string, index: number) =>
    fireEvent(screen.getByTestId(id), 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 0, y: index * WHEEL_ITEM } } });
  await settle('birth-year', year - (THIS_YEAR - 100));
  await settle('birth-month', month - 1);
  await settle('birth-day', day - 1);
}

beforeEach(() => {
  jest.clearAllMocks();
  auth({ id: 'u1', profile: null });
  saveProfile.mockResolvedValue(undefined);
  recordDiscovery.mockResolvedValue(undefined);
  (readAttributedChannel as jest.Mock).mockResolvedValue(null);
  (takeProviderNameHint as jest.Mock).mockReturnValue('민지');
});

/** 시작 화면에서 「시작하기」를 눌러 닉네임 질문으로 간다. 제공자 이름이 채워질 때까지 기다린다. */
async function start() {
  await render(<ProfileNameScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: '시작하기' }));
  expect(await screen.findByDisplayValue('민지')).toBeOnTheScreen();
}

/** 닉네임부터 추구하는 방향까지 답한다 — 줄을 고르고 「다음」을 누른다. 방향은 두 개 고르고 마지막 「다음」은 누르지 않는다. */
async function answerToDirections() {
  await fireEvent.press(next()); // 닉네임
  await setBirth(2004, 3, 14);
  await fireEvent.press(next()); // 생년월일
  await fireEvent.press(radio('여성'));
  await fireEvent.press(next());
  await fireEvent.press(radio('전문 배우'));
  await fireEvent.press(next());
  await fireEvent.press(radio('입시생'));
  await fireEvent.press(next());
  await fireEvent.press(checkbox('무대 (연극·뮤지컬)'));
  await fireEvent.press(checkbox('매체 (TV·영화)'));
}

/** 유입 경로를 묻지 않는 설치(광고 링크) — 마지막 질문이 추구하는 방향이다. */
async function startWithoutDiscovery() {
  (readAttributedChannel as jest.Mock).mockResolvedValue('facebook');
  await start();
  await waitFor(() => expect(screen.getByText('1/6')).toBeOnTheScreen());
}

const PAYLOAD = {
  name: '민지',
  gender: 'female',
  birth_date: '2004-03-14',
  directions: ['media', 'stage'],
  experience: 'exam_prep',
  goal: 'professional',
};

describe('가입 게이트 — 한 화면에 질문 하나, 고르고 「다음」을 눌러야 넘어간다', () => {
  test('질문마다 액티 말풍선이 바뀌고, 고르는 줄은 기본 선택 없이 누르면 선택되며 「다음」 전에는 넘어가지 않는다', async () => {
    await render(<ProfileNameScreen />);
    expect(await screen.findByText('반가워요, 배우님!')).toBeOnTheScreen();
    await fireEvent.press(button('시작하기'));

    // 닉네임 — 로그인 제공자가 준 이름으로 시작한다. 글자를 다 적었는지는 알 수 없으니 「다음」만 둔다.
    expect(await screen.findByDisplayValue('민지')).toBeOnTheScreen();
    expect(screen.getByText('뭐라고 불러 드릴까요?')).toBeOnTheScreen();
    expect(screen.getByText('1/7')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByDisplayValue('민지'), '  ');
    expect(next()).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('닉네임'), '민지');
    await fireEvent.press(next());

    // 생년월일 — 연·월·일 돌림판. 돌려도 「다음」을 눌러야 넘어간다.
    expect(screen.getByText('민지님, 생년월일을 알려 주세요')).toBeOnTheScreen();
    expect(screen.getByText('2/7')).toBeOnTheScreen();
    await setBirth(2004, 3, 14);
    expect(screen.getByText('민지님, 생년월일을 알려 주세요')).toBeOnTheScreen();
    await fireEvent.press(next());

    // 성별 — 처음엔 아무것도 고르지 않고 「다음」이 꺼져 있다. 누르면 선택, 「다음」으로 넘어간다.
    expect(screen.getByText('민지님, 성별을 알려 주실래요?')).toBeOnTheScreen();
    expect(screen.queryByText('하나 누르면 바로 넘어가요.')).not.toBeOnTheScreen();
    expect(radio('남성')).not.toBeSelected();
    expect(radio('여성')).not.toBeSelected();
    expect(next()).toBeDisabled();
    await fireEvent.press(radio('여성'));
    expect(radio('여성')).toBeSelected();
    expect(screen.getByText('민지님, 성별을 알려 주실래요?')).toBeOnTheScreen();
    await fireEvent.press(radio('남성'));
    expect(radio('남성')).toBeSelected();
    expect(radio('여성')).not.toBeSelected();
    await fireEvent.press(next());

    expect(screen.getByText('민지님, 연기는 어떤 이유로 하고 있어요?')).toBeOnTheScreen();
    expect(screen.getByText('4/7')).toBeOnTheScreen();
    expect(next()).toBeDisabled();
    await fireEvent.press(radio('전문 배우'));
    await fireEvent.press(next());

    expect(screen.getByText('민지님, 연기한 지 얼마나 됐어요?')).toBeOnTheScreen();
    for (const label of ['입문 전', '입시생', '1년 미만', '1–3년', '3–5년', '5년 이상']) expect(radio(label)).toBeOnTheScreen();
    await fireEvent.press(radio('입시생'));
    await fireEvent.press(next());

    // 추구하는 방향 — 여러 개 고를 수 있다
    expect(screen.getByText('민지님, 어떤 연기를 하고 싶어요?')).toBeOnTheScreen();
    expect(next()).toBeDisabled();
    await fireEvent.press(checkbox('무대 (연극·뮤지컬)'));
    expect(next()).toBeEnabled();
    expect(saveProfile).not.toHaveBeenCalled();
  });

  test('뒤로는 앞 질문으로 가고 고른 값은 남는다', async () => {
    await start();
    await fireEvent.press(next());
    await setBirth(2004, 3, 14);
    await fireEvent.press(next());
    await fireEvent.press(radio('여성'));

    await fireEvent.press(button('뒤로'));
    expect(screen.getByText('민지님, 생년월일을 알려 주세요')).toBeOnTheScreen();
    await fireEvent.press(next());
    expect(radio('여성')).toBeSelected();
    await fireEvent.press(button('뒤로'));
    await fireEvent.press(button('뒤로'));
    expect(screen.getByDisplayValue('민지')).toBeOnTheScreen();
    await fireEvent.press(button('뒤로'));
    expect(screen.getByText('반가워요, 배우님!')).toBeOnTheScreen();
  });

  test('저장하면 가입을 마친 기록과 유입 경로 답을 보낸다', async () => {
    await start();
    await answerToDirections();
    await fireEvent.press(next());

    expect(await screen.findByText('민지님, Acttub는 어디서 알게 됐어요?')).toBeOnTheScreen();
    expect(screen.getByText('7/7')).toBeOnTheScreen();
    await fireEvent.press(radio('기타'));
    expect(saveProfile).not.toHaveBeenCalled();
    expect(done()).toBeDisabled();
    await fireEvent.changeText(screen.getByPlaceholderText('어디서 알게 됐는지 적어주세요 (30자까지)'), '연기 학원 선생님');
    await fireEvent.press(done());

    expect(saveProfile).toHaveBeenCalledWith(PAYLOAD);
    expect(logEvent).toHaveBeenCalledWith('profile_setup', { mediums: 'stage,media', career: 'exam_prep', goal: 'professional' });
    expect(logMetaEvent).toHaveBeenCalledWith('fb_mobile_complete_registration');
    expect(recordSignupCompleted).toHaveBeenCalledWith('u1');
    expect(recordDiscovery).toHaveBeenCalledWith({ source: 'other', detail: null, other_text: '연기 학원 선생님' });
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  test('유입 경로는 하나 고르고 「완료」를 눌러야 저장한다(하나 누르면 바로 저장하지 않는다)', async () => {
    await start();
    await answerToDirections();
    await fireEvent.press(next());

    await fireEvent.press(radio('인스타그램'));
    expect(radio('인스타그램')).toBeSelected();
    expect(saveProfile).not.toHaveBeenCalled();
    await fireEvent.press(done());

    expect(saveProfile).toHaveBeenCalledWith(PAYLOAD);
    expect(recordDiscovery).toHaveBeenCalledWith({ source: 'instagram', detail: null, other_text: null });
  });

  test('유입 경로를 건너뛰면 건너뜀으로 보낸다', async () => {
    recordDiscovery.mockRejectedValue(new Error('down'));
    await start();
    await answerToDirections();
    await fireEvent.press(next());

    await fireEvent.press(button('건너뛰기'));

    expect(saveProfile).toHaveBeenCalledWith(PAYLOAD);
    expect(recordDiscovery).toHaveBeenCalledWith({ source: null, detail: null, other_text: null });
  });

  test('광고 링크로 들어온 설치면 유입 경로를 묻지 않고 방향에서 「완료」로 저장한다', async () => {
    await startWithoutDiscovery();
    await answerToDirections();
    await fireEvent.press(done());

    expect(screen.queryByText('민지님, Acttub는 어디서 알게 됐어요?')).not.toBeOnTheScreen();
    expect(saveProfile).toHaveBeenCalledTimes(1);
    expect(recordDiscovery).not.toHaveBeenCalled();
  });

  test('귀속을 못 읽으면 묻는 쪽으로 둔다', async () => {
    (readAttributedChannel as jest.Mock).mockRejectedValue(new Error('no sdk'));
    await start();
    await answerToDirections();
    await fireEvent.press(next());
    expect(await screen.findByText('민지님, Acttub는 어디서 알게 됐어요?')).toBeOnTheScreen();
  });

  test('계정 id가 없으면 가입 기록을 남기지 않는다', async () => {
    auth({ profile: null });
    await startWithoutDiscovery();
    await answerToDirections();
    await fireEvent.press(done());

    expect(saveProfile).toHaveBeenCalledTimes(1);
    expect(recordSignupCompleted).not.toHaveBeenCalled();
  });

  test('생년월일 돌림판은 처음 값이 이미 정해져 있고, 달이 바뀌면 일 수가 맞춰진다', async () => {
    await start();
    await fireEvent.press(next());

    expect(screen.getByLabelText('연도')).toHaveProp('accessibilityValue', { text: `${THIS_YEAR - 20}년` });
    expect(next()).toBeEnabled();
    await setBirth(2004, 1, 31);
    await setBirth(2004, 2, 31); // 2월에는 31일이 없다 → 29일(2004는 윤년)로 맞춰진다
    expect(screen.getByLabelText('일')).toHaveProp('accessibilityValue', { text: '29일' });
  });

  test('아직 안 온 날짜는 이유를 보이고 「다음」을 막는다', async () => {
    await start();
    await fireEvent.press(next());
    await setBirth(THIS_YEAR, 12, 31);
    // 12월 31일이 이미 지났다면 이 시험은 해당 없음 — 그때는 아직 안 온 날짜가 없다.
    if (new Date() < new Date(THIS_YEAR, 11, 31)) {
      expect(screen.getByText('생년월일을 다시 확인해주세요.')).toBeOnTheScreen();
      expect(next()).toBeDisabled();
      expect(screen.getByText('민지님, 생년월일을 알려 주세요')).toBeOnTheScreen();
    }
  });

  test('만 14세 미만 생년월일은 「가입할 수 없어요」로 보내고, 확인하면 로그아웃한다', async () => {
    await start();
    await fireEvent.press(next());
    await setBirth(THIS_YEAR - 5, 1, 1);
    await fireEvent.press(next());

    expect(screen.getByText('지금은 가입할 수 없어요')).toBeOnTheScreen();
    await fireEvent.press(button('뒤로'));
    expect(screen.getByText('민지님, 생년월일을 알려 주세요')).toBeOnTheScreen();
    await setBirth(THIS_YEAR - 5, 1, 1);
    await fireEvent.press(next());
    await fireEvent.press(button('확인'));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(saveProfile).not.toHaveBeenCalled();
  });

  test('이름이 20자를 넘으면 알리고 막는다', async () => {
    await start();
    await fireEvent.changeText(screen.getByDisplayValue('민지'), '가'.repeat(21));

    expect(screen.getByText('이름은 20자까지 쓸 수 있어요.')).toBeOnTheScreen();
    expect(next()).toBeDisabled();
  });

  test('추구하는 방향은 다시 누르면 뺀다', async () => {
    await start();
    await answerToDirections();
    await fireEvent.press(checkbox('무대 (연극·뮤지컬)'));
    await fireEvent.press(checkbox('매체 (TV·영화)'));

    expect(checkbox('매체 (TV·영화)')).not.toBeChecked();
    expect(next()).toBeDisabled();
  });

  test('만 14세 미만으로 계정이 닫히면 닫힘 처리로 넘긴다', async () => {
    saveProfile.mockRejectedValue(new ApiError(422, 'closed', 'validation_failed', 'under_14_account_closed'));
    await startWithoutDiscovery();
    await answerToDirections();
    await fireEvent.press(done());

    expect(closeAccountUnder14).toHaveBeenCalledTimes(1);
    expect(logEvent).not.toHaveBeenCalled();
  });

  test('서버가 만 14세 미만이라고 하면 「가입할 수 없어요」로 보낸다', async () => {
    saveProfile.mockRejectedValue(new ApiError(422, 'young', 'validation_failed', 'under_14'));
    await startWithoutDiscovery();
    await answerToDirections();
    await fireEvent.press(done());

    expect(await screen.findByText('지금은 가입할 수 없어요')).toBeOnTheScreen();
  });

  test.each([
    [new ApiError(422, 'bad', 'validation_failed', [{ field: 'name' }]), '입력값을 저장하지 못했어요. 앱을 최신 버전으로 업데이트한 뒤 다시 시도해주세요.'],
    [new Error('서버 점검 중'), '서버 점검 중'],
    ['boom', '프로필을 저장하지 못했어요. 잠시 후 다시 시도해주세요.'],
  ])('저장 실패 %#: 이유를 보여 준다', async (cause, message) => {
    saveProfile.mockRejectedValue(cause);
    await startWithoutDiscovery();
    await answerToDirections();
    await fireEvent.press(done());

    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(done()).toBeEnabled();
  });

  test('저장하는 동안 버튼을 막는다', async () => {
    let finish!: () => void;
    saveProfile.mockReturnValue(new Promise<void>((r) => (finish = r)));
    await startWithoutDiscovery();
    await answerToDirections();

    await fireEvent.press(done());
    expect(done()).toBeDisabled();
    await act(async () => finish());
    expect(done()).toBeEnabled();
  });
});

describe('내 계정을 아직 못 읽었으면', () => {
  test('읽는 중에는 폼을 그리지 않는다', async () => {
    auth(null, 'loading');
    await render(<ProfileNameScreen />);
    expect(screen.queryByText('반가워요, 배우님!')).not.toBeOnTheScreen();
    expect(screen.queryByText('프로필을 불러오지 못했어요.')).not.toBeOnTheScreen();
  });

  test('실패했으면 다시 불러오기를 둔다', async () => {
    auth(null, 'error');
    await render(<ProfileNameScreen />);
    await fireEvent.press(button('다시 불러오기'));
    expect(reloadProfile).toHaveBeenCalledTimes(1);
    expect(screen.getByText('프로필을 불러오지 못했어요.')).toBeOnTheScreen();
  });
});

describe('설정의 프로필 편집', () => {
  beforeEach(() => {
    auth({ id: 'u1', profile: fullProfile });
    mockParams = {};
  });

  test('항목 줄에 지금 값을 보이고, 누르면 그 항목만 고치는 화면으로 간다', async () => {
    await render(<ProfileEditScreen />);

    expect(takeProviderNameHint).not.toHaveBeenCalled();
    expect(readAttributedChannel).not.toHaveBeenCalled();
    expect(screen.queryByText('Acttub를 처음 어디서 알게 됐어요?')).not.toBeOnTheScreen();
    expect(screen.getByText('김민지')).toBeOnTheScreen();
    expect(screen.getByText('무대를 사랑하는 배우')).toBeOnTheScreen();
    expect(screen.getByText('무대 (연극·뮤지컬)')).toBeOnTheScreen();

    await fireEvent.press(button('소개 무대를 사랑하는 배우'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/profile-edit-item', params: { field: 'bio' } });
  });

  test('소개를 비우고 완료하면 나머지 값과 함께 저장한 뒤 돌아간다', async () => {
    mockParams = { field: 'bio' };
    await render(<ProfileEditItemScreen />);

    expect(screen.getByText('11 / 80자')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByDisplayValue('무대를 사랑하는 배우'), '  ');
    await fireEvent.press(button('완료'));

    expect(saveProfile).toHaveBeenCalledWith({
      name: '김민지',
      gender: 'female',
      birth_date: '2004-03-14',
      directions: ['stage'],
      experience: 'y1_to_3',
      goal: 'audition',
      bio: null,
    });
    expect(logEvent).toHaveBeenCalledWith('profile_edit', { mediums: 'stage', career: 'y1_to_3', goal: 'audition' });
    expect(logMetaEvent).not.toHaveBeenCalled();
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  test('소개가 80자를 넘으면 알리고 막는다', async () => {
    mockParams = { field: 'bio' };
    await render(<ProfileEditItemScreen />);
    await fireEvent.changeText(screen.getByDisplayValue('무대를 사랑하는 배우'), '가'.repeat(81));

    expect(screen.getByText('한 줄 소개는 80자까지 쓸 수 있어요.')).toBeOnTheScreen();
    expect(button('완료')).toBeDisabled();
  });

  test('사진을 바꾸면 새 계정 정보로 갈아 끼우고, 고르지 않으면 그대로 둔다', async () => {
    const nextMe = { id: 'u1', profile: { ...fullProfile, photo_url: 'https://cdn/new.jpg' } };
    (pickAndUploadProfilePhoto as jest.Mock).mockResolvedValueOnce(nextMe).mockResolvedValueOnce(null);
    await render(<ProfileEditScreen />);

    await fireEvent.press(screen.getAllByRole('button', { name: '사진 수정' })[0]);
    expect(setMe).toHaveBeenCalledWith(nextMe);
    await fireEvent.press(screen.getAllByRole('button', { name: '사진 수정' })[0]);
    expect(setMe).toHaveBeenCalledTimes(1);
  });

  test('사진을 지우면 새 계정 정보로 갈아 끼운다', async () => {
    const nextMe = { id: 'u1', profile: { ...fullProfile, photo_url: null } };
    (removeProfilePhoto as jest.Mock).mockResolvedValue(nextMe);
    await render(<ProfileEditScreen />);

    await fireEvent.press(button('사진 지우기'));
    expect(setMe).toHaveBeenCalledWith(nextMe);
  });

  test.each([
    ['올리기', '사진 수정', pickAndUploadProfilePhoto as jest.Mock],
    ['지우기', '사진 지우기', removeProfilePhoto as jest.Mock],
  ])('사진 %s가 실패하면 이유를 보인다', async (_name, name, fn) => {
    fn.mockRejectedValueOnce(new Error('사진 파일을 읽지 못했어요.')).mockRejectedValueOnce('boom');
    await render(<ProfileEditScreen />);

    await fireEvent.press(screen.getAllByRole('button', { name })[0]);
    expect(await screen.findByText('사진 파일을 읽지 못했어요.')).toBeOnTheScreen();
    await fireEvent.press(screen.getAllByRole('button', { name })[0]);
    expect(await screen.findByText('사진을 올리지 못했어요. 잠시 후 다시 시도해주세요.')).toBeOnTheScreen();
    expect(setMe).not.toHaveBeenCalled();
  });

  test('올리는 동안 사진 버튼을 막는다', async () => {
    let finish!: (v: null) => void;
    (pickAndUploadProfilePhoto as jest.Mock).mockReturnValue(new Promise((r) => (finish = r)));
    await render(<ProfileEditScreen />);

    await fireEvent.press(screen.getAllByRole('button', { name: '사진 수정' })[0]);
    for (const photo of screen.getAllByRole('button', { name: '사진 수정' })) expect(photo).toBeDisabled();
    expect(button('사진 지우기')).toBeDisabled();
    await act(async () => finish(null));
    for (const photo of screen.getAllByRole('button', { name: '사진 수정' })) expect(photo).toBeEnabled();
  });

  test('사진이 없으면 이름 첫 글자를 보이고 지우기는 두지 않는다', async () => {
    auth({ id: 'u1', profile: { ...fullProfile, photo_url: null, bio: null } });
    await render(<ProfileEditScreen />);

    expect(screen.getByText('김')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: '사진 지우기' })).not.toBeOnTheScreen();
  });

  test('이름을 비우면 완료를 막는다', async () => {
    mockParams = { field: 'name' };
    await render(<ProfileEditItemScreen />);

    expect(screen.getByDisplayValue('김민지')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByDisplayValue('김민지'), '');
    expect(button('완료')).toBeDisabled();
  });
});
