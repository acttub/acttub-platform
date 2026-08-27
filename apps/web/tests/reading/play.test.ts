import { describe, expect, it } from "./expect";
import { durationMs, END_GRACE_MS, isSane, PlaybackStalledError, START_TIMEOUT_MS } from "../../src/lib/reading/audio/supertonic/play";

describe("play — 감시 타이머의 재료", () => {
  it("합성 길이를 ms 로 잰다", () => {
    expect(durationMs({ samples: new Float32Array(44100), sampleRate: 44100 })).toBe(1000);
    expect(durationMs({ samples: new Float32Array(0), sampleRate: 0 })).toBe(0);
  });

  it("시작 감시는 3초, 끝 감시는 길이 + 2초다 — 리허설이 영원히 멈추지 않게", () => {
    expect(START_TIMEOUT_MS).toBe(3000);
    expect(END_GRACE_MS).toBe(2000);
  });

  it("시작을 못 하면 PlaybackStalledError 로 알린다 — 부르는 쪽이 기기 음성으로 넘긴다", () => {
    const e = new PlaybackStalledError("start");
    expect(e.name).toBe("PlaybackStalledError");
    expect(e instanceof Error).toBe(true);
  });

  it("깨진 진폭은 재생하지 않는다", () => {
    expect(isSane(new Float32Array([0.1, -0.3, 0.9]))).toBe(true);
    expect(isSane(new Float32Array([0.1, 40, 0.2]))).toBe(false);
    expect(isSane(new Float32Array([]))).toBe(false);
  });
});
