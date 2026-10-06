import { describe, expect, it } from "./expect";
import { deviceStyles, rankKoreanVoices, type VoiceLike } from "../../src/lib/reading/audio/tts";

const v = (name: string, localService = true, lang = "ko-KR"): VoiceLike => ({ name, lang, localService });

describe("rankKoreanVoices", () => {
  it("한국어가 아닌 음성은 버린다", () => {
    const out = rankKoreanVoices([v("Microsoft Zira", true, "en-US"), v("Microsoft Heami")]);
    expect(out.map((x) => x.name)).toEqual(["Microsoft Heami"]);
  });

  it("lang 표기가 ko_KR 이든 ko 든 한국어로 본다", () => {
    const out = rankKoreanVoices([v("A", true, "ko_KR"), v("B", true, "ko")]);
    expect(out).toHaveLength(2);
  });

  it("Heami 는 다른 한국어 음성이 있으면 뒤로 민다", () => {
    // 이 저장소가 처음 부딪힌 문제 — localService 우선 정렬 때문에 Heami 만 골랐다.
    const out = rankKoreanVoices([v("Microsoft Heami"), v("Google 한국의", false)]);
    expect(out[0].name).toBe("Google 한국의");
  });

  it("Natural/Neural 음성을 가장 앞에 둔다", () => {
    const out = rankKoreanVoices([
      v("Google 한국의", false),
      v("Microsoft SunHi Online (Natural) - Korean", false),
      v("Microsoft Heami"),
    ]);
    expect(out[0].name).toContain("Natural");
    expect(out[1].name).toBe("Google 한국의");
    expect(out[2].name).toBe("Microsoft Heami");
  });

  it("점수가 같으면 기기 안에서 도는 것을 앞에 둔다", () => {
    // 안드로이드처럼 좋은 음성이 로컬에 깔린 경우가 있다. 같은 값이면 오프라인 쪽이 낫다.
    const out = rankKoreanVoices([v("Google 한국의", false), v("Google 한국의", true)]);
    expect(out[0].localService).toBe(true);
  });

  it("고를 것이 없으면 빈 배열", () => {
    expect(rankKoreanVoices([])).toEqual([]);
  });
});

describe("deviceStyles", () => {
  it("배역 순서대로 말투를 주고, 말투 수보다 배역이 많으면 돌려 쓴다", () => {
    const got = deviceStyles(["윤서", "태오", "민재", "역3", "역4", "역5"]);
    expect(Object.values(got).map((x) => x.pitch)).toEqual([1.0, 1.12, 0.9, 1.06, 0.95, 1.0]);
  });

  it("기기 음성 쪽 피치를 극단으로 벌리지 않는다", () => {
    // 포먼트 보정이 없는 엔진에서 피치를 크게 흔들면 기계 소리가 난다.
    const got = deviceStyles(Array.from({ length: 8 }, (_, i) => `역${i}`));
    for (const { pitch } of Object.values(got)) {
      expect(pitch).toBeGreaterThanOrEqual(0.85);
      expect(pitch).toBeLessThanOrEqual(1.2);
    }
  });

  it("배역이 없으면 빈 것을 준다", () => {
    expect(deviceStyles([])).toEqual({});
  });
});
