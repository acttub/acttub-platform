import Feather from '@expo/vector-icons/Feather';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { Button, DangerButton, PrimaryButton, SecondaryButton, TextButton } from '@/components/ui/buttons';
import { Chip } from '@/components/ui/chip';
import { CtaBar } from '@/components/ui/cta-bar';
import { ActionSheetCard, DialogButtons, DialogCard } from '@/components/ui/dialog';
import { MascotBubble } from '@/components/ui/mascot-bubble';
import { NavBackButton, NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { IconOptionRow, OptionCard, SelectRow } from '@/components/ui/option-card';
import { StatusScreen } from '@/components/ui/status-screen';
import { BackOnlyHeader, ProgressHeader, StepHeader } from '@/components/ui/step-header';

// 공통 부품(SOMA-770) — 화면들이 기대는 접근성 이름·상태와 누름 전달을 지킨다.

describe('버튼', () => {
  test('누르면 알리고, 막히거나 불러오는 중이면 누를 수 없다', async () => {
    const press = jest.fn();
    await render(
      <>
        <PrimaryButton label="계속하기" onPress={press} phLabel="go" />
        <SecondaryButton label="건너뛰기" onPress={press} disabled />
        <DangerButton label="지우기" onPress={press} loading />
        <Button label="기본" onPress={press} icon={<Text>아이콘</Text>} accessibilityLabel="기본 버튼" />
      </>,
    );

    await fireEvent.press(screen.getByRole('button', { name: '계속하기' }));
    expect(press).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '계속하기' }).props['ph-label']).toBe('go');
    expect(screen.getByRole('button', { name: '건너뛰기' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '지우기' })).toBeDisabled();
    expect(screen.queryByText('지우기')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '기본 버튼' })).toBeEnabled();
    expect(screen.getByText('아이콘')).toBeOnTheScreen();
  });

  test('글자 버튼도 이름으로 누른다', async () => {
    const press = jest.fn();
    await render(<TextButton label="나중에" onPress={press} />);
    await fireEvent.press(screen.getByRole('button', { name: '나중에' }));
    expect(press).toHaveBeenCalled();
  });

  test('파란 글자 링크(tone=accent)는 글자만 파랗고 누름은 같다', async () => {
    const press = jest.fn();
    await render(
      <>
        <TextButton label="다시 불러오기" tone="accent" onPress={press} />
        <TextButton label="건너뛰기" onPress={press} />
      </>,
    );
    const color = (label: string) => StyleSheet.flatten(screen.getByText(label).props.style).color;
    expect(color('다시 불러오기')).toBe('#4880EE');
    expect(color('건너뛰기')).not.toBe('#4880EE');
    await fireEvent.press(screen.getByRole('button', { name: '다시 불러오기' }));
    expect(press).toHaveBeenCalledTimes(1);
  });
});

describe('머리', () => {
  test('가운데 제목과 아이콘 버튼마다 읽어 줄 이름·누름 이름을 둔다', async () => {
    const back = jest.fn();
    const more = jest.fn();
    await render(
      <NavHeader
        title="오디션 공고"
        left={<NavBackButton onPress={back} />}
        right={<NavIconButton icon="more-horizontal" label="더 보기" phLabel="more" onPress={more} />}
      />,
    );

    expect(screen.getByRole('header')).toHaveTextContent('오디션 공고');
    await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
    await fireEvent.press(screen.getByRole('button', { name: '더 보기' }));
    expect(back).toHaveBeenCalled();
    expect(more).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '더 보기' }).props['ph-label']).toBe('more');
  });

  test('제목이 없으면 꺾쇠만 그린다', async () => {
    const back = jest.fn();
    await render(<BackOnlyHeader onBack={back} />);
    expect(screen.queryByRole('header')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
    expect(back).toHaveBeenCalled();
  });

  test('진행 머리는 n/N 과 진행 값을 알린다', async () => {
    const back = jest.fn();
    await render(<ProgressHeader step={3} total={8} onBack={back} />);
    expect(screen.getByText('3/8')).toBeOnTheScreen();
    expect(screen.getByRole('progressbar').props.accessibilityValue).toEqual({ min: 0, max: 8, now: 3 });
    await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
    expect(back).toHaveBeenCalled();
  });

  test('점 단계 머리는 닫기 또는 꺾쇠를 두고 지금 단계를 알린다', async () => {
    const close = jest.fn();
    const view = await render(<StepHeader step={2} total={3} onClose={close} />);
    expect(screen.getByText('2 / 3')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '닫기' }));
    expect(close).toHaveBeenCalled();

    await view.rerender(<StepHeader step={1} total={3} onClose={close} icon="chevron-left" />);
    expect(screen.getByRole('button', { name: '뒤로' }).props['ph-label']).toBe('step_back');
  });
});

describe('선택지', () => {
  test('카드·아이콘 줄·고르는 줄이 누름과 고름 상태를 알린다', async () => {
    const press = jest.fn();
    await render(
      <>
        <OptionCard icon="message-circle" title="질문 코칭으로 보내기" sub="막힌 지점을 질문으로" onPress={press} />
        <OptionCard icon="award" title="챌린지에 올리기" onPress={press} disabled right={<Text>오른쪽</Text>} />
        <IconOptionRow icon="video" title="영상 고르기" sub="보관함에서" eyebrow="권해요" mark="check" selected onPress={press} />
        <IconOptionRow icon="clock" title="연습 기록" flush highlight onPress={press} />
        <SelectRow label="여성" selected onPress={press} trailing="check" />
        <SelectRow label="남성" selected={false} onPress={press} trailing="check" />
        <SelectRow label="배우로 활동" sub="오디션 · 캐스팅" selected onPress={press} />
        <SelectRow label="무대" selected={false} multi onPress={press} />
      </>,
    );

    await fireEvent.press(screen.getByRole('button', { name: '질문 코칭으로 보내기' }));
    expect(screen.getByRole('button', { name: '챌린지에 올리기' })).toBeDisabled();
    expect(screen.getByText('오른쪽')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '영상 고르기' })).toBeSelected();
    expect(screen.getByText('권해요')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '연습 기록' })).not.toBeSelected();
    expect(screen.getByRole('radio', { name: '여성' })).toBeSelected();
    expect(screen.getByRole('radio', { name: '남성' })).not.toBeSelected();
    expect(screen.getByText('오디션 · 캐스팅')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('checkbox', { name: '무대' }));
    expect(screen.getByRole('checkbox', { name: '무대' })).not.toBeChecked();
    expect(press).toHaveBeenCalledTimes(2);
  });

  test('누르면 바로 넘어가는 아이콘 줄(mark none)은 오른쪽에 꺾쇠도 체크도 없다', async () => {
    // 아이콘 글리프(폰트 글자)를 먼저 얻어 둔다.
    const glyphOf = async (name: 'chevron-right' | 'check') => {
      const icon = await render(<Feather name={name} size={20} />);
      const glyph = JSON.stringify(icon.toJSON());
      await icon.unmount();
      return JSON.parse(glyph).children[0] as string;
    };
    const chevron = await glyphOf('chevron-right');
    const check = await glyphOf('check');
    const press = jest.fn();
    const view = await render(
      <>
        <IconOptionRow icon="star" title="평가 받기" mark="none" selected onPress={press} />
        <IconOptionRow icon="unlock" title="막힌 곳 풀기" mark="none" onPress={press} />
      </>,
    );
    const tree = JSON.stringify(view.toJSON());
    expect(tree.includes(JSON.stringify(chevron))).toBe(false);
    expect(tree.includes(JSON.stringify(check))).toBe(false);
    expect(screen.getByRole('button', { name: '평가 받기' })).toBeSelected();
    await fireEvent.press(screen.getByRole('button', { name: '막힌 곳 풀기' }));
    expect(press).toHaveBeenCalledTimes(1);
  });

  test('칩은 고름 상태를 알리고, 누를 곳이 없으면 막힌다', async () => {
    const press = jest.fn();
    await render(
      <>
        <Chip label="기쁨" selected onPress={press} phLabel="chip" />
        <Chip label="보기만" />
      </>,
    );
    await fireEvent.press(screen.getByRole('button', { name: '기쁨' }));
    expect(press).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '기쁨' })).toBeSelected();
    expect(screen.getByRole('button', { name: '보기만' })).toBeDisabled();
  });
});

describe('확인창·시트', () => {
  test('카드 버튼은 취소·확인을 전하고, 바쁘면 막는다', async () => {
    const cancel = jest.fn();
    const ok = jest.fn();
    const view = await render(
      <DialogCard title="지울까요?" message="되돌릴 수 없어요.">
        <DialogButtons cancelLabel="취소" onCancel={cancel} confirmLabel="지우기" onConfirm={ok} destructive />
      </DialogCard>,
    );
    expect(screen.getByText('되돌릴 수 없어요.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '취소' }));
    await fireEvent.press(screen.getByRole('button', { name: '지우기' }));
    expect(cancel).toHaveBeenCalled();
    expect(ok).toHaveBeenCalled();

    await view.rerender(
      <DialogCard title="알림">
        <DialogButtons confirmLabel="확인" onConfirm={ok} busy />
      </DialogCard>,
    );
    expect(screen.queryByRole('button', { name: '취소' })).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '확인' })).toBeDisabled();
  });

  test('선택 시트는 항목과 취소를 따로 전한다', async () => {
    const pick = jest.fn();
    const cancel = jest.fn();
    await render(
      <ActionSheetCard
        title="선택"
        items={[
          { label: '공유', onPress: pick },
          { label: '삭제', onPress: pick, destructive: true },
        ]}
        cancelLabel="취소"
        onCancel={cancel}
      />,
    );
    await fireEvent.press(screen.getByText('삭제'));
    await fireEvent.press(screen.getByText('취소'));
    expect(pick).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe('상태 화면·말풍선·아래 칸', () => {
  test('상태 화면은 제목·설명·버튼과 꺾쇠를 둔다', async () => {
    const retry = jest.fn();
    const back = jest.fn();
    await render(
      <StatusScreen
        title="공고를 불러오지 못했어요"
        body="인터넷을 확인해 주세요."
        note="오류 503"
        onBack={back}
        safeArea
        primary={{ label: '다시 시도', onPress: retry }}
        secondary={{ label: '닫기', onPress: back }}
      />,
    );
    expect(screen.getByText('오류 503')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
    await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
    expect(retry).toHaveBeenCalled();
    expect(back).toHaveBeenCalled();
  });

  test('큰 상태 화면과 아이콘 상태 화면도 그린다', async () => {
    const view = await render(
      <StatusScreen size="large" title="지금은 가입할 수 없어요" body="만 14세 이상부터" actions={<Text>직접 버튼</Text>} />,
    );
    expect(screen.getByText('만 14세 이상부터')).toBeOnTheScreen();
    expect(screen.getByText('직접 버튼')).toBeOnTheScreen();

    await view.rerender(<StatusScreen icon="mic-off" title="마이크가 필요해요" body="설정에서 켜세요." bodyTone="blue" />);
    expect(screen.getByText('설정에서 켜세요.')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });

  test('말풍선은 파란 안내와 회색 보조를 둘 다 쓸 수 있다', async () => {
    await render(<MascotBubble title="뭐라고 불러 드릴까요?" guide="「계속하기」를 누르세요." body="보조 한 줄" />);
    expect(screen.getByText('「계속하기」를 누르세요.')).toBeOnTheScreen();
    expect(screen.getByText('보조 한 줄')).toBeOnTheScreen();
  });

  test('아래 칸은 안에 둔 버튼을 그린다', async () => {
    await render(
      <CtaBar divider>
        <Text>저장하고 마치기</Text>
      </CtaBar>,
    );
    expect(screen.getByText('저장하고 마치기')).toBeOnTheScreen();
  });
});
