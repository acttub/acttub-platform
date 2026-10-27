import Feather from '@expo/vector-icons/Feather';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { Badge } from '@/components/ui/badge';
import { Button, DangerButton, PrimaryButton, SecondaryButton, TextButton } from '@/components/ui/buttons';
import { Chip } from '@/components/ui/chip';
import { Checkbox } from '@/components/ui/checkbox';
import { CtaBar } from '@/components/ui/cta-bar';
import { AnchoredMenu, MenuItem } from '@/components/ui/anchored-menu';
import { DialogButtons, DialogCard } from '@/components/ui/dialog';
import { MascotBubble } from '@/components/ui/mascot-bubble';
import { NavBackButton, NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { InlineError, InlineErrorLine } from '@/components/ui/inline-error';
import { IconOptionRow, OptionCard, SelectRow } from '@/components/ui/option-card';
import { StatusScreen } from '@/components/ui/status-screen';
import { StepHeader } from '@/components/ui/step-header';
import { TextField } from '@/components/ui/text-field';

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
    // SOMA-828: 불러오는 중에는 로딩 표시 대신 문구를 보여 준다.
    expect(screen.getByText('잠시만요…')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '기본 버튼' })).toBeEnabled();
    expect(screen.getByText('아이콘')).toBeOnTheScreen();
  });

  test('작은 버튼(sm)은 높이 32 옅은 파랑 바탕에 blue-deep 글자다', async () => {
    await render(<Button label="다시 시도" size="sm" onPress={jest.fn()} />);
    const box = StyleSheet.flatten(screen.getByRole('button', { name: '다시 시도' }).props.style);
    expect([box.height, box.borderRadius, box.backgroundColor]).toEqual([32, 12, '#EAF3FE']);
    expect(StyleSheet.flatten(screen.getByText('다시 시도').props.style).color).toBe('#3268D8');
  });

  test('글자 버튼도 이름으로 누른다', async () => {
    const press = jest.fn();
    await render(<TextButton label="나중에" onPress={press} />);
    await fireEvent.press(screen.getByRole('button', { name: '나중에' }));
    expect(press).toHaveBeenCalled();
  });

  test('링크 글자 버튼(tone=accent)은 blue-deep, 보조 글자 버튼은 text-sub 다', async () => {
    const press = jest.fn();
    await render(
      <>
        <TextButton label="다시 불러오기" tone="accent" onPress={press} />
        <TextButton label="건너뛰기" onPress={press} />
      </>,
    );
    const color = (label: string) => StyleSheet.flatten(screen.getByText(label).props.style).color;
    expect(color('다시 불러오기')).toBe('#3268D8');
    expect(color('건너뛰기')).toBe('#4E5968');
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

  test('제목이 없으면 꺾쇠만 그리고, 꺾쇠는 26 이다', async () => {
    const back = jest.fn();
    const view = await render(<NavHeader left={<NavBackButton onPress={back} label="나가기" />} />);
    expect(screen.queryByRole('header')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '나가기' }));
    expect(back).toHaveBeenCalled();
    expect(JSON.stringify(view.toJSON())).toContain('"fontSize":26');
  });

  test('머리 제목은 headline, 큰 머리 제목은 display 다', async () => {
    const view = await render(<NavHeader title="알림" />);
    const title = () => StyleSheet.flatten(screen.getByRole('header').props.style);
    expect([title().fontSize, title().fontWeight]).toEqual([17, '600']);
    await view.rerender(<NavHeader large title="내 대본" right={<Text>새 대본</Text>} />);
    expect([title().fontSize, title().fontWeight]).toEqual([28, '700']);
    expect(screen.getByText('새 대본')).toBeOnTheScreen();
  });

  test('단계 머리는 꺾쇠 · n / N 과 진행 값을 알린다', async () => {
    const back = jest.fn();
    await render(<StepHeader step={3} total={8} onBack={back} />);
    expect(screen.getByText('3 / 8')).toBeOnTheScreen();
    expect(screen.getByRole('progressbar').props.accessibilityValue).toEqual({ min: 0, max: 8, now: 3 });
    await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
    expect(back).toHaveBeenCalled();
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

  test('확인창 버튼은 48 두 칸이고 위험한 확인은 빨강이다', async () => {
    await render(
      <DialogCard title="지울까요?">
        <DialogButtons cancelLabel="취소" onCancel={jest.fn()} confirmLabel="지우기" onConfirm={jest.fn()} destructive />
      </DialogCard>,
    );
    const box = (name: string) => StyleSheet.flatten(screen.getByRole('button', { name }).props.style);
    expect([box('취소').height, box('취소').backgroundColor]).toEqual([48, '#F2F4F6']);
    expect([box('지우기').height, box('지우기').backgroundColor]).toEqual([48, '#E42939']);
    expect(StyleSheet.flatten(screen.getByText('지울까요?').props.style).fontWeight).toBe('600');
  });

  test('메뉴는 폭 200 · 1px 테두리 카드에 44 항목을 두고, 삭제는 빨강이다', async () => {
    const pick = jest.fn();
    await render(
      <AnchoredMenu anchor={{ x: 300, y: 80 }} estimatedHeight={100} onClose={jest.fn()}>
        <MenuItem label="제목 수정" icon="edit-2" onPress={pick} />
        <MenuItem label="대본 삭제" destructive onPress={pick} />
      </AnchoredMenu>,
    );
    const card = StyleSheet.flatten(screen.getByTestId('anchored-menu').props.style);
    expect([card.width, card.borderWidth, card.borderRadius, card.overflow]).toEqual([200, 1, 12, undefined]);
    expect(StyleSheet.flatten(screen.getByRole('button', { name: '제목 수정' }).props.style).height).toBe(44);
    expect(StyleSheet.flatten(screen.getByText('대본 삭제').props.style).color).toBe('#E42939');
    await fireEvent.press(screen.getByRole('button', { name: '대본 삭제' }));
    expect(pick).toHaveBeenCalledTimes(1);
  });
});

describe('상태 화면·말풍선·아래 칸', () => {
  test('오류 상태 화면은 머리에 화면 이름, 제목 title1, 가운데 40 버튼을 둔다', async () => {
    const retry = jest.fn();
    const back = jest.fn();
    await render(
      <StatusScreen
        header="오디션 공고"
        title="공고를 불러오지 못했어요"
        body="인터넷 연결을 확인해 주세요."
        note="오류 503"
        onBack={back}
        primary={{ label: '다시 시도', onPress: retry }}
        secondary={{ label: '닫기', onPress: back }}
      />,
    );
    expect(screen.getByRole('header')).toHaveTextContent('오디션 공고');
    expect(StyleSheet.flatten(screen.getByText('공고를 불러오지 못했어요').props.style).fontSize).toBe(24);
    expect(screen.getByText('오류 503')).toBeOnTheScreen();
    expect(StyleSheet.flatten(screen.getByRole('button', { name: '다시 시도' }).props.style).height).toBe(40);
    await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
    await fireEvent.press(screen.getByRole('button', { name: '닫기' }));
    await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(2);
  });

  test('빈 상태는 제목 title2 이고 머리가 없으면 그리지 않는다, 불러오는 중은 뼈대다', async () => {
    const view = await render(<StatusScreen kind="empty" title="조건에 맞는 공고가 없어요" />);
    expect(StyleSheet.flatten(screen.getByText('조건에 맞는 공고가 없어요').props.style).fontSize).toBe(20);
    expect(screen.queryByRole('header')).not.toBeOnTheScreen();
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();

    await view.rerender(<StatusScreen kind="loading" header="알림" />);
    expect(screen.getByRole('header')).toHaveTextContent('알림');
    expect(screen.getByTestId('skeleton')).toBeOnTheScreen();
  });

  test('말풍선은 파란 안내와 회색 보조를 둘 다 쓸 수 있다', async () => {
    await render(<MascotBubble title="뭐라고 불러 드릴까요?" guide="「계속하기」를 누르세요." body="보조 한 줄" />);
    expect(screen.getByText('「계속하기」를 누르세요.')).toBeOnTheScreen();
    expect(screen.getByText('보조 한 줄')).toBeOnTheScreen();
  });

  test('아래 칸은 위 구분선 없이 안쪽 위 12 · 좌우 20 으로 버튼을 그린다', async () => {
    await render(
      <CtaBar safeBottom={false}>
        <Text>저장하고 마치기</Text>
      </CtaBar>,
    );
    const bar = StyleSheet.flatten(screen.getByText('저장하고 마치기').parent?.props.style);
    expect([bar.paddingTop, bar.paddingHorizontal, bar.paddingBottom, bar.gap, bar.borderTopWidth]).toEqual([12, 20, 12, 8, undefined]);
  });
});

describe('배지', () => {
  test('숫자 배지는 높이 20 · 최소 폭 20 빨간 알약에 글자를 그대로 둔다', async () => {
    await render(<Badge label="99+" />);
    const box = StyleSheet.flatten(screen.getByText('99+').parent?.props.style);
    expect([box.height, box.minWidth, box.backgroundColor, box.borderRadius]).toEqual([20, 20, '#E42939', 999]);
    expect(StyleSheet.flatten(screen.getByText('99+').props.style).fontSize).toBe(12);
  });
});

describe('체크·입력칸·오류 줄', () => {
  test('체크는 원형 하나이고 되돌릴 수 없는 동의만 켜짐이 빨강이다', async () => {
    const drawn = async (node: React.ReactElement) => {
      const view = await render(node);
      const json = JSON.parse(JSON.stringify(view.toJSON()));
      await view.unmount();
      return [json.children[0], StyleSheet.flatten(json.props.style).color];
    };
    const [onGlyph] = await drawn(<Feather name="check-circle" size={22} />);
    const [offGlyph] = await drawn(<Feather name="circle" size={22} />);
    expect(await drawn(<Checkbox checked />)).toEqual([onGlyph, '#4880EE']);
    expect(await drawn(<Checkbox checked={false} />)).toEqual([offGlyph, '#B0B8C1']);
    expect(await drawn(<Checkbox checked danger />)).toEqual([onGlyph, '#E42939']);
  });

  test('입력칸은 이름표로 읽히고, 입력 중 파랑 · 오류면 빨강 테두리와 아래 한 줄이다', async () => {
    const { rerender } = await render(<TextField label="이름" placeholder="이름을 입력해 주세요" />);
    const border = () => StyleSheet.flatten(screen.getByLabelText('이름').props.style).borderColor;
    expect(border()).toBe('#E5E8EB');
    await fireEvent(screen.getByLabelText('이름'), 'focus');
    expect(border()).toBe('#4880EE');
    await rerender(<TextField label="이름" error="두 글자 이상 입력해 주세요" />);
    expect(border()).toBe('#E42939');
    expect(screen.getByText('두 글자 이상 입력해 주세요')).toBeOnTheScreen();
  });

  test('불러오기 오류 상자는 다시 시도를 알리고, 오류 줄은 문구만 둔다', async () => {
    const retry = jest.fn();
    await render(
      <>
        <InlineError message="목록을 불러오지 못했어요" onRetry={retry} />
        <InlineErrorLine message="저장하지 못했어요." />
      </>,
    );
    await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByText('저장하지 못했어요.')).toBeOnTheScreen();
  });
});
