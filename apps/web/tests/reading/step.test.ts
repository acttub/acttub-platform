import { describe, expect, it } from "./expect";
import { afterInput, redirectFor, STEP_PATH } from "../../src/lib/reading/step";

const s = (o: Partial<{ hasScript: boolean; hasSetup: boolean; hasStats: boolean; desktop: boolean }> = {}) => ({
  hasScript: false,
  hasSetup: false,
  hasStats: false,
  desktop: false,
  ...o,
});

describe("단계 가드 — 앞 단계 데이터가 없으면 앞 페이지로", () => {
  it("대본 넣기는 늘 열린다", () => {
    expect(redirectFor("input", s())).toBe(null);
  });

  it("대본이 없으면 어디서든 대본 넣기로", () => {
    expect(redirectFor("script", s())).toBe(STEP_PATH.input);
    expect(redirectFor("setup", s())).toBe(STEP_PATH.input);
    expect(redirectFor("run", s())).toBe(STEP_PATH.input);
    expect(redirectFor("done", s())).toBe(STEP_PATH.input);
  });

  it("설정이 없으면 리딩·완료는 배역 정하기로", () => {
    expect(redirectFor("run", s({ hasScript: true }))).toBe(STEP_PATH.setup);
    expect(redirectFor("done", s({ hasScript: true }))).toBe(STEP_PATH.setup);
  });

  it("결과가 없으면 완료는 리딩으로", () => {
    expect(redirectFor("done", s({ hasScript: true, hasSetup: true }))).toBe(STEP_PATH.run);
    expect(redirectFor("done", s({ hasScript: true, hasSetup: true, hasStats: true }))).toBe(null);
  });

  it("데스크톱에는 대본 확인 페이지가 없다 — 배역 정하기로", () => {
    expect(redirectFor("script", s({ hasScript: true, desktop: true }))).toBe(STEP_PATH.setup);
    expect(redirectFor("script", s({ hasScript: true }))).toBe(null);
  });

  it("대본을 넣은 다음: 폰은 확인, 데스크톱은 배역 정하기", () => {
    expect(afterInput(false)).toBe(STEP_PATH.script);
    expect(afterInput(true)).toBe(STEP_PATH.setup);
  });
});
