package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import com.acttub.actingapi.feature.reading.domain.SplitResponse.Kind;
import com.acttub.actingapi.feature.reading.domain.SplitResponse.Row;
import org.junit.jupiter.api.Test;

class RuleSplitTest {

    private static RuleSplit.Result split(String raw) {
        return RuleSplit.of(NumberedLine.of(raw));
    }

    private static Row row(RuleSplit.Result result, int no) {
        return result.rows().get(no);
    }

    @Test
    void colonHeadsBecomeDialogueOfThatSpeaker() {
        RuleSplit.Result result = split("""
                지호: 다녀왔습니다.
                어머니: 밥은.
                지호: 먹었어요.
                어머니: 어디서.""");

        assertThat(result.roster()).containsExactly("지호", "어머니");
        assertThat(row(result, 1)).isEqualTo(new Row(1, Kind.DIALOGUE, "지호", "지호: "));
        assertThat(row(result, 2).speaker()).isEqualTo("어머니");
        assertThat(result.format()).isEqualTo(RuleSplit.Format.COLON);
        assertThat(result.confident()).isTrue();
    }

    @Test
    void aColonNameSeenOnceAtTheTopIsTheTitleNotASpeaker() {
        RuleSplit.Result result = split("""
                독백: 문 앞에서

                서진: 열쇠는 맞는데 손이 안 움직여.
                서진: 이 문 뒤에 뭐가 있는지 아니까.
                서진: 아니, 뭐가 없는지 아니까.""");

        assertThat(row(result, 1).kind()).isEqualTo(Kind.TITLE);
        assertThat(result.roster()).containsExactly("서진");
    }

    @Test
    void blockNameLinesAreIgnoredAndTheFollowingLinesBelongToThatName() {
        RuleSplit.Result result = split("""
                수아
                (가방을 내려놓으며)
                아직 안 갔네.

                도윤
                갈 데가 없어서.
                그냥 여기가 제일 편해.

                수아
                너 집 있잖아.

                도윤
                없어.""");

        assertThat(row(result, 1).kind()).isEqualTo(Kind.IGNORE);
        assertThat(row(result, 2).kind()).isEqualTo(Kind.DIRECTION);
        assertThat(row(result, 3)).isEqualTo(new Row(3, Kind.DIALOGUE, "수아", ""));
        assertThat(row(result, 6).speaker()).isEqualTo("도윤");
        assertThat(row(result, 7).speaker()).isEqualTo("도윤");
        assertThat(result.format()).isEqualTo(RuleSplit.Format.BLOCK);
    }

    @Test
    void castListNamesAllowNameSpaceHeads() {
        RuleSplit.Result result = split("""
                마지막 버스

                나오는 사람들
                윤기 --- 서른둘, 버스 기사
                세라 --- 스물아홉, 마지막 승객

                윤기 종점입니다. 내리셔야 해요.
                세라 (아이를 보며) 조금만요.
                윤기 저도 퇴근해야 하는데.""");

        assertThat(row(result, 3).kind()).isEqualTo(Kind.CAST);
        assertThat(row(result, 4).kind()).isEqualTo(Kind.CAST);
        assertThat(row(result, 7)).isEqualTo(new Row(7, Kind.DIALOGUE, "윤기", "윤기 "));
        assertThat(row(result, 8).speaker()).isEqualTo("세라");
        assertThat(result.roster()).containsExactly("윤기", "세라");
    }

    @Test
    void inlineCastListGivesNames() {
        RuleSplit.Result result = split("""
                등장인물: 하람, 보라

                하람
                안녕.

                보라
                응.""");

        assertThat(row(result, 1).kind()).isEqualTo(Kind.CAST);
        assertThat(result.roster()).containsExactly("하람", "보라");
    }

    @Test
    void upperCaseNamesWithAPeriod() {
        RuleSplit.Result result = split("""
                MARA. You came back.
                JONAH. I never left.
                MARA. For three hours?""");

        assertThat(row(result, 1)).isEqualTo(new Row(1, Kind.DIALOGUE, "MARA", "MARA. "));
        assertThat(result.roster()).containsExactly("MARA", "JONAH");
    }

    @Test
    void pageNumbersAndRepeatedHeadersAreIgnored() {
        RuleSplit.Result result = split("""
                두 번째 대본 - 2026 공연용
                - 1 -
                준: 오늘도 늦었네.
                리아: 버스를 놓쳤어.
                두 번째 대본 - 2026 공연용
                - 2 -
                준: 어디부터.""");

        assertThat(row(result, 1).kind()).isEqualTo(Kind.TITLE);
        assertThat(row(result, 2).kind()).isEqualTo(Kind.IGNORE);
        assertThat(row(result, 5).kind()).isEqualTo(Kind.IGNORE);
        assertThat(row(result, 6).kind()).isEqualTo(Kind.IGNORE);
    }

    @Test
    void sceneHeadsAndSeparatedDirections() {
        RuleSplit.Result result = split("""
                제1장 부엌

                식탁 위에 식은 국.

                지호: 다녀왔습니다.
                어머니: 밥은.
                지호: 먹었어요.""");

        assertThat(row(result, 1).kind()).isEqualTo(Kind.SCENE);
        assertThat(row(result, 3).kind()).isEqualTo(Kind.DIRECTION);
    }

    @Test
    void aSpeakerWhoTalksOnceIsKeptWhenColonHeadsDominate() {
        RuleSplit.Result result = split("""
                준: 오늘도 늦었네.
                리아: 버스를 놓쳤어.
                준: 또?
                준: 내일은 내가 깨워 줄까.""");

        assertThat(result.roster()).containsExactly("준", "리아");
    }

    @Test
    void aHeadlessLineRightAfterDialogueIsLeftForTheModel() {
        RuleSplit.Result result = split("""
                지호: 다녀왔습니다.
                어머니가 수도를 잠근다.
                어머니: 앉아.
                지호: 피곤해서요.""");

        assertThat(result.rows()).doesNotContainKey(2);
        assertThat(result.rows()).containsKeys(1, 3, 4);
    }

    @Test
    void invisibleCharactersDoNotHideHeads() {
        RuleSplit.Result result = split("​하은: 오빠.\n​민재: 왜.\n​하은: 그냥.\n​");

        assertThat(result.roster()).containsExactly("하은", "민재");
        assertThat(row(result, 4).kind()).isEqualTo(Kind.IGNORE);
    }

    @Test
    void hangulFillerLinesAreBlankAndEndABlock() {
        // 한글 채움 문자(U+FFA0)만 있는 줄은 빈 줄이다 — 블록이 거기서 끝나고 뒤 줄은 지문이다
        RuleSplit.Result result = split("수아\n아직 안 갔네.\nﾠ\n도윤\n갈 데가 없어서.\nﾠ\n수아\n너 집 있잖아.\nﾠ\n도윤\n없어.\nﾠ\n형광등이 꺼진다.");

        assertThat(row(result, 3).kind()).isEqualTo(Kind.IGNORE);
        assertThat(row(result, 2).speaker()).isEqualTo("수아");
        assertThat(row(result, 13).kind()).isEqualTo(Kind.DIRECTION);
    }

    @Test
    void aRepeatedPageHeaderIsNotABlockName() {
        RuleSplit.Result result = split("""
                연습실의 밤
                - 1 -
                민수: 안녕.
                영희: 응.
                민수: 가자.

                연습실의 밤
                - 2 -
                영희: 어디로.
                민수: 몰라.""");

        assertThat(result.roster()).containsExactly("민수", "영희");
        assertThat(row(result, 7).kind()).isEqualTo(Kind.IGNORE);
    }

    @Test
    void spaceHeadsWithoutACastListNeedTwoFrequentNames() {
        RuleSplit.Result result = split("""
                윤서 왜?
                미정 그냥.
                윤서 말해 봐.
                미정 싫어.
                윤서 왜 싫어?
                미정 그냥 싫어.""");

        assertThat(result.roster()).containsExactly("윤서", "미정");
        assertThat(result.format()).isEqualTo(RuleSplit.Format.SPACE);
    }

    @Test
    void proseIsNotConfident() {
        RuleSplit.Result result = split("""
                비는 새벽부터 내렸다. 골목 끝 가게의 셔터는 반쯤 내려가 있었고, 그 틈으로 노란 불빛이 새어 나왔다.
                그는 우산을 접지 않은 채 한참을 서 있었다.
                셔터가 조금 더 올라갔다. 안에서 누군가 그를 불렀다.""");

        assertThat(result.confident()).isFalse();
    }

    @Test
    void commonSentenceStartsAreNotNames() {
        RuleSplit.Result result = split("""
                아니 그게 아니라.
                아니 왜 그래.
                아니 진짜로.
                그래 알았어.""");

        assertThat(result.roster()).isEmpty();
        assertThat(result.confident()).isFalse();
    }

    // ── 정답 셋 오류 고침 (2026-11-19) ───────────────────

    @Test
    void aNameWithAnActionInParenthesesIsADirectionAndStillOpensTheBlock() {
        RuleSplit.Result result = split("""
                수아
                아직 안 갔네.

                도윤 (창밖을 본다)
                갈 데가 없어서.

                수아
                너 집 있잖아.

                도윤 (V.O.)
                없어.""");

        assertThat(row(result, 4).kind()).isEqualTo(Kind.DIRECTION);
        assertThat(row(result, 5).speaker()).isEqualTo("도윤");
        assertThat(row(result, 10).kind()).isEqualTo(Kind.IGNORE);
        assertThat(row(result, 11).speaker()).isEqualTo("도윤");
    }

    @Test
    void aBracketHeadEndingWithAParenthesisIsDialogueNotAParenthesisLine() {
        RuleSplit.Result result = split("""
                [민수] 가자!
                [영희] 어디로. (웃으며)
                [민수] 몰라. (사이)
                [영희] 그래.""");

        assertThat(row(result, 2)).isEqualTo(new Row(2, Kind.DIALOGUE, "영희", "[영희] "));
        assertThat(row(result, 3).speaker()).isEqualTo("민수");
    }

    @Test
    void moreSceneMarkers() {
        RuleSplit.Result result = split("""
                12. 거실, 밤
                민수: 왔어?
                영희: 응.
                - 암전 -
                장면 2
                민수: 늦었네.
                S# 골목 - 밤
                영희: 미안.""");

        assertThat(row(result, 1).kind()).isEqualTo(Kind.SCENE);
        assertThat(row(result, 4).kind()).isEqualTo(Kind.SCENE);
        assertThat(row(result, 5).kind()).isEqualTo(Kind.SCENE);
        assertThat(row(result, 7).kind()).isEqualTo(Kind.SCENE);
    }

    @Test
    void fullDoesNotTakeAOneOffTwoWordColonLabelAsASpeaker() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("""
                윤서 왜?
                미정 그냥.
                윤서 말해 봐.
                미정 싫어.

                무대 위치: 거실 왼쪽 끝.

                윤서 왜 싫어?
                미정 그냥 싫어."""));

        assertThat(row(result, 6).kind()).isEqualTo(Kind.DIRECTION);
        assertThat(result.roster()).containsExactly("윤서", "미정");
    }

    // ── 성 + 이름 묶기 (풀규칙) ──────────────────────────

    @Test
    void fullMergesASurnamedNameWithTheGivenName() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("""
                김민수: 안녕.
                지수: 응.
                민수: 왜 그렇게 봐?
                지수: 그냥.
                민 수: 아니야.
                김민수: 가자."""));

        // 대사가 많은 쪽(「김민수」 2·「민수」 1·「민 수」 1)을 남긴다
        assertThat(result.roster()).containsExactly("김민수", "지수");
        assertThat(row(result, 3).speaker()).isEqualTo("김민수");
        assertThat(row(result, 5).speaker()).isEqualTo("김민수");
    }

    @Test
    void fullKeepsTwoSurnamesForTheSameGivenNameApart() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("""
                김민수: 안녕.
                이민수: 응.
                민수: 누구 불렀어?
                김민수: 너 말고.
                이민수: 나?"""));

        assertThat(result.roster()).containsExactly("김민수", "이민수", "민수");
    }

    @Test
    void fullDoesNotMergeANameWithSomethingAfterIt() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("""
                민수: 엄마 왔어?
                민수 엄마: 그래.
                민수: 배고파.
                민수 엄마: 밥 먹자."""));

        assertThat(result.roster()).containsExactly("민수", "민수 엄마");
    }

    @Test
    void surnameMergesSkipRoleWords() {
        assertThat(RuleSplit.surnameMerges(java.util.List.of("여학생", "학생", "전남편", "남편"))).isEmpty();
        assertThat(RuleSplit.surnameMerges(java.util.List.of("남궁민수", "민수", "민수"))).containsEntry("남궁민수", "민수");
        // 대사 수가 같으면 짧은 쪽
        assertThat(RuleSplit.surnameMerges(java.util.List.of("김민수", "민수"))).containsEntry("김민수", "민수");
    }

    // ── 풀규칙(모델 없이 모든 줄) ─────────────────────────

    @Test
    void fullAnswersEveryLine() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("""
                지호: 다녀왔습니다.
                어머니가 수도를 잠근다.
                어머니: 앉아.
                지호: 배고파요.
                진짜 하루 종일 굶었어요."""));

        assertThat(result.coverage()).isEqualTo(1.0);
        assertThat(row(result, 2).kind()).isEqualTo(Kind.DIRECTION);
        assertThat(row(result, 5)).isEqualTo(new Row(5, Kind.DIALOGUE, "지호", ""));
    }

    @Test
    void fullKeepsWhatTheHybridRulesAlreadyAnswered() {
        String raw = """
                수아
                아직 안 갔네.

                도윤
                갈 데가 없어서.

                수아
                너 집 있잖아.

                도윤
                없어.""";
        RuleSplit.Result hybrid = split(raw);
        RuleSplit.Result full = RuleSplit.full(NumberedLine.of(raw));

        hybrid.rows().forEach((no, row) -> assertThat(full.rows().get(no)).isEqualTo(row));
    }

    @Test
    void fullTakesAnUnknownBlockNameAsANewSpeaker() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("""
                수아
                아직 안 갔네.

                도윤
                갈 데가 없어서.

                수아
                너 집 있잖아.

                도윤
                없어.

                택배
                계세요?"""));

        assertThat(row(result, 13).kind()).isEqualTo(Kind.IGNORE);
        assertThat(row(result, 14)).isEqualTo(new Row(14, Kind.DIALOGUE, "택배", ""));
        assertThat(result.roster()).contains("택배");
    }

    @Test
    void fullReadsANamelessScriptAsAMonologue() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("""
                오늘도 늦었네.
                버스를 또 놓쳤어.
                (한숨)
                내일은 꼭 일찍 나와야지."""));

        assertThat(row(result, 2)).isEqualTo(new Row(2, Kind.DIALOGUE, Monologue.PLACEHOLDER, ""));
        assertThat(row(result, 3).kind()).isEqualTo(Kind.DIRECTION);
        assertThat(result.roster()).containsExactly(Monologue.PLACEHOLDER);
    }

    @Test
    void fullRejectsProse() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("""
                비는 새벽부터 내렸다. 골목 끝 가게의 셔터는 반쯤 내려가 있었고, 그 틈으로 노란 불빛이 새어 나왔다.
                그는 우산을 접지 않은 채 한참을 서 있었다.
                셔터가 조금 더 올라갔다. 안에서 누군가 그를 불렀다."""));

        assertThat(result.roster()).isEmpty();
        assertThat(result.dialogues()).isZero();
    }

    @Test
    void modeParsesUnknownValuesAsLlm() {
        assertThat(ScriptSplitMode.parse("hybrid")).isEqualTo(ScriptSplitMode.HYBRID);
        assertThat(ScriptSplitMode.parse(" HYBRID ")).isEqualTo(ScriptSplitMode.HYBRID);
        assertThat(ScriptSplitMode.parse("")).isEqualTo(ScriptSplitMode.LLM);
        assertThat(ScriptSplitMode.parse("rules")).isEqualTo(ScriptSplitMode.RULES);
        assertThat(ScriptSplitMode.parse("regex")).isEqualTo(ScriptSplitMode.LLM);
        assertThat(ScriptSplitMode.parse(null)).isEqualTo(ScriptSplitMode.LLM);
    }

    @Test
    void resultReportsCoverage() {
        RuleSplit.Result result = new RuleSplit.Result(Map.of(1, new Row(1, Kind.DIALOGUE, "a", "")), java.util.List.of("a"),
                RuleSplit.Format.COLON, 4);
        assertThat(result.coverage()).isEqualTo(0.25);
        assertThat(result.confident()).isFalse();
    }
}
