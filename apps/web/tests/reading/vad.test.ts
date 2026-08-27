import { describe, expect, it } from "./expect";
import { createSilenceDetector } from "../../src/lib/reading/audio/vad";

const opts = { threshold: 0.02, silenceMs: 1000, minSpeechMs: 300, maxListenMs: 10000 };

describe("createSilenceDetector", () => {
  it("말이 시작되면 speech_start, 충분히 조용해지면 speech_end", () => {
    const d = createSilenceDetector(opts, 0);
    expect(d.feed(0.001, 100)).toBe("none");
    expect(d.feed(0.05, 200)).toBe("speech_start");
    expect(d.feed(0.05, 600)).toBe("none");
    expect(d.feed(0.001, 700)).toBe("none");
    expect(d.feed(0.001, 1500)).toBe("none"); // 900ms 침묵 — 아직
    expect(d.feed(0.001, 1650)).toBe("speech_end"); // 1050ms 침묵
  });

  it("짧은 소음은 발화로 치지 않고 다시 대기한다", () => {
    const d = createSilenceDetector(opts, 0);
    expect(d.feed(0.05, 100)).toBe("speech_start");
    expect(d.feed(0.001, 200)).toBe("none");
    expect(d.feed(0.001, 1300)).toBe("none"); // 100ms 발화 → 무시
    expect(d.speaking()).toBe(false);
    expect(d.feed(0.05, 1400)).toBe("speech_start");
  });

  it("아무 말도 없으면 maxListenMs에 timeout", () => {
    const d = createSilenceDetector(opts, 0);
    expect(d.feed(0.001, 9999)).toBe("none");
    expect(d.feed(0.001, 10000)).toBe("timeout");
  });

  it("말하는 중에는 침묵이 끊기면 다시 잰다", () => {
    const d = createSilenceDetector(opts, 0);
    d.feed(0.05, 0);
    d.feed(0.05, 500);
    d.feed(0.001, 600);
    d.feed(0.05, 1400); // 800ms 침묵 뒤 다시 말함
    expect(d.feed(0.001, 1500)).toBe("none");
    expect(d.feed(0.001, 2300)).toBe("none");
    expect(d.feed(0.001, 2500)).toBe("speech_end");
  });

  it("reset 뒤엔 처음부터", () => {
    const d = createSilenceDetector(opts, 0);
    d.feed(0.05, 100);
    d.reset(5000);
    expect(d.speaking()).toBe(false);
    expect(d.feed(0.001, 14999)).toBe("none");
    expect(d.feed(0.001, 15000)).toBe("timeout");
  });
});
