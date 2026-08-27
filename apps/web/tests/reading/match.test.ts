import { describe, expect, it } from "./expect";
import { compare, normalizeForMatch, similarity, toJamo } from "../../src/lib/reading/quiz/match";

describe("normalizeForMatch", () => {
  it("괄호 지문·문장부호·공백을 뺀다", () => {
    expect(normalizeForMatch("(웃으며) 아니, 나도 방금 왔어.")).toBe("아니나도방금왔어");
  });
});

describe("toJamo", () => {
  it("한글을 자모로 푼다", () => {
    expect(toJamo("한")).toBe("ㅎㅏㄴ");
    expect(toJamo("가a")).toBe("ㄱㅏa");
  });
});

describe("similarity", () => {
  it("같으면 1, 완전히 다르면 0에 가깝다", () => {
    expect(similarity("달라지지", "달라지지")).toBe(1);
    expect(similarity("달라지지", "고마워")).toBeLessThan(0.4);
  });

  it("종성 오인식·띄어쓰기 차이는 흡수한다", () => {
    expect(similarity("화가 났어요", "화가나써요")).toBeGreaterThan(0.72);
    expect(similarity("삼 년", "3년")).toBeLessThan(1);
  });
});

describe("compare", () => {
  const line = "달라지지. 나는 알잖아, 네가 그거 얼마나 준비했는지.";

  it("거의 맞게 말하면 pass", () => {
    expect(compare("달라지지 나는 알잖아 네가 그거 얼마나 준비했는지", line).pass).toBe(true);
  });

  it("절반만 말하면 pass가 아니다", () => {
    expect(compare("달라지지 나는 알잖아", line).pass).toBe(false);
  });

  it("빈 발화는 pass가 아니다", () => {
    expect(compare("", line).pass).toBe(false);
  });
});
