import { afterEach, beforeEach, describe, expect, it } from "./expect";
import { mergeTranscripts, startRecognition } from "../../src/lib/reading/audio/stt";

type Result = { transcript: string; isFinal: boolean };

/** 브라우저 인식기 흉내. 테스트가 결과 이벤트를 직접 쏜다. */
class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = "";
  interimResults = false;
  continuous = false;
  maxAlternatives = 1;
  onresult: ((e: { results: unknown[] }) => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.onstart?.();
  }
  stop() {
    this.onend?.();
  }
  abort() {}
  emit(results: Result[]) {
    this.onresult?.({
      results: results.map((r) => Object.assign([{ transcript: r.transcript }], { isFinal: r.isFinal })),
    });
  }
}

describe("startRecognition — 안드로이드 누적 중간 결과", () => {
  beforeEach(() => {
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognition;
  });
  afterEach(() => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  });

  it("누적된 중간 항목을 이어 붙이지 않고 마지막 것만 쓴다", () => {
    const got: string[] = [];
    const l = startRecognition({ onInterim: (t) => got.push(t), onText: (t) => got.push("FINAL:" + t), onError: () => {} });
    const r = FakeRecognition.last!;
    r.emit([{ transcript: "너", isFinal: false }]);
    r.emit([
      { transcript: "너", isFinal: false },
      { transcript: "너 맨날", isFinal: false },
    ]);
    r.emit([
      { transcript: "너", isFinal: false },
      { transcript: "너 맨날", isFinal: false },
      { transcript: "너 맨날 그러잖아", isFinal: false },
    ]);
    l.stop();
    expect(got).toEqual(["너", "너 맨날", "너 맨날 그러잖아", "FINAL:너 맨날 그러잖아"]);
  });

  it("확정 항목까지 누적으로 오는 안드로이드도 겹치지 않는다", () => {
    const got: string[] = [];
    const l = startRecognition({ onText: (t) => got.push(t), onError: () => {} });
    const r = FakeRecognition.last!;
    r.emit([
      { transcript: "너", isFinal: true },
      { transcript: "너맨날", isFinal: true },
      { transcript: "너 맨날 그러잖아", isFinal: false },
    ]);
    l.stop();
    expect(got).toEqual(["너 맨날 그러잖아"]);
  });

  it("mergeTranscripts — 조각은 잇고 누적은 갈아 끼운다", () => {
    expect(mergeTranscripts(["너 맨날", "그러잖아"])).toBe("너 맨날 그러잖아");
    expect(mergeTranscripts(["너", "너맨날", "너맨날그러잖아"])).toBe("너맨날그러잖아");
    expect(mergeTranscripts(["너 맨날 그러잖아", "너"])).toBe("너 맨날 그러잖아");
    expect(mergeTranscripts(["", "  ", "가자"])).toBe("가자");
  });

  it("확정된 항목이 여러 개면 그것들만 이어 붙인다 (데스크톱 연속 인식)", () => {
    const got: string[] = [];
    const l = startRecognition({ onText: (t) => got.push(t), onError: () => {} });
    const r = FakeRecognition.last!;
    r.emit([
      { transcript: "너 맨날", isFinal: true },
      { transcript: "그러", isFinal: false },
    ]);
    r.emit([
      { transcript: "너 맨날", isFinal: true },
      { transcript: "그러잖아", isFinal: true },
    ]);
    l.stop();
    expect(got).toEqual(["너 맨날 그러잖아"]);
  });
});
