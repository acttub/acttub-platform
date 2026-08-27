import { describe, expect, it } from "./expect";
import { parseScript } from "../../src/lib/reading/script/parse";

// 함수 도미노 — 목록 항목에 성별·설명이 붙고 설명이 마침표로 끝난다. 목록이 거기서 끊기면 안 된다.

describe("설명이 긴 등장인물 목록", () => {
  it("이름(남) 설명. 꼴은 마침표로 끝나도 목록 항목이다", () => {
    const raw = `등장인물

마카베 가오루(남) 목격자, 무직

사몬 모리오(남) 목격자, 입시학원 인기 강사, 취미로 소설을 쓴다.

도로 히로미쓰(남) 목격자, HIV 보균자

닛타 나오키(남) 사고 당시 운전자

마카베 어디 있었죠?
도로 육교 위에요.
모리오 봤어요?
도로 네, 봤어요.
마카베 그럼.
닛타 저는 몰라요.
모리오 정말요?
닛타 네.`;
    const s = parseScript(raw);
    expect(s.roles).toEqual(["마카베", "도로", "모리오", "닛타"]);
  });

  it("목록이 없어도 조사 글자로 끝나는 이름이 대사를 많이 하면 배역이다", () => {
    const body = Array.from({ length: 10 }, (_, i) => `도로 대사 ${i}\n마카베 응 ${i}`).join("\n");
    const s = parseScript(body);
    expect(s.roles).toEqual(["도로", "마카베"]);
  });
});
