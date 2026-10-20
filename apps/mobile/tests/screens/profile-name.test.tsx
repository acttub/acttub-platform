import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ProfileEditScreen from '@/app/profile-edit';
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

const mockRouter = { back: jest.fn() };
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter }));
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
  });
}

const chip = (name: string) => screen.getByRole('button', { name });
const cta = (label: '시작하기' | '저장') => screen.getByText(label);

beforeEach(() => {
  jest.clearAllMocks();
  auth({ id: 'u1', profile: null });
  saveProfile.mockResolvedValue(undefined);
  recordDiscovery.mockResolvedValue(undefined);
  (readAttributedChannel as jest.Mock).mockResolvedValue(null);
  (takeProviderNameHint as jest.Mock).mockReturnValue('민지');
});

async function fillSignupForm() {
  await fireEvent.press(chip('여성'));
  await fireEvent.changeText(screen.getByPlaceholderText('예: 2004-03-14 (숫자만 입력)'), '20040314');
  await fireEvent.press(chip('무대 (연극·뮤지컬)'));
  await fireEvent.press(chip('매체 (TV·영화)'));
  await fireEvent.press(chip('입시생'));
  await fireEvent.press(chip('전문 배우'));
}

describe('가입 게이트', () => {
  test('로그인 제공자가 준 이름으로 시작하고, 여섯 항목을 채워야 시작할 수 있다', async () => {
    await render(<ProfileNameScreen />);

    expect(await screen.findByDisplayValue('민지')).toBeOnTheScreen();
    expect(screen.queryByText('프로필 사진')).not.toBeOnTheScreen();
    expect(screen.queryByText('한 줄 소개')).not.toBeOnTheScreen();
    expect(cta('시작하기')).toBeDisabled();

    await fillSignupForm();

    expect(screen.getByDisplayValue('2004-03-14')).toBeOnTheScreen();
    expect(chip('여성')).toBeSelected();
    expect(cta('시작하기')).toBeEnabled();
  });

  test('저장하면 가입을 마친 기록과 유입 경로 답을 보낸다', async () => {
    await render(<ProfileNameScreen />);
    await screen.findByDisplayValue('민지');
    await fillSignupForm();
    await fireEvent.press(chip('기타'));
    await fireEvent.changeText(screen.getByPlaceholderText('어디서 알게 됐는지 적어주세요 (30자까지)'), '연기 학원 선생님');

    await fireEvent.press(cta('시작하기'));

    expect(saveProfile).toHaveBeenCalledWith({
      name: '민지',
      gender: 'female',
      birth_date: '2004-03-14',
      directions: ['media', 'stage'],
      experience: 'exam_prep',
      goal: 'professional',
    });
    expect(logEvent).toHaveBeenCalledWith('profile_setup', { mediums: 'stage,media', career: 'exam_prep', goal: 'professional' });
    expect(logMetaEvent).toHaveBeenCalledWith('fb_mobile_complete_registration');
    expect(recordSignupCompleted).toHaveBeenCalledWith('u1');
    expect(recordDiscovery).toHaveBeenCalledWith({ source: 'other', detail: null, other_text: '연기 학원 선생님' });
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  test('유입 경로를 고르지 않으면 건너뜀으로 보내고, 같은 것을 다시 누르면 고른 것을 푼다', async () => {
    recordDiscovery.mockRejectedValue(new Error('down'));
    await render(<ProfileNameScreen />);
    await screen.findByDisplayValue('민지');
    await fillSignupForm();

    await fireEvent.press(chip('인스타그램'));
    expect(chip('인스타그램')).toBeSelected();
    await fireEvent.press(chip('인스타그램'));
    expect(chip('인스타그램')).not.toBeSelected();
    await fireEvent.press(cta('시작하기'));

    expect(recordDiscovery).toHaveBeenCalledWith({ source: null, detail: null, other_text: null });
  });

  test('광고 링크로 들어온 설치면 유입 경로를 묻지 않는다', async () => {
    (readAttributedChannel as jest.Mock).mockResolvedValue('facebook');
    await render(<ProfileNameScreen />);

    await waitFor(() => expect(screen.queryByText('액터브를 처음 어디서 알게 됐어요?')).not.toBeOnTheScreen());
    await fillSignupForm();
    await fireEvent.press(cta('시작하기'));

    expect(saveProfile).toHaveBeenCalledTimes(1);
    expect(recordDiscovery).not.toHaveBeenCalled();
  });

  test('귀속을 못 읽으면 묻는 쪽으로 둔다', async () => {
    (readAttributedChannel as jest.Mock).mockRejectedValue(new Error('no sdk'));
    await render(<ProfileNameScreen />);
    expect(await screen.findByText('액터브를 처음 어디서 알게 됐어요?')).toBeOnTheScreen();
  });

  test('계정 id가 없으면 가입 기록을 남기지 않는다', async () => {
    auth({ profile: null });
    await render(<ProfileNameScreen />);
    await screen.findByDisplayValue('민지');
    await fillSignupForm();
    await fireEvent.press(cta('시작하기'));

    expect(saveProfile).toHaveBeenCalledTimes(1);
    expect(recordSignupCompleted).not.toHaveBeenCalled();
  });

  test.each([
    ['2030-01-01', '생년월일을 다시 확인해주세요.'],
    ['2020-01-01', '만 14세 이상만 가입 가능해요.'],
  ])('생년월일 %s는 이유를 보이고 막는다', async (birth, message) => {
    await render(<ProfileNameScreen />);
    await screen.findByDisplayValue('민지');
    await fillSignupForm();
    await fireEvent.changeText(screen.getByDisplayValue('2004-03-14'), birth.replace(/-/g, ''));

    expect(screen.getByText(message)).toBeOnTheScreen();
    expect(cta('시작하기')).toBeDisabled();
  });

  test('이름이 20자를 넘으면 알리고 막는다', async () => {
    await render(<ProfileNameScreen />);
    await fillSignupForm();
    expect(screen.getByText('다른 사람에게 보이는 이름이에요')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByDisplayValue('민지'), '가'.repeat(21));

    expect(screen.getByText('이름은 20자까지 쓸 수 있어요.')).toBeOnTheScreen();
    expect(cta('시작하기')).toBeDisabled();
  });

  test('추구하는 방향은 다시 누르면 뺀다', async () => {
    await render(<ProfileNameScreen />);
    await fillSignupForm();
    await fireEvent.press(chip('무대 (연극·뮤지컬)'));
    await fireEvent.press(chip('매체 (TV·영화)'));

    expect(chip('매체 (TV·영화)')).not.toBeSelected();
    expect(cta('시작하기')).toBeDisabled();
  });

  test('만 14세 미만으로 계정이 닫히면 닫힘 처리로 넘긴다', async () => {
    saveProfile.mockRejectedValue(new ApiError(422, 'closed', 'validation_failed', 'under_14_account_closed'));
    await render(<ProfileNameScreen />);
    await fillSignupForm();
    await fireEvent.press(cta('시작하기'));

    expect(closeAccountUnder14).toHaveBeenCalledTimes(1);
    expect(logEvent).not.toHaveBeenCalled();
  });

  test.each([
    [new ApiError(422, 'young', 'validation_failed', 'under_14'), '만 14세 이상만 가입 가능해요.'],
    [new ApiError(422, 'bad', 'validation_failed', [{ field: 'name' }]), '입력값을 저장하지 못했어요. 앱을 최신 버전으로 업데이트한 뒤 다시 시도해주세요.'],
    [new Error('서버 점검 중'), '서버 점검 중'],
    ['boom', '프로필을 저장하지 못했어요. 잠시 후 다시 시도해주세요.'],
  ])('저장 실패 %#: 이유를 보여 준다', async (cause, message) => {
    saveProfile.mockRejectedValue(cause);
    await render(<ProfileNameScreen />);
    await fillSignupForm();
    await fireEvent.press(cta('시작하기'));

    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(cta('시작하기')).toBeEnabled();
  });

  test('저장하는 동안 버튼을 막는다', async () => {
    let finish!: () => void;
    saveProfile.mockReturnValue(new Promise<void>((r) => (finish = r)));
    await render(<ProfileNameScreen />);
    await fillSignupForm();

    await fireEvent.press(cta('시작하기'));
    expect(screen.queryByText('시작하기')).not.toBeOnTheScreen();
    await act(async () => finish());
    expect(cta('시작하기')).toBeEnabled();
  });
});

describe('내 계정을 아직 못 읽었으면', () => {
  test('읽는 중에는 폼을 그리지 않는다', async () => {
    auth(null, 'loading');
    await render(<ProfileNameScreen />);
    expect(screen.queryByText('프로필을 알려주세요')).not.toBeOnTheScreen();
    expect(screen.queryByText('프로필을 불러오지 못했어요.')).not.toBeOnTheScreen();
  });

  test('실패했으면 다시 불러오기를 둔다', async () => {
    auth(null, 'error');
    await render(<ProfileNameScreen />);
    await fireEvent.press(screen.getByRole('button', { name: '다시 불러오기' }));
    expect(reloadProfile).toHaveBeenCalledTimes(1);
    expect(screen.getByText('프로필을 불러오지 못했어요.')).toBeOnTheScreen();
  });
});

describe('설정의 프로필 편집', () => {
  beforeEach(() => {
    auth({ id: 'u1', profile: fullProfile });
  });

  test('저장된 값으로 채우고, 소개와 함께 저장한 뒤 돌아간다', async () => {
    await render(<ProfileEditScreen />);

    expect(await screen.findByDisplayValue('김민지')).toBeOnTheScreen();
    expect(takeProviderNameHint).not.toHaveBeenCalled();
    expect(readAttributedChannel).not.toHaveBeenCalled();
    expect(screen.queryByText('액터브를 처음 어디서 알게 됐어요?')).not.toBeOnTheScreen();
    expect(chip('무대 (연극·뮤지컬)')).toBeSelected();
    expect(screen.getByText('11 / 80자')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByDisplayValue('무대를 사랑하는 배우'), '  ');
    await fireEvent.press(cta('저장'));

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
    await render(<ProfileEditScreen />);
    await fireEvent.changeText(await screen.findByDisplayValue('무대를 사랑하는 배우'), '가'.repeat(81));

    expect(screen.getByText('한 줄 소개는 80자까지 쓸 수 있어요.')).toBeOnTheScreen();
    expect(cta('저장')).toBeDisabled();
  });

  test('사진을 바꾸면 새 계정 정보로 갈아 끼우고, 고르지 않으면 그대로 둔다', async () => {
    const next = { id: 'u1', profile: { ...fullProfile, photo_url: 'https://cdn/new.jpg' } };
    (pickAndUploadProfilePhoto as jest.Mock).mockResolvedValueOnce(next).mockResolvedValueOnce(null);
    await render(<ProfileEditScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: '사진 변경' }));
    expect(setMe).toHaveBeenCalledWith(next);
    await fireEvent.press(screen.getByRole('button', { name: '사진 변경' }));
    expect(setMe).toHaveBeenCalledTimes(1);
  });

  test('사진을 지우면 새 계정 정보로 갈아 끼운다', async () => {
    const next = { id: 'u1', profile: { ...fullProfile, photo_url: null } };
    (removeProfilePhoto as jest.Mock).mockResolvedValue(next);
    await render(<ProfileEditScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: '사진 지우기' }));
    expect(setMe).toHaveBeenCalledWith(next);
  });

  test.each([
    ['올리기', '사진 변경', pickAndUploadProfilePhoto as jest.Mock],
    ['지우기', '사진 지우기', removeProfilePhoto as jest.Mock],
  ])('사진 %s가 실패하면 이유를 보인다', async (_name, button, fn) => {
    fn.mockRejectedValueOnce(new Error('사진 파일을 읽지 못했어요.')).mockRejectedValueOnce('boom');
    await render(<ProfileEditScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: button }));
    expect(await screen.findByText('사진 파일을 읽지 못했어요.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: button }));
    expect(await screen.findByText('사진을 올리지 못했어요. 잠시 후 다시 시도해주세요.')).toBeOnTheScreen();
    expect(setMe).not.toHaveBeenCalled();
  });

  test('올리는 동안 사진 버튼을 막는다', async () => {
    let finish!: (v: null) => void;
    (pickAndUploadProfilePhoto as jest.Mock).mockReturnValue(new Promise((r) => (finish = r)));
    await render(<ProfileEditScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: '사진 변경' }));
    expect(screen.getByRole('button', { name: '사진 변경' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '사진 지우기' })).toBeDisabled();
    await act(async () => finish(null));
    expect(screen.getByRole('button', { name: '사진 변경' })).toBeEnabled();
  });

  test('사진이 없으면 이름 첫 글자를 보이고 사진 추가를 둔다', async () => {
    auth({ id: 'u1', profile: { ...fullProfile, photo_url: null, bio: null } });
    await render(<ProfileEditScreen />);

    expect(await screen.findByText('김')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '사진 추가' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: '사진 지우기' })).not.toBeOnTheScreen();
    expect(screen.getByText('0 / 80자')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByDisplayValue('김민지'), '');
    expect(screen.getByText('?')).toBeOnTheScreen();
  });
});
