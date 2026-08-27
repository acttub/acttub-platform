import { describe, expect, it } from "./expect";
import { parseScript } from "../../src/lib/reading/script/parse";

// PDF 에서 뽑은 대본은 줄이 문장 중간에서 끊긴다. 그 조각이 화자처럼 보이면 안 된다.

describe("PDF 조각", () => {
  it("홀로 선 조사·관형사 한 글자는 배역이 아니다", () => {
    const raw = `마르타: 왔어요.
얀: 네.
이
제 갈게요.
을
마르타: 앉아요.
얀: 고맙습니다.
는
제
마르타: 그럼.
얀: 네.`;
    const s = parseScript(raw);
    expect(s.roles).toEqual(["마르타", "얀"]);
  });

  it("조사가 붙은 어절이 홀로 서면 지문이다 — 콜론으로 화자임이 분명하면 예외", () => {
    const raw = `마르타: 왔어요.
그녀는
문을 연다.
얀: 네.
그녀는
돌아선다.
마르타: 앉아요.
얀: 네.
문을
닫는다.`;
    const s = parseScript(raw);
    expect(s.roles).toEqual(["마르타", "얀"]);
  });

  it("이름 일부에 조사가 붙은 것도 지문이다 (안우연 ↔ 우연은)", () => {
    const raw = `안우연: 왔어?
신기루: 응.
우연은
가방을 내려놓는다.
안우연: 앉아.
신기루: 그래.
기루는
웃는다.`;
    const s = parseScript(raw);
    expect(s.roles).toEqual(["안우연", "신기루"]);
  });

  it("목록의 때·곳 항목과 조사 붙은 어절은 별칭이 되지 않는다 (12인의 성난 사람들)", () => {
    const raw = `등장인물
1번 배심원(배심원장)
8번 배심원
경비

재판장의 목소리
때와 곳 - 1957년 여름, 뉴욕 지방법원

뉴욕지방법원
배심원실.
재판장의
목소리가 들린다.
배심원장: 시작합시다.
8번: 무죄요.
경비: 조용히.
배심원장: 그럼.
8번: 네.
재판장: 평결을 내리세요.`;
    const s = parseScript(raw);
    expect(s.roles).toEqual(["배심원장", "8번", "경비", "재판장"]);
  });
});
