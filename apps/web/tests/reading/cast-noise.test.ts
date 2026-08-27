import { describe, expect, it } from "./expect";
import { parseScript } from "../../src/lib/reading/script/parse";

// 실물 대본에서 배역으로 잘못 잡힌 것들 — 조사 붙은 이름, 숫자만, 설명 어절과 앞이 겹치는 말.

describe("배역처럼 보이지만 지문인 것", () => {
  it("이름에 조사가 붙은 것은 지문의 첫 어절이다 (목록 있음)", () => {
    const raw = `등장인물
촐레
경비

촐레: 여기가 어디죠?
경비: 조용히.
촐레가
무대 가운데로 걸어 나온다.
경비가
문을 닫는다.
촐레: 네.
경비: 앉아.`;
    const s = parseScript(raw);
    expect(s.roles).toEqual(["촐레", "경비"]);
    expect(s.lines.some((l) => l.type === "direction" && l.text.includes("걸어 나온다"))).toBe(true);
  });

  it("목록이 없어도 조사 붙은 변형은 배역이 아니다", () => {
    const raw = `마카베: 갈까.
모리오: 응.
마카베는
천천히 걷는다.
마카베: 늦었어.
모리오: 그래.
마카베는
멈춰 선다.`;
    const s = parseScript(raw);
    expect(s.roles).toEqual(["마카베", "모리오"]);
  });

  it("숫자만인 이름은 배역이 아니다", () => {
    const raw = `12: 배심원실
8번: 무죄요.
3번: 유죄.
8번: 왜요.
3번: 그냥.
12: 오후`;
    const s = parseScript(raw);
    expect(s.roles).toEqual(["8번", "3번"]);
  });

  it("목록의 설명 어절과 앞만 겹치는 긴 말은 배역이 아니다", () => {
    const raw = `등장인물
경비 - 뉴욕 지방법원 소속
8번 배심원

뉴욕지방법원: 배심원실.
뉴욕지방법원: 오후 세 시.
뉴욕지방법원: 무덥다.
8번: 무죄요.
경비: 들어가세요.
8번: 네.`;
    const s = parseScript(raw);
    expect(s.roles).toEqual(["8번", "경비"]);
  });

  it("목록과 앞뒤가 겹치는 표기는 두 줄은 말해야 배역이다", () => {
    const raw = `등장인물
자원봉사자 -이하 자봉으로 표기-
행인

자원
봉사자가 지나가는 사람에게 말을 건다.
자봉: 안녕하세요.
행인: 바빠요.
자봉: 잠깐만요.
행인: 됐어요.`;
    const s = parseScript(raw);
    expect(s.roles).toEqual(["자봉", "행인"]);
  });
});
