import { describe, expect, it } from "./expect";
import { redirectFor, STEP_PATH } from "../../src/lib/reading/step";

const s = (o: Partial<{ hasDraft: boolean; hasScript: boolean; hasSession: boolean; hasStats: boolean; desktop: boolean }> = {}) => ({
  hasDraft: false,
  hasScript: false,
  hasSession: false,
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

  it("확인 화면은 저장 전 초안이 있어야 열린다 — 저장된 대본만 있으면 대본 넣기로", () => {
    expect(redirectFor("script", s({ hasDraft: true }))).toBe(null);
    expect(redirectFor("script", s({ hasScript: true }))).toBe(STEP_PATH.input);
  });

  it("회차가 없으면 리딩·완료는 배역 정하기로", () => {
    expect(redirectFor("run", s({ hasScript: true }))).toBe(STEP_PATH.setup);
    expect(redirectFor("done", s({ hasScript: true }))).toBe(STEP_PATH.setup);
  });

  it("결과가 없으면 완료는 리딩으로", () => {
    expect(redirectFor("done", s({ hasScript: true, hasSession: true }))).toBe(STEP_PATH.run);
    expect(redirectFor("done", s({ hasScript: true, hasSession: true, hasStats: true }))).toBe(null);
  });

  it("데스크톱에는 대본 확인 페이지가 없다 — 초안이 있어도 대본 넣기로", () => {
    expect(redirectFor("script", s({ hasDraft: true, desktop: true }))).toBe(STEP_PATH.input);
    expect(redirectFor("script", s({ hasDraft: true }))).toBe(null);
  });
});

describe("대본 상세 경로", () => {
  it("상세 경로는 /reading/scripts/<id> 이고 경로에서 id 하나만 읽는다", async () => {
    const { scriptDetailPath, scriptIdFromPath } = await import("../../src/lib/reading/step");
    expect(scriptDetailPath("abc")).toBe("/reading/scripts/abc");
    expect(scriptIdFromPath("/reading/scripts/abc")).toBe("abc");
    expect(scriptIdFromPath("/reading/scripts/abc/")).toBe("abc");
    expect(scriptIdFromPath("/reading/scripts")).toBe(null);
    expect(scriptIdFromPath("/reading/scripts/a/b")).toBe(null);
    expect(scriptIdFromPath("/reading/scripts/%E0%A4%A")).toBe(null);
  });
});
