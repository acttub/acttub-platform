// 진행률 훅. 앞부분은 전이표를 순수 함수로 보고, 뒷부분은 jsdom 위에서 실제로 렌더해
// 타이머가 언제 걸리고 언제 정리되는지를 본다 — 소스 문자열 정규식이 닿지 못하던 자리다.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import "./ts-module-loader.mjs";
import { window } from "./dom-setup.mjs";

const {
  ANALYSIS_TICK_MS,
  INITIAL_ANALYSIS_PROGRESS,
  analysisProgressReducer,
} = await import("../src/features/practice/use-analysis-progress.ts");
const {
  ANALYSIS_DEADLINE_MS,
  UPLOAD_ONLY_PROGRESS_END,
  UPLOAD_PROGRESS_END,
  compressionProgress,
} = await import("../src/features/practice/analysis-progress.ts");

const AT = 1_700_000_000_000;
const reduce = (state, event, now = AT) =>
  analysisProgressReducer(state, event, now);

// 여러 이벤트를 순서대로 흘려 넣는다. now 를 안 주면 전부 같은 시각으로 본다.
function play(events, start = INITIAL_ANALYSIS_PROGRESS) {
  return events.reduce(
    (state, [event, now]) => reduce(state, event, now ?? AT),
    start,
  );
}

test("reset 은 부분 리셋을 표현할 수 없다 — 여섯 칸이 한 번에 처음으로 돌아간다", () => {
  const dirty = play([
    [{ type: "compress", ratio: 1 }],
    [{ type: "upload", percent: 100, compressed: true }],
    [{ type: "duration", videoDurationMs: 47_000 }],
    [{ type: "analyze", compressed: true }],
    [{ type: "tick" }, AT + 30_000],
  ]);
  assert.ok(dirty.pct > 90);
  assert.equal(dirty.videoDurationMs, 47_000);
  assert.ok(dirty.elapsedMs > 0);

  assert.deepEqual(reduce(dirty, { type: "reset" }), INITIAL_ANALYSIS_PROGRESS);
});

test("압축·업로드·분석을 거치는 동안 pct 는 한 번도 뒤로 가지 않는다", () => {
  const events = [
    [{ type: "compress", ratio: 0.3 }],
    [{ type: "compress", ratio: 0.9 }],
    [{ type: "compress", ratio: 1 }],
    [{ type: "upload", percent: 20, compressed: true }],
    [{ type: "upload", percent: 100, compressed: true }],
    [{ type: "analyze", compressed: true }],
    [{ type: "tick" }, AT + 5_000],
    [{ type: "tick" }, AT + 40_000],
    [{ type: "tick" }, AT + 200_000],
  ];

  let state = INITIAL_ANALYSIS_PROGRESS;
  for (const [event, now] of events) {
    const next = reduce(state, event, now ?? AT);
    assert.ok(next.pct >= state.pct, `${event.type} 에서 ${state.pct} → ${next.pct}`);
    state = next;
  }
  assert.ok(state.pct > UPLOAD_PROGRESS_END);
  assert.ok(state.pct < 100);
});

test("늦게 도착한 업로드 진행률이 이미 지나간 분석 구간을 끌어내리지 않는다", () => {
  const analyzing = play([
    [{ type: "upload", percent: 100, compressed: true }],
    [{ type: "analyze", compressed: true }],
    [{ type: "tick" }, AT + 20_000],
  ]);
  const late = reduce(analyzing, { type: "upload", percent: 40, compressed: true });
  assert.equal(late.pct, analyzing.pct);
});

test("analyze 는 압축을 탔는지로 분석 구간 시작점을 가른다", () => {
  const compressed = reduce(
    INITIAL_ANALYSIS_PROGRESS,
    { type: "analyze", compressed: true },
  );
  const plain = reduce(
    INITIAL_ANALYSIS_PROGRESS,
    { type: "analyze", compressed: false },
  );

  assert.equal(compressed.pct, UPLOAD_PROGRESS_END);
  assert.equal(compressed.startPct, UPLOAD_PROGRESS_END);
  assert.equal(plain.pct, UPLOAD_ONLY_PROGRESS_END);
  assert.equal(plain.startPct, UPLOAD_ONLY_PROGRESS_END);
  assert.equal(compressed.startedAt, AT);
  assert.equal(compressed.waiting, true);
});

test("analyze 는 이미 찬 막대를 되감지 않는다 — 압축이 앞 구간을 채워 뒀다", () => {
  const afterCompress = reduce(
    INITIAL_ANALYSIS_PROGRESS,
    { type: "compress", ratio: 1 },
  );
  const analyzing = reduce(
    afterCompress,
    { type: "analyze", compressed: false },
  );

  assert.equal(afterCompress.pct, compressionProgress(1));
  assert.equal(analyzing.pct, afterCompress.pct);
  assert.equal(analyzing.startPct, UPLOAD_ONLY_PROGRESS_END);
});

test("settle 은 analyzed 에서만 100 이 되고 어느 쪽이든 타이머를 멈춘다", () => {
  const analyzing = play([
    [{ type: "analyze", compressed: true }],
    [{ type: "tick" }, AT + 20_000],
  ]);

  const analyzed = reduce(analyzing, { type: "settle", status: "analyzed" });
  const failed = reduce(analyzing, { type: "settle", status: "failed" });

  assert.equal(analyzed.pct, 100);
  assert.equal(analyzed.waiting, false);
  assert.equal(failed.pct, analyzing.pct);
  assert.equal(failed.waiting, false);
});

test("멈춘 뒤 늦게 도착한 tick 은 상태를 그대로 둔다", () => {
  const settled = play([
    [{ type: "analyze", compressed: true }],
    [{ type: "tick" }, AT + 20_000],
    [{ type: "settle", status: "failed" }],
  ]);

  const late = reduce(settled, { type: "tick" }, AT + 300_000);
  assert.equal(late, settled, "같은 상태 객체를 그대로 돌려줘야 다시 렌더하지 않는다");
});

test("영상 길이는 분석이 시작된 뒤에 알게 돼도 그때부터 곡선에 반영된다", () => {
  // 목록에서 연 세션은 길이를 모르는 채로 분석 구간에 들어가고, 화면의 <video> 가
  // 메타데이터를 읽은 뒤에야 알려 준다. 그 전에는 기본 채움 기간으로 움직인다.
  const blind = play([
    [{ type: "analyze", compressed: false }],
    [{ type: "tick" }, AT + 10_000],
  ]);
  assert.equal(blind.videoDurationMs, null);

  const informed = play(
    [
      [{ type: "duration", videoDurationMs: 300_000 }],
      [{ type: "tick" }, AT + 10_000],
    ],
    reduce(INITIAL_ANALYSIS_PROGRESS, { type: "analyze", compressed: false }),
  );

  // 5분짜리 영상은 같은 10초에 훨씬 덜 차야 한다 — 길이를 안 쓰면 둘이 같아진다.
  assert.equal(informed.videoDurationMs, 300_000);
  assert.ok(informed.pct < blind.pct);
});

test("목록에서 연 세션은 상태마다 지금 화면과 같은 자리에서 시작한다", () => {
  const restore = (status) => {
    const opened = play([
      [{ type: "reset" }],
      [{ type: "analyze", compressed: false }],
    ]);
    return status === "created" || status === "analyzing"
      ? opened
      : reduce(opened, { type: "settle", status });
  };

  assert.equal(restore("created").pct, UPLOAD_ONLY_PROGRESS_END);
  assert.equal(restore("created").waiting, true);
  assert.equal(restore("analyzing").pct, UPLOAD_ONLY_PROGRESS_END);
  assert.equal(restore("failed").pct, UPLOAD_ONLY_PROGRESS_END);
  assert.equal(restore("failed").waiting, false);
  assert.equal(restore("analyzed").pct, 100);
  assert.equal(restore("analyzed").waiting, false);
});

test("경과 시간은 analyze 시각부터 재고 목표 시간을 넘기면 pastDeadline 이 선다", () => {
  const started = reduce(
    INITIAL_ANALYSIS_PROGRESS,
    { type: "analyze", compressed: true },
  );

  const onTime = reduce(started, { type: "tick" }, AT + ANALYSIS_DEADLINE_MS);
  const late = reduce(started, { type: "tick" }, AT + ANALYSIS_DEADLINE_MS + 1_000);

  assert.equal(onTime.elapsedMs, ANALYSIS_DEADLINE_MS);
  assert.equal(late.elapsedMs, ANALYSIS_DEADLINE_MS + 1_000);
});

// ── 여기부터는 실제로 렌더한다 ────────────────────────────────────────────────

let react;
let createRoot;
let Probe;
let clock;
let container;
let root;

function installClock() {
  const realSetInterval = window.setInterval;
  const realClearInterval = window.clearInterval;
  const realNow = Date.now;
  const timers = new Map();
  let nextId = 1;
  let now = AT;

  window.setInterval = (fn, ms) => {
    const id = nextId;
    nextId += 1;
    timers.set(id, { fn, ms });
    return id;
  };
  window.clearInterval = (id) => {
    timers.delete(id);
  };
  Date.now = () => now;

  return {
    timers,
    get count() {
      return timers.size;
    },
    advance(ms) {
      now += ms;
    },
    fire() {
      for (const timer of [...timers.values()]) timer.fn();
    },
    restore() {
      window.setInterval = realSetInterval;
      window.clearInterval = realClearInterval;
      Date.now = realNow;
    },
  };
}

before(async () => {
  react = await import("react");
  ({ createRoot } = await import("react-dom/client"));
  // "@/" 별칭과 .tsx 트랜스파일을 한 번에 지나간다 — 둘 중 하나라도 안 되면 여기서 죽는다.
  ({ AnalysisProgressProbe: Probe } = await import(
    "./fixtures/analysis-progress-probe.tsx"
  ));
  clock = installClock();
});

after(() => {
  clock?.restore();
});

// 훅을 붙인 컴포넌트를 띄우고, 마지막 렌더에서 본 값과 조작 손잡이를 돌려준다.
function mountProbe() {
  container = window.document.createElement("div");
  window.document.body.append(container);
  root = createRoot(container);
  const seen = [];
  react.act(() => {
    root.render(react.createElement(Probe, { onRender: (value) => seen.push(value) }));
  });
  return {
    get latest() {
      return seen.at(-1);
    },
    get renders() {
      return seen.length;
    },
    text: () => container.textContent,
    report: (event) => react.act(() => seen.at(-1).report(event)),
    unmount: () => {
      react.act(() => root.unmount());
      container.remove();
    },
  };
}

test("분석에 들어가기 전에는 1초 타이머가 걸리지 않는다", () => {
  const probe = mountProbe();
  try {
    assert.equal(clock.count, 0);
    probe.report({ type: "compress", ratio: 0.5 });
    assert.equal(clock.count, 0);
    probe.report({ type: "upload", percent: 50, compressed: true });
    assert.equal(clock.count, 0);
  } finally {
    probe.unmount();
  }
});

test("분석에 들어가면 1초 타이머가 딱 하나 걸리고 막대가 화면에서 움직인다", () => {
  const probe = mountProbe();
  try {
    probe.report({ type: "analyze", compressed: true });
    assert.equal(clock.count, 1);
    const [id] = [...clock.timers.keys()];
    assert.equal(clock.timers.get(id).ms, ANALYSIS_TICK_MS);
    assert.equal(probe.text(), String(UPLOAD_PROGRESS_END));

    clock.advance(10_000);
    react.act(() => clock.fire());
    assert.ok(probe.latest.pct > UPLOAD_PROGRESS_END);
    assert.equal(probe.text(), String(Math.round(probe.latest.pct)));

    // 틱이 만든 상태 변화가 effect 를 다시 돌리면 안 된다. 다시 돌면 1초를 처음부터
    // 세어 주기가 밀리고, 화면은 "가끔 멈칫하는 막대"가 된다.
    clock.advance(10_000);
    react.act(() => clock.fire());
    assert.equal(clock.count, 1);
    assert.deepEqual([...clock.timers.keys()], [id], "같은 타이머가 그대로 살아 있어야 한다");
  } finally {
    probe.unmount();
  }
});

test("목표 시간을 넘기면 pastDeadline 이 서고 그 전에는 서지 않는다", () => {
  const probe = mountProbe();
  try {
    probe.report({ type: "analyze", compressed: true });
    clock.advance(ANALYSIS_DEADLINE_MS);
    react.act(() => clock.fire());
    assert.equal(probe.latest.pastDeadline, false);

    clock.advance(2_000);
    react.act(() => clock.fire());
    assert.equal(probe.latest.pastDeadline, true);
  } finally {
    probe.unmount();
  }
});

test("settle 이 오면 타이머를 걷어내고 더 이상 막대가 움직이지 않는다", () => {
  const probe = mountProbe();
  try {
    probe.report({ type: "analyze", compressed: true });
    clock.advance(20_000);
    react.act(() => clock.fire());

    probe.report({ type: "settle", status: "failed" });
    assert.equal(clock.count, 0);

    const frozen = probe.latest.pct;
    clock.advance(120_000);
    react.act(() => clock.fire());
    assert.equal(probe.latest.pct, frozen);
  } finally {
    probe.unmount();
  }
});

test("reset 이 오면 타이머를 걷어내고 막대를 0 으로 되돌린다", () => {
  const probe = mountProbe();
  try {
    probe.report({ type: "analyze", compressed: true });
    assert.equal(clock.count, 1);

    probe.report({ type: "reset" });
    assert.equal(clock.count, 0);
    assert.equal(probe.latest.pct, 0);
    assert.equal(probe.text(), "0");
  } finally {
    probe.unmount();
  }
});

test("화면을 떠나면 타이머가 남지 않는다", () => {
  const probe = mountProbe();
  probe.report({ type: "analyze", compressed: true });
  assert.equal(clock.count, 1);

  probe.unmount();

  assert.equal(clock.count, 0);
});
