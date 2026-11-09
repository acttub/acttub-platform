import { fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StyleSheet, Text } from 'react-native';

import { Badge } from '@/components/ui/badge';
import { Button, DangerButton, PrimaryButton, SecondaryButton, TextButton } from '@/components/ui/buttons';
import { ChatComposer } from '@/components/ui/chat-composer';
import { Chip } from '@/components/ui/chip';
import { Checkbox } from '@/components/ui/checkbox';
import { DoneScreen } from '@/components/ui/done-screen';
import { CtaBar } from '@/components/ui/cta-bar';
import { AnchoredMenu, MenuItem } from '@/components/ui/anchored-menu';
import { DialogButtons, DialogCard } from '@/components/ui/dialog';
import { MascotBubble } from '@/components/ui/mascot-bubble';
import { NavBackButton, NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { InlineError, InlineErrorLine } from '@/components/ui/inline-error';
import { StatusScreen } from '@/components/ui/status-screen';
import { useTabFloatingAddBottom } from '@/components/ui/floating-add';
import { useTabBarSpace } from '@/components/ui/tab-bar';
import { setFirstTimeProvisional, setFirstTimeState } from '@/lib/practice/first-time';
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

  test('보조 작은 버튼(secondary sm)은 bg-soft 바탕에 text-sub 글자다', async () => {
    await render(<Button label="차단 풀기" size="sm" variant="secondary" onPress={jest.fn()} />);
    const box = StyleSheet.flatten(screen.getByRole('button', { name: '차단 풀기' }).props.style);
    expect([box.height, box.borderRadius, box.backgroundColor]).toEqual([32, 12, '#F2F4F6']);
    expect(StyleSheet.flatten(screen.getByText('차단 풀기').props.style).color).toBe('#4E5968');
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

  test('글자 버튼은 앞 아이콘을 두고, 처리 중이면 아이콘 없이 문구만 보이며 눌리지 않는다(SOMA-1048)', async () => {
    const press = jest.fn();
    const view = await render(<TextButton label="다시 읽기" tone="accent" icon={<Text>↻</Text>} onPress={press} />);
    expect(screen.getByText('↻')).toBeOnTheScreen();
    await view.rerender(<TextButton label="다시 읽기" tone="accent" icon={<Text>↻</Text>} loading loadingLabel="준비하는 중…" onPress={press} />);
    expect(screen.queryByText('↻')).not.toBeOnTheScreen();
    expect(screen.getByText('준비하는 중…')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '다시 읽기' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: '다시 읽기' }));
    expect(press).not.toHaveBeenCalled();
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
    expect(StyleSheet.flatten(screen.getByRole('button', { name: '제목 수정' }).props.style).minHeight).toBe(44);
    expect(StyleSheet.flatten(screen.getByText('대본 삭제').props.style).color).toBe('#E42939');
    await fireEvent.press(screen.getByRole('button', { name: '대본 삭제' }));
    expect(pick).toHaveBeenCalledTimes(1);
  });

  test('고른 메뉴 항목은 고름 상태를 알리고 blue-deep 글자다', async () => {
    await render(
      <AnchoredMenu estimatedHeight={100} onClose={jest.fn()}>
        <MenuItem label="한국어" selected onPress={jest.fn()} />
        <MenuItem label="English" selected={false} onPress={jest.fn()} />
      </AnchoredMenu>,
    );
    expect(screen.getByRole('button', { name: '한국어', selected: true })).toBeOnTheScreen();
    expect(StyleSheet.flatten(screen.getByText('한국어').props.style).color).toBe('#3268D8');
    expect(StyleSheet.flatten(screen.getByText('English').props.style).color).toBe('#191F28');
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
        primary={{ label: '다시 시도', onPress: retry, phLabel: 'status_retry' }}
        secondary={{ label: '닫기', onPress: back, phLabel: 'status_close' }}
      />,
    );
    expect(screen.getByRole('header')).toHaveTextContent('오디션 공고');
    // 버튼 탭 기록 이름이 버튼까지 내려간다.
    expect(screen.getByRole('button', { name: '다시 시도' }).props['ph-label']).toBe('status_retry');
    expect(screen.getByRole('button', { name: '닫기' }).props['ph-label']).toBe('status_close');
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

describe('완료 화면', () => {
  test('머리 없이 제목 title1 · 대본 이름 · 내용을 두고 아래 「홈으로 가기」 하나로 홈에 간다', async () => {
    const home = jest.fn();
    await render(
      <DoneScreen title="오늘 리딩을 마쳤어요" scriptName="버스정류장" onHome={home}>
        <Text>다시 읽기</Text>
      </DoneScreen>,
    );
    expect(StyleSheet.flatten(screen.getByRole('header').props.style).fontSize).toBe(24);
    expect(screen.getByRole('header')).toHaveTextContent('오늘 리딩을 마쳤어요');
    expect(screen.getByText('버스정류장')).toBeOnTheScreen();
    expect(screen.getByText('다시 읽기')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: '뒤로' })).not.toBeOnTheScreen();
    expect(screen.getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual(['홈으로 가기']);
    await fireEvent.press(screen.getByRole('button', { name: '홈으로 가기' }));
    expect(home).toHaveBeenCalledTimes(1);
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
  test('체크는 채운 원 안의 흰 체크이고 꺼짐은 빈 원, 되돌릴 수 없는 동의만 켜짐이 빨강이다', async () => {
    const drawn = async (node: React.ReactElement) => {
      const view = await render(node);
      const json = JSON.parse(JSON.stringify(view.toJSON()));
      await view.unmount();
      return { style: StyleSheet.flatten(json.props.style), glyphs: json.children?.length ?? 0 };
    };
    expect(await drawn(<Checkbox checked />)).toEqual({ style: expect.objectContaining({ width: 22, backgroundColor: '#4880EE' }), glyphs: 1 });
    expect(await drawn(<Checkbox checked={false} />)).toEqual({ style: expect.objectContaining({ width: 22, borderWidth: 1.5, borderColor: '#B0B8C1' }), glyphs: 0 });
    expect(await drawn(<Checkbox checked danger />)).toEqual({ style: expect.objectContaining({ backgroundColor: '#E42939' }), glyphs: 1 });
  });

  test('채팅 입력칸은 보낼 수 있을 때만 칸 안에 36 보내기를 그리고 그때만 오른쪽 안쪽을 줄인다', async () => {
    const onSend = jest.fn();
    const composer = (canSend: boolean) => (
      <ChatComposer value="답" onChangeText={() => {}} onSend={onSend} canSend={canSend} sendLabel="보내기" placeholder="입력" label="입력" maxLength={10} />
    );
    const paddingRight = (view: Awaited<ReturnType<typeof render>>) =>
      StyleSheet.flatten(JSON.parse(JSON.stringify(view.toJSON())).props.style).paddingRight;

    const hidden = await render(composer(false));
    expect(screen.queryByRole('button', { name: '보내기' })).not.toBeOnTheScreen();
    expect(paddingRight(hidden)).toBe(16);
    await hidden.unmount();

    const shown = await render(composer(true));
    const send = screen.getByRole('button', { name: '보내기' });
    expect(StyleSheet.flatten(send.props.style)).toEqual(expect.objectContaining({ width: 36, height: 36, backgroundColor: '#4880EE' }));
    expect(paddingRight(shown)).toBe(4);
    await fireEvent.press(send);
    expect(onSend).toHaveBeenCalledTimes(1);
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
    expect(StyleSheet.flatten(screen.getByText('두 글자 이상 입력해 주세요').props.style).color).toBe('#E42939');
  });

  test('목록 빈 상자는 제목과 설명을 두고, 설명이 없으면 제목만 그린다', async () => {
    const { rerender } = await render(<InlineEmpty title="아직 알림이 없어요" description="좋아요·댓글 소식이 여기에 와요" />);
    expect(StyleSheet.flatten(screen.getByText('아직 알림이 없어요').props.style)).toMatchObject({ fontSize: 14, fontWeight: '700', color: '#4E5968' });
    expect(screen.getByText('좋아요·댓글 소식이 여기에 와요')).toBeOnTheScreen();
    await rerender(<InlineEmpty title="차단한 사용자가 없어요" />);
    expect(screen.getByText('차단한 사용자가 없어요')).toBeOnTheScreen();
    expect(screen.queryByText('좋아요·댓글 소식이 여기에 와요')).not.toBeOnTheScreen();
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

describe('FloatingAdd 위치', () => {
  afterEach(() => {
    setFirstTimeProvisional(false);
    setFirstTimeState('unknown');
  });

  test('탭바가 보이면 탭바 위, 첫 사용자로 숨거나 홈 뼈대가 숨기면 안전영역 위 12다', async () => {
    const insets = { top: 0, bottom: 34, left: 0, right: 0 };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets }}>{children}</SafeAreaProvider>
    );
    const shown = await renderHook(() => ({ bottom: useTabFloatingAddBottom(), tab: useTabBarSpace() }), { wrapper });
    expect(shown.result.current.bottom).toBe(shown.result.current.tab);

    setFirstTimeState('first');
    const first = await renderHook(() => useTabFloatingAddBottom(), { wrapper });
    expect(first.result.current).toBe(34 + 12);

    setFirstTimeState('unknown');
    setFirstTimeProvisional(true);
    const skeleton = await renderHook(() => useTabFloatingAddBottom(), { wrapper });
    expect(skeleton.result.current).toBe(34 + 12);
  });
});
