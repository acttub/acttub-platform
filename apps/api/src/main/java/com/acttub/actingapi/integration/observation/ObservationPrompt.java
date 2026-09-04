package com.acttub.actingapi.integration.observation;

import java.util.ArrayList;
import java.util.List;

public final class ObservationPrompt {

    /**
     * 관찰만 시키는 지시. <b>코치 프롬프트를 여기 섞지 않는다</b> — 말투·칭찬 금지·문장 수
     * 같은 대화용 지시가 들어 있으면 JSON 배열을 뽑는 모델이 상충하는 요구를 받는다
     * (SOMA-490 이전에는 이 파일이 코치 지시를 그대로 이어 붙이고 있었다).
     */
    public static final String SYSTEM = """
            너는 배우의 연기 영상을 보고, 확인 가능한 사실을 JSON 으로 적는다.
            여기서 나온 것이 이후 코칭 대화의 유일한 영상 근거다 — 코치는 영상을 보지 못하고
            이 JSON 만 받는다. 그러므로 <b>본 것을 빠짐없이, 구체적으로</b> 적는다.

            ## scene_summary

            장면 전체가 무슨 이야기인지 3~5문장으로 적는다. 인물이 어떤 상황에 있고, 상대와
            무엇을 주고받으며, 말과 행동이 어떻게 이어지는지. 잘잘못은 쓰지 않는다.

            ## observations

            구간마다 무엇이 보이고 들렸는지 적는다.

            - start_ms · end_ms: 그 구간의 시각. 영상 길이 안에서만 쓴다.
            - what: 그 구간에서 확인된 것. 최대 1000자까지 쓸 수 있으니 아끼지 말고 구체적으로
              적는다. 대사의 발음·속도·높낮이·끊기는 지점, 시선이 옮겨간 곳, 손과 몸의 움직임,
              상대의 말을 받기까지의 간격 — 확인된 것을 그대로.
            - quote: 그 구간에서 실제로 들린 대사 원문. 안 들렸으면 빈 문자열.
            - dimension: 대사·목소리·호흡·리듬·시선·표정·움직임 중 해당하는 축을 쉼표로.
            - confidence: 그 관찰을 얼마나 확신하는지 0.0~1.0.

            ## 지키는 것

            - 본 것만 쓴다. 사람이 안 보이면 안 보인다고 하고, 얼굴이 안 잡히면 표정을 쓰지
              않는다. 소리가 없으면 말·호흡을 쓰지 않는다. 빈칸을 채우려고 그럴듯한 몸짓·시선·
              표정을 지어내지 않는다.
            - 확인되지 않은 것은 관찰이 아니라 uncertainties 에 적는다.
            - 해석하지 않는다. "감정을 준비하는 것 같다", "몰입이 부족하다" 는 관찰이 아니다.
              보이는 것을 적으면 해석은 코치와 배우가 한다.
            - 판정하지 않는다. 점수·등급·심각도·합격 가능성·"약화"·"부족" 같은 말을 쓰지 않는다.
            - 배우의 성격·가족관계·정신상태를 추측하지 않는다.
            - 수치를 지어내지 않는다("시선 각도 0도", "데시벨"). 순간은 시각과 대사로 가리킨다.

            ## 개수

            확인된 만큼 적는다. 15개를 넘기지 않는다.
            볼 것이 정말 없으면 빈 배열을 내되, 그때는 왜 볼 수 없었는지를 uncertainties 에
            반드시 남긴다.""";

    /**
     * Scene Context 가 통째로 빈 세션에 넣는 줄. {@code CoachPrompt} 는 같은 조건에 한 줄
     * 대신 장면 맥락 미입력 블록을 붙이고, 두 프롬프트는 각자 진화하므로 문구를 공유하지
     * 않는다 — 한쪽만 고칠 때 다른 쪽이 조용히 따라가지 않게 하는 편이 낫다.
     */
    private static final String SCENE_ABSENT =
            "- 배우가 장면을 적지 않았다. 장면 맥락을 지어내지 마라.";

    private ObservationPrompt() {
    }

    /**
     * 배우가 쓴 것을 프롬프트에 넣는다.
     *
     * <p><b>빈 칸은 줄 자체를 만들지 않는다</b> — 빈 제목만 남기면 모델이 그 자리를 지어내
     * 채운다(ADR-021). Scene Context 셋이 <b>모두</b> 비면 부재를 한 줄로 명시하고, 일부만
     * 비면 그 줄만 빼고 부재를 말하지 않는다 — 적은 것이 있기 때문이다.
     */
    public static String build(ActorMaterial actor) {
        List<String> lines = new ArrayList<>();
        lines.add("배우가 쓴 것과 영상을 함께 확인한다.");
        lines.add("");
        if (blank(actor.situation()) && blank(actor.character()) && blank(actor.goal())) {
            lines.add(SCENE_ABSENT);
        } else {
            addField(lines, "상황", actor.situation());
            addField(lines, "캐릭터", actor.character());
            addField(lines, "이번 테이크의 목적", actor.goal());
        }
        lines.add("- 배우가 고른 막히는 지점: " + actor.blockageKind());
        addField(lines, "배우가 쓴 상세", actor.blockageDetail());
        lines.add("");
        lines.add("영상에 실제로 확인되는 사실만 observations 에 쓴다. 확인할 사람이 없거나 신체·얼굴·소리가 보이지 않으면 그 범주의 관찰을 만들지 않는다.");
        lines.add("대사가 들리면 quote 에 그대로 옮긴다 — 나중에 순간을 가리킬 때 시각 대신 대사를 쓴다.");
        return String.join("\n", lines);
    }

    private static void addField(List<String> lines, String label, String value) {
        if (!blank(value)) {
            lines.add("- " + label + ": " + value);
        }
    }

    /**
     * 웹이 {@code .trim()} 해 보내지만 서버가 그 보장에 기대지 않는다. null 을 보지 않는
     * 것은 {@link ActorMaterial} 컴팩트 생성자가 다섯 칸을 전부 {@code requireNonNull}
     * 하기 때문이다.
     */
    private static boolean blank(String value) {
        return value.isBlank();
    }
}
