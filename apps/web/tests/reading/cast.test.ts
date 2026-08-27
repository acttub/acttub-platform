import { describe, expect, it } from "./expect";
import { parseScript, type ScriptLine } from "../../src/lib/reading/script/parse";

const dialogues = (lines: ScriptLine[]) => lines.filter((l) => l.type === "dialogue") as Extract<ScriptLine, { type: "dialogue" }>[];

// 희곡 폴더의 실제 대본에서 본 등장인물 표기들이다.

describe("등장인물 목록이 있으면 그 목록이 배역의 기준이다", () => {
  it("목록에 맞는 화자만 배역이고, 안 맞는 화자는 지문이 된다", () => {
    const raw = `봄에는 자살 금지

나오는 사람들

촐레
알리시아
로다 박사
상상 연인

제1막

촐레: 여기가 어디죠?
박사: 요양원입니다.
연인: 조용히 해.
촐레: 네.
박사: 앉으세요.
무대감독: 조명 바꿔.
무대감독: 음악.
연인: 됐어.`;
    const s = parseScript(raw);
    expect(s.roles).toEqual(["촐레", "박사", "연인"]);
    expect(s.lines.some((l) => l.type === "direction" && l.text.startsWith("무대감독"))).toBe(true);
  });

  it("목록 줄 자체는 대사나 지문으로 남지 않는다", () => {
    const raw = `등장인물
키이니 선장
벤 - 선실 급사 소년

벤: 선장님.
키이니: 왜.
벤: 아닙니다.
키이니: 가.`;
    const s = parseScript(raw);
    expect(s.roles).toEqual(["벤", "키이니"]);
    expect(s.lines.every((l) => !l.text.includes("급사"))).toBe(true);
  });

  it("-나오는 사람들- 뒤에 한 줄로 나열한 것도 읽는다 (굿 닥터)", () => {
    const raw = `굿 닥터
-나오는 사람들-

작가 이반 장관 아내 부인 주인 쥴리아

[막] 1막

[작가] 아, 벌써들 오셨군요.
[이반] 네.
[작가] 앉으시죠.
[이반] 고맙습니다.`;
    const s = parseScript(raw);
    expect(s.roles).toEqual(["작가", "이반"]);
  });

  it("번호와 설명이 붙은 목록도 읽는다 (인형의 집)", () => {
    const raw = `[등장 인물]

1. 헬머 ---------------------------------	변호사
2. 노라 ---------------------------------	헬머의 아내
3. 엠미, 봅, 이바르 ------------------------	헬머 부부의 아이들
5. 린데 부인 -----------------------------	노라의 친구

[막] 제1막

노라: 여보.
헬머: 응.
린데부인: 안녕.
엠미: 엄마!
노라: 그래.
헬머: 왔어?`;
    const s = parseScript(raw);
    expect(s.roles).toEqual(["노라", "헬머", "린데부인", "엠미"]);
  });

  it("괄호 별칭과 '이하 X으로 표기'를 알아듣는다", () => {
    const raw = `등장인물

1번 배심원(배심원장)
2번 배심원
자원봉사자 (20대) -이하 자봉으로 표기-
행인 (30대)

배심원장: 시작합시다.
2번: 네.
자봉: 안녕하세요~
행인: 바빠요.
배심원장: 그럼.
자봉: 잠깐만요.`;
    const s = parseScript(raw);
    expect(s.roles).toEqual(["배심원장", "2번", "자봉", "행인"]);
  });

  it("슬래시로 나열한 목록도 읽는다 (우리 읍내)", () => {
    const raw = `등장인물
무대감독 / 깁스 / 웹 부인 / 조오지 깁스

제 1 막
막도 장치도 없다.

무대감독 : 이 연극은 우리 읍내라고 합니다.
웹부인 : 조오지!
조오지 : 네.
무대감독 : 자, 시작합니다.
웹부인 : 어서.
조오지 : 갑니다.`;
    const s = parseScript(raw);
    expect(s.roles).toEqual(["무대감독", "웹부인", "조오지"]);
  });

  it("목록에 없어도 아주 많이 말하는 화자는 배역으로 둔다 (표기가 어긋난 경우)", () => {
    const cast = `등장인물\n키이니 선장\n키이니 처\n\n`;
    const body = Array.from({ length: 20 }, (_, i) => (i % 2 ? `키니: 이봐.` : `부인: 네.`)).join("\n");
    const s = parseScript(cast + body);
    expect(s.roles).toEqual(["부인", "키니"]);
  });

  it("막·장·잠시 같은 말은 목록이 있어도 없어도 배역이 아니다", () => {
    const raw = Array.from({ length: 10 }, (_, i) => `1막: 장면 ${i}\n잠시: 사이\n촐레: 대사 ${i}\n안스: 응 ${i}`).join("\n");
    const s = parseScript(raw);
    expect(s.roles).toEqual(["촐레", "안스"]);
  });
});

describe("이름 안의 정렬용 공백 (칠수와 만수)", () => {
  it("한 글자씩 띄운 이름은 붙여서 읽는다", () => {
    const raw = `총무과장 : 사장님 훈시!
사    장 : 아 - 어험!
칠    수 : 네.
총무과장 : 조용.
사    장 : 그동안 고생 많았어요.
칠    수 : 감사합니다.`;
    const s = parseScript(raw);
    expect(s.roles).toEqual(["총무과장", "사장", "칠수"]);
    expect(dialogues(s.lines)[1]).toMatchObject({ role: "사장", text: "아 - 어험!" });
  });
});
