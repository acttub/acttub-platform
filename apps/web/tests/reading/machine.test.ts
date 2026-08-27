import { describe, expect, it } from "./expect";
import type { ScriptLine } from "../../src/lib/reading/script/parse";
import {
  advance,
  begin,
  createRehearsal,
  pause,
  progress,
  restart,
  resume,
  turnOf,
  window,
} from "../../src/lib/reading/rehearsal/machine";

const lines: ScriptLine[] = [
  { type: "direction", text: "카페. 저녁." },
  { type: "dialogue", role: "민준", text: "오래 기다렸어?" },
  { type: "dialogue", role: "지수", text: "아니, 나도 방금 왔어." },
  { type: "direction", text: "사이." },
  { type: "dialogue", role: "민준", text: "다행이다." },
  { type: "dialogue", role: "지수", text: "고마워." },
  { type: "dialogue", role: "민준", text: "가자." },
];

const cfg = { lines, myRole: "지수", start: 0, end: lines.length - 1 };

describe("createRehearsal / begin", () => {
  it("첫 대사 위치에서 idle로 시작한다", () => {
    const s = createRehearsal(cfg);
    expect(s.index).toBe(1);
    expect(s.status).toBe("idle");
  });

  it("begin은 현재 줄의 화자에 따라 ai/me가 된다", () => {
    expect(begin(createRehearsal(cfg)).status).toBe("ai");
    expect(begin(createRehearsal({ ...cfg, myRole: "민준" })).status).toBe("me");
  });

  it("범위에 대사가 없으면 바로 done", () => {
    expect(createRehearsal({ ...cfg, start: 3, end: 3 }).status).toBe("done");
  });
});

describe("advance", () => {
  it("지문을 건너뛰고 다음 대사로 간다", () => {
    let s = begin(createRehearsal(cfg));
    s = advance(s); // 지수
    expect(s.index).toBe(2);
    expect(s.status).toBe("me");
    s = advance(s); // 지문 건너뛰고 민준
    expect(s.index).toBe(4);
    expect(s.status).toBe("ai");
  });

  it("범위 끝을 지나면 done", () => {
    let s = begin(createRehearsal({ ...cfg, start: 4, end: 5 }));
    s = advance(s);
    expect(s.status).toBe("me");
    s = advance(s);
    expect(s.status).toBe("done");
    expect(advance(s).status).toBe("done");
  });
});

describe("pause / resume", () => {
  it("일시정지하면 어디로 돌아올지 기억한다", () => {
    const s = begin(createRehearsal(cfg));
    const p = pause(s);
    expect(p.status).toBe("paused");
    expect(resume(p).status).toBe("ai");
  });

  it("idle·done은 일시정지되지 않는다", () => {
    const s = createRehearsal(cfg);
    expect(pause(s).status).toBe("idle");
  });
});

describe("progress / window / restart", () => {
  it("대사 기준으로 진행률을 센다", () => {
    let s = begin(createRehearsal(cfg));
    expect(progress(s)).toEqual({ done: 0, total: 5 });
    s = advance(advance(s));
    expect(progress(s)).toEqual({ done: 2, total: 5 });
  });

  it("window는 지난 줄·현재·다음 대사를 준다", () => {
    const s = advance(begin(createRehearsal(cfg)));
    const w = window(s);
    expect(w.past.map((l) => l.text)).toEqual(["카페. 저녁.", "오래 기다렸어?"]);
    expect(w.current?.text).toBe("아니, 나도 방금 왔어.");
    expect(w.next?.text).toBe("다행이다.");
  });

  it("restart는 같은 범위를 처음부터 다시 시작한다", () => {
    const s = advance(advance(begin(createRehearsal(cfg))));
    const r = restart(s);
    expect(r.index).toBe(1);
    expect(r.status).toBe("ai");
  });

  it("turnOf", () => {
    const s = createRehearsal(cfg);
    expect(turnOf(s, 1)).toBe("ai");
    expect(turnOf(s, 2)).toBe("me");
  });
});
