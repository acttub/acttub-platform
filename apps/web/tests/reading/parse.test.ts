import { describe, expect, it } from "./expect";
import { countLinesByRole, detectRoles, parseScript, type ScriptLine } from "../../src/lib/reading/script/parse";

const dialogues = (lines: ScriptLine[]) =>
  lines.filter((l) => l.type === "dialogue") as Extract<ScriptLine, { type: "dialogue" }>[];

describe("parseScript — 콜론 형식", () => {
  const raw = `지수: 오래 기다렸어?
민준: 아니, 나도 방금 왔어.
지수: 다행이다. (웃으며) 오늘 많이 떨려?
민준: 조금.`;

  it("배역과 대사를 뽑는다", () => {
    const s = parseScript(raw);
    expect(s.roles).toEqual(["지수", "민준"]);
    expect(dialogues(s.lines).map((l) => l.role)).toEqual(["지수", "민준", "지수", "민준"]);
    expect(dialogues(s.lines)[0].text).toBe("오래 기다렸어?");
  });

  it("괄호 지문은 대사 안에 남긴다", () => {
    const s = parseScript(raw);
    expect(dialogues(s.lines)[2].text).toBe("다행이다. (웃으며) 오늘 많이 떨려?");
  });

  it("전각 콜론과 공백 콜론도 받는다", () => {
    const s = parseScript("지수 ： 안녕\n민준 : 응\n지수: 또 봐\n민준: 응");
    expect(s.roles).toEqual(["지수", "민준"]);
    expect(dialogues(s.lines)[1].text).toBe("응");
  });

  it("이름 없는 다음 줄은 앞 대사에 이어 붙는다", () => {
    const s = parseScript("지수: 안녕\n잘 지냈어?\n민준: 응\n지수: 다행\n민준: 응");
    expect(dialogues(s.lines)[0].text).toBe("안녕 잘 지냈어?");
  });
});

describe("parseScript — 블록 형식", () => {
  const raw = `첫 만남

지수
오래 기다렸어?
진짜 오래.

민준
(고개를 저으며) 아니, 나도 방금 왔어.

[암전]

지수
다행이다.

민준
응.`;

  it("이름 한 줄 + 다음 줄 대사를 한 대사로 합친다", () => {
    const s = parseScript(raw);
    expect(s.roles).toEqual(["지수", "민준"]);
    const d = dialogues(s.lines);
    expect(d[0]).toMatchObject({ role: "지수", text: "오래 기다렸어? 진짜 오래." });
    expect(d[1].role).toBe("민준");
    expect(d).toHaveLength(4);
  });

  it("대괄호 한 줄은 지문이다", () => {
    const s = parseScript(raw);
    const dir = s.lines.filter((l) => l.type === "direction");
    expect(dir.some((l) => l.text === "암전")).toBe(true);
  });

  it("배역으로 안 잡힌 첫 줄은 제목 후보다", () => {
    expect(parseScript(raw).title).toBe("첫 만남");
    expect(parseScript(raw).lines[0].type).toBe("dialogue");
  });
});

describe("parseScript — 공백 형식(한국 연극 대본)", () => {
  const raw = `강호 깨진 찻잔. 울리지 않는 자명종 시계.
지혜 탐정님, 도대체 무슨 일로.
강호 별일 아니야.
기태, 어딘가로 뛰쳐나간다.
지혜 어디 가요?`;

  it("이름+공백으로 시작하는 줄을 대사로 잡고, 이름 뒤 쉼표는 지문으로 본다", () => {
    const s = parseScript(raw);
    expect(s.roles).toEqual(["강호", "지혜"]);
    expect(dialogues(s.lines)).toHaveLength(4);
    expect(s.lines.find((l) => l.type === "direction")?.text).toBe("기태, 어딘가로 뛰쳐나간다.");
  });
});

describe("parseScript — 배역 힌트", () => {
  const raw = `엄마: 밥 먹어.\n나: 싫어.\n엄마: 왜.\n나: 그냥.\n동생: 나도 싫어.`;

  it("한 번만 나온 이름은 기본으로 빠지고, 힌트로 주면 배역이 된다", () => {
    expect(parseScript(raw).roles).toEqual(["엄마", "나"]);
    expect(parseScript(raw, { roleHints: ["동생"] }).roles).toEqual(["엄마", "나", "동생"]);
  });

  it("힌트만 쓰면 나머지는 지문이 된다", () => {
    const s = parseScript(`엄마: 밥 먹어.\n나: 싫어.\n주석: 이건 메모.\n주석: 또 메모.`, {
      roleHints: ["엄마", "나"],
      onlyHints: true,
    });
    expect(s.roles).toEqual(["엄마", "나"]);
    expect(s.lines.at(-1)?.type).toBe("direction");
  });

  it("본문에 없는 힌트는 무시한다", () => {
    expect(parseScript(raw, { roleHints: ["아빠"] }).roles).toEqual(["엄마", "나"]);
  });
});

describe("detectRoles", () => {
  it("한 번만 등장하는 이름은 걸러진다", () => {
    const raw = `지수: 안녕\n민준: 안녕\n지수: 잘 가\n민준: 응\n행인: 실례합니다`;
    expect(detectRoles(raw)).toEqual(["지수", "민준"]);
  });

  it("긴 문장은 이름으로 오인하지 않는다", () => {
    const raw = `지수: 안녕\n이건 정말 긴 문장인데 콜론이 있다: 그렇다\n지수: 응`;
    expect(detectRoles(raw)).toEqual(["지수"]);
  });
});

describe("parseScript — 비어 있음", () => {
  it("빈 입력은 빈 결과", () => {
    expect(parseScript("   \n\n")).toEqual({ title: undefined, roles: [], lines: [] });
  });
});

// ─── 실물 대본에서 드러난 것들 ────────────────────────────────────

describe("대괄호로 감싼 배역", () => {
  it("[노라] 대사 형식을 읽는다", () => {
    // 인형의_집.hwp — 8만 자가 통째로 안 읽혔다
    const s = parseScript(`  [노라] 여기 있을 줄 알았어.
  [헬머] 어떻게 알았어.
  [노라] 너 힘들면 항상 높은 데로 가잖아.
  [헬머] 그런가.`);
    expect(s.roles).toEqual(["노라", "헬머"]);
    expect(s.lines.filter((l) => l.type === "dialogue")).toHaveLength(4);
  });

  it("대사 없이 대괄호만 있는 줄은 지문으로 둔다", () => {
    const s = parseScript(`[무대 뒤에서 소리가 난다]
[노라] 여기 있을 줄 알았어.
[노라] 어떻게 알았어.`);
    expect(s.roles).toEqual(["노라"]);
    expect(s.lines[0]).toEqual({ type: "direction", text: "무대 뒤에서 소리가 난다" });
  });
});

describe("문서에서 딸려 온 부스러기", () => {
  it("쪽 표시를 지운다", () => {
    const s = parseScript(`지수: 오래 기다렸어?
- 12 -
[페이지] 002
민준: 아니, 나도 방금 왔어.
지수: 그럼 가자.
민준: 그래.`);
    const texts = s.lines.map((l) => l.text);
    expect(texts.some((t) => t.includes("페이지"))).toBe(false);
    expect(texts.some((t) => /^-\s*12\s*-$/.test(t))).toBe(false);
  });

  it("남은 서식 부호를 지운다", () => {
    // 고래-유진오닐作.hwp 에 <<0>><<것>> 꼴이 섞여 있었다
    const s = parseScript(`지수: 그 <<0>><<것>>의 오른 쪽에 있어.
민준: 알았어.
지수: 빨리.
민준: 응.`);
    expect(s.lines[0].text).toBe("그 것의 오른 쪽에 있어.");
  });
});

describe("배역을 헐겁게 잡지 않는다", () => {
  it("조사나 부사는 배역으로 뽑지 않는다", () => {
    // 꼬리물기 대본에서 로·는·이 가 배역으로 잡혀 145명이 나왔다
    const s = parseScript(`지수: 오래 기다렸어?
민준: 아니, 나도 방금 왔어.
지수: 그럼 가자.
민준: 그래.
로 시작하는 문장이다
로 또 시작한다
는 이렇게도 된다
는 저렇게도 된다`);
    expect(s.roles).toEqual(["지수", "민준"]);
  });

  it("낱글자는 배역으로 뽑지 않는다", () => {
    // 칠수와만수_오종우 에서 [사, 칠, 만, 미, 소] 가 나왔다
    const s = parseScript(`칠수: 오래 기다렸어?
만수: 아니, 나도 방금 왔어.
칠수: 그럼 가자.
만수: 그래.
사 이렇게 낱글자가 앞에 온다
사 또 온다
미 이것도 마찬가지다
미 반복된다`);
    expect(s.roles).toEqual(["칠수", "만수"]);
  });

  it("압도적으로 적게 나오는 이름은 배역으로 세지 않는다", () => {
    // 배역 87명 중 대부분은 긴 대본에 한두 번 걸린 오탐이었다
    const many = Array.from({ length: 400 }, (_, i) => `지수: 대사 ${i}\n민준: 대답 ${i}`).join("\n");
    const s = parseScript(`${many}\n엉뚱: 한 번\n엉뚱: 두 번`);
    expect(s.roles).toEqual(["지수", "민준"]);
  });

  it("대사가 적어도 조연은 남긴다", () => {
    // 두어 줄만 말하는 배역과도 연습할 수 있어야 한다
    const many = Array.from({ length: 20 }, (_, i) => `지수: 대사 ${i}\n민준: 대답 ${i}`).join("\n");
    const s = parseScript(`${many}\n행인: 지나갑니다\n행인: 또 지나갑니다`);
    expect(s.roles).toContain("행인");
  });

  it("배역이 많은 대본은 그대로 살린다", () => {
    // 열두명의성난사람들처럼 진짜로 배역이 많은 대본도 있다
    const lines: string[] = [];
    for (let r = 1; r <= 12; r++) for (let i = 0; i < 5; i++) lines.push(`${r}번: 대사 ${i}`);
    const s = parseScript(lines.join("\n"));
    expect(s.roles).toHaveLength(12);
  });
});

describe("배역처럼 생겼지만 배역이 아닌 것", () => {
  it("쪽 표시가 대괄호 배역으로 둔갑하지 않는다", () => {
    // 황혼녘에 생긴 일.hwp — 한글 파일을 옮기면 [페이지] F01 꼴이 39군데 남는다
    const s = parseScript(`  [페이지] F01
  [작가] 오래 기다렸어?
  [방문객] 아니, 나도 방금 왔어.
  [페이지] 002
  [작가] 그럼 가자.
  [방문객] 그래.`);
    expect(s.roles).toEqual(["작가", "방문객"]);
    expect(s.lines.every((l) => !l.text.includes("F01"))).toBe(true);
  });

  it("장·막 표시는 배역이 아니라 지문이다", () => {
    // 인형의_집.hwp — [장] 제1장 꼴이 31군데 있고 "장"이 배역으로 잡혔다
    const s = parseScript(`  [장] 제1장
  [노라] 오래 기다렸어?
  [헬머] 아니, 나도 방금 왔어.
  [장] 제2장
  [노라] 그럼 가자.
  [헬머] 그래.`);
    expect(s.roles).toEqual(["노라", "헬머"]);
    expect(s.lines.some((l) => l.type === "direction" && l.text === "제1장")).toBe(true);
  });

  it("숫자만 있는 이름은 배역이 아니다", () => {
    // 열두명의성난사람들.pdf 에서 "12"가 배역으로 잡혔다. "2번"은 진짜 배역이다.
    const s = parseScript(`12 이것은 쪽 번호다
12 또 나온다
2번: 오래 기다렸어?
3번: 아니, 나도 방금 왔어.
2번: 그럼 가자.
3번: 그래.`);
    expect(s.roles).toEqual(["2번", "3번"]);
  });
});

describe("배역 직접 고치기", () => {
  const raw = `지수: 오래 기다렸어?
민준: 아니, 나도 방금 왔어.
무대: 조명이 어두워진다
무대: 다시 밝아진다
지수: 그럼 가자.
민준: 그래.`;

  it("뺀 이름은 배역에서 사라지고 그 줄은 지문이 된다", () => {
    const s = parseScript(raw, { excludeRoles: ["무대"] });
    expect(s.roles).toEqual(["지수", "민준"]);
    expect(s.lines.some((l) => l.type === "direction" && l.text.includes("조명이 어두워진다"))).toBe(true);
  });

  it("힌트로 넣어도 뺀 이름은 되살아나지 않는다", () => {
    const s = parseScript(raw, { roleHints: ["무대"], excludeRoles: ["무대"] });
    expect(s.roles).not.toContain("무대");
  });

  it("배역별 대사 줄 수를 센다", () => {
    const s = parseScript(raw);
    const counts = countLinesByRole(s.lines);
    expect(counts.get("지수")).toBe(2);
    expect(counts.get("무대")).toBe(2);
  });
});
