import { afterEach, beforeEach, describe, expect, it, vi } from "./expect";
import { startAutoRecognition, type AutoDeps, type SttCallbacks } from "../../src/lib/reading/audio/stt";

/**
 * 인식기를 가짜로 세워 두고 말 끝 판단만 본다.
 * 마이크는 인식기 안에만 있으므로 여기서 흉내 낼 것이 없다.
 */
function harness() {
  let live: SttCallbacks | null = null;
  let opened = 0;
  const stop = vi.fn(() => {
    // 실제 인식기는 stop 하면 지금까지의 결과를 onText 로 돌려준다.
    live?.onText(lastInterim);
  });
  const abort = vi.fn();
  let lastInterim = "";

  const deps: AutoDeps = {
    startRec: (cb) => {
      opened++;
      live = cb;
      lastInterim = "";
      queueMicrotask(() => cb.onStart?.());
      return { stop, abort };
    },
  };

  return {
    deps,
    stop,
    abort,
    get opened() {
      return opened;
    },
    /** 인식되는 중 */
    hear(text: string) {
      lastInterim = text;
      live?.onInterim?.(text);
    },
    fail(reason: "unavailable" | "denied" | "no-speech" | "failed") {
      live?.onError(reason);
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe("startAutoRecognition", () => {
  it("말이 멈추고 1.8초가 지나면 알아서 확정한다", async () => {
    const h = harness();
    const onText = vi.fn();
    startAutoRecognition({ onText, onError: vi.fn() }, h.deps);
    await tick();

    h.hear("여기 있을 줄 알았어");
    expect(onText).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1800);
    expect(onText).toHaveBeenCalledWith("여기 있을 줄 알았어");
  });

  it("말이 이어지는 동안에는 끝내지 않는다", async () => {
    const h = harness();
    const onText = vi.fn();
    startAutoRecognition({ onText, onError: vi.fn() }, h.deps);
    await tick();

    h.hear("달라지지");
    vi.advanceTimersByTime(1500);
    h.hear("달라지지 나는 알잖아");
    vi.advanceTimersByTime(1500);
    expect(onText).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(onText).toHaveBeenCalledWith("달라지지 나는 알잖아");
  });

  it("말을 시작하지 않았으면 1.8초가 지나도 끝내지 않는다", async () => {
    // 대사를 떠올리는 시간을 뺏으면 안 된다.
    const h = harness();
    const onText = vi.fn();
    const onError = vi.fn();
    startAutoRecognition({ onText, onError }, h.deps);
    await tick();

    vi.advanceTimersByTime(10000);
    expect(onText).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("크롬이 조급하게 닫으면 조용히 다시 연다", async () => {
    const h = harness();
    const onError = vi.fn();
    startAutoRecognition({ onText: vi.fn(), onError }, h.deps);
    await tick();
    expect(h.opened).toBe(1);

    h.fail("no-speech");
    expect(onError).not.toHaveBeenCalled();
    expect(h.opened).toBe(2);
  });

  it("다시 열려도 여태 들은 말을 잃지 않는다", async () => {
    // 인식기를 다시 열면 그쪽 결과는 초기화된다. 이어 붙이지 않으면 앞부분이 날아간다.
    const h = harness();
    const onText = vi.fn();
    startAutoRecognition({ onText, onError: vi.fn() }, h.deps);
    await tick();

    h.hear("달라지지");
    h.fail("no-speech");
    await tick();

    h.hear("나는 알잖아");
    vi.advanceTimersByTime(1800);
    expect(onText).toHaveBeenCalledWith("달라지지 나는 알잖아");
  });

  it("한 마디도 못 알아들은 채 오래 지나면 포기한다", async () => {
    const h = harness();
    const onError = vi.fn();
    startAutoRecognition({ onText: vi.fn(), onError }, h.deps, { maxListenMs: 5000 });
    await tick();

    vi.advanceTimersByTime(5000);
    expect(onError).toHaveBeenCalledWith("no-speech");
  });

  it("빈 결과를 통과로 넘기지 않는다", async () => {
    const h = harness();
    const onText = vi.fn();
    const onError = vi.fn();
    const handle = startAutoRecognition({ onText, onError }, h.deps);
    await tick();

    handle.finish();
    expect(onText).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("no-speech");
  });

  it("직접 확정하면 그 자리에서 끝낸다", async () => {
    const h = harness();
    const onText = vi.fn();
    const handle = startAutoRecognition({ onText, onError: vi.fn() }, h.deps);
    await tick();

    h.hear("고마워");
    handle.finish();
    expect(onText).toHaveBeenCalledWith("고마워");
  });

  it("인식이 거부되면 그대로 알린다", async () => {
    const h = harness();
    const onError = vi.fn();
    startAutoRecognition({ onText: vi.fn(), onError }, h.deps);
    await tick();

    h.fail("denied");
    expect(onError).toHaveBeenCalledWith("denied");
  });

  it("줄이 바뀌어 중단하면 아무것도 알리지 않는다", async () => {
    const h = harness();
    const onText = vi.fn();
    const onError = vi.fn();
    const handle = startAutoRecognition({ onText, onError }, h.deps);
    await tick();

    handle.abort();
    expect(h.abort).toHaveBeenCalled();

    vi.advanceTimersByTime(60000);
    expect(onText).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("인식되는 대로 화면에 흘려보낸다", async () => {
    const h = harness();
    const onInterim = vi.fn();
    startAutoRecognition({ onText: vi.fn(), onError: vi.fn(), onInterim }, h.deps);
    await tick();

    h.hear("여기 있을");
    expect(onInterim).toHaveBeenCalledWith("여기 있을");
  });
});
