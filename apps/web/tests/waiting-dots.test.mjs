// practice.coach: 코치 답을 기다리는 동안 대화 끝에 뜨는 점 셋. 화면을 못 보는 배우에게도 기다리는 중임을 알린다.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react } from "./mount-probe.mjs";

const { cleanup, render, screen } = await import("@testing-library/react");
const { WaitingDots } = await import("../src/features/practice/waiting-dots.tsx");

afterEach(cleanup);

test("기다리는 점은 보조기기에 답변을 기다리는 중이라고 읽힌다", () => {
  render(react.createElement(WaitingDots));

  assert.equal(screen.getAllByLabelText("답변을 기다리는 중").length, 1);
});
