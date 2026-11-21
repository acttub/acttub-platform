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

    // ── 희곡 43편 재생에서 고침 (2026-11-21) ─────────────

    @Test
    void tabHeadsWithSpacedNamesAreDialogue() {
        RuleSplit.Result result = split("7번 배심원\t하나 드릴까?\n8번 배심원\t(웃으며) 아니요, 됐습니다.\n7번 배심원(창밖을 보며)\t덥네요.\n"
                + "경비 \t\t자, 모두 이쪽으로 들어오십시오.\n8번 배심원\t그러게요.\n경비\t\t문 잠급니다.");

        assertThat(row(result, 1).speaker()).isEqualTo("7번 배심원");
        assertThat(row(result, 3).speaker()).isEqualTo("7번 배심원");
        assertThat(row(result, 4).speaker()).isEqualTo("경비");
        assertThat(result.roster()).containsExactly("7번 배심원", "8번 배심원", "경비");
    }

    @Test
    void formalSpeechEndingIsSpeech() {
        assertThat(RuleSplit.speechEnd("여러분은 막중한 책임을 지고 있습니다. 고맙습니다.")).isTrue();
        assertThat(RuleSplit.speechEnd("모두 이쪽으로 들어오십시오.")).isTrue();
    }

    @Test
    void fullDoesNotTakeWordFragmentsAndCommonWordsAsNames() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("""
                극작가 오늘은 무대가 아주 넓어 보이고 조명도 밝아서 무언가 시작하려
                고 하는 것 같아.
                지하인 무엇을 찾고 있는지 아직은 잘 모르겠지만 계속 찾
                고 있어.
                극작가 그럼 같이 찾아보는 건 어때? 처음부터 다시 천천히 시작하
                고 싶어.
                지하인 좋아. 잠시 쉬었다가 하자.
                잠시 숨을 고른다.
                극작가 그래.
                잠시 침묵이 흐른다.
                지하인 이제 가자."""));

        assertThat(result.roster()).containsExactly("극작가", "지하인");
    }

    @Test
    void twoWordPhrasesAreNotBlockNames() {
        assertThat(RuleSplit.standaloneNameForTest("모두 신나게")).isNull();
        assertThat(RuleSplit.standaloneNameForTest("에이코 왜")).isNull();
        assertThat(RuleSplit.standaloneNameForTest("김 형사")).isEqualTo("김 형사");
        assertThat(RuleSplit.standaloneNameForTest("남자 2")).isEqualTo("남자 2");
        assertThat(RuleSplit.standaloneNameForTest("7번 배심원")).isEqualTo("7번 배심원");
    }

    @Test
    void creditLinesAtTheEndAreNotCast() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("""
                민수: 안녕.
                영희: 응.
                민수: 가자.
                영희: 그래.

                연출 홍길동
                무대감독 김철수
                조명 이영희
                기획 박민지"""));

        assertThat(result.roster()).containsExactly("민수", "영희");
    }

    @Test
    void stageLabelLinesAreDirections() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("""
                에이코 뭐고, 드라마 안 봤나?
                준코 띄엄띄엄 보고 있다.
                무대 자매들, 크게 웃는다.
                에이코 재밌다 아이가.
                무대, 잠시 암전.
                준코 그래."""));

        assertThat(row(result, 3).kind()).isEqualTo(Kind.DIRECTION);
        assertThat(row(result, 5).kind()).isEqualTo(Kind.DIRECTION);
        assertThat(result.roster()).containsExactly("에이코", "준코");
    }

    @Test
    void letterSpacedNamesAreJoined() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("칠    수: 안녕.\n만    수: 응.\n칠    수: 가자.\n만 수: 그래."));

        assertThat(result.roster()).containsExactly("칠수", "만수");
    }

    @Test
    void unwrapJoinsLinesCutAtThePageWidth() {
        // 폭 30자에서 잘린 줄: 끝에 공백이 있으면 띄어 잇고, 없으면 붙여 잇는다. 다음 줄이 배역 이름으로 시작하면 잇지 않는다.
        java.util.List<NumberedLine> lines = NumberedLine.of("극작가 오늘은 무대가 아주 넓어 보이고 조명도 \n밝아서 무언가를 시작하려는 느낌이 드는데 시작하\n고 싶은 마음이 있어.\n"
                + "지하인 무엇을 찾고 있는지 아직은 모르겠다.\n극작가 그럼 같이 찾자.");
        java.util.List<NumberedLine> joined = RuleSplit.unwrap(lines, 30, java.util.Set.of("극작가", "지하인"));

        assertThat(joined).extracting(NumberedLine::text).containsExactly(
                "극작가 오늘은 무대가 아주 넓어 보이고 조명도 밝아서 무언가를 시작하려는 느낌이 드는데 시작하고 싶은 마음이 있어.",
                "지하인 무엇을 찾고 있는지 아직은 모르겠다.", "극작가 그럼 같이 찾자.");
        assertThat(joined.getFirst().no()).isEqualTo(1);
    }

    // ── 남은 쉬운 오류·독백 이름·한 줄 여러 대사 (2026-11-21) ──

    @Test
    void decorationMemoAndMusicLinesAreIgnored() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("민수: 안녕.\n⸻\n영희: 응.\n* **메모(3막):** 조명 바꿀 것\n민수: 가자.\n🎼 빗소리가 흐른다\n영희: 그래."));

        assertThat(row(result, 2).kind()).isEqualTo(Kind.IGNORE);
        assertThat(row(result, 4).kind()).isEqualTo(Kind.IGNORE);
        assertThat(row(result, 6).kind()).isEqualTo(Kind.IGNORE);
    }

    @Test
    void aSpeechLineEndingInAnActionParenthesisIsDialogue() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("민수: 안녕.\n영희: 응.\n민수: 가자.\n\n같이 가자! (손을 내민다)\n\n영희: 그래."));

        assertThat(row(result, 5).kind()).isEqualTo(Kind.DIALOGUE);
    }

    @Test
    void lyricsInParenthesesWithSlashesAreDialogue() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("민수: 노래하자.\n영희: 좋아.\n(가자! / 저 끝까지 / 멈추지 마!)\n민수: 그래.\n영희: 응."));

        assertThat(row(result, 3)).isEqualTo(new Row(3, Kind.DIALOGUE, "영희", ""));
    }

    @Test
    void aDirectionInParenthesesSpanningLinesIsOneDirection() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("민수: 안녕.\n영희: 응.\n(창밖을 오래 보다가,\n천천히 돌아선다)\n민수: 가자."));

        assertThat(row(result, 3).kind()).isEqualTo(Kind.DIRECTION);
        assertThat(row(result, 4).kind()).isEqualTo(Kind.DIRECTION);
    }

    @Test
    void anUnclosedParenthesisDoesNotSwallowTheLinesAfterIt() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("민수: 안녕.\n영희: 응.\n(창밖을 오래 본다\n민수: 가자.\n영희: 그래.\n민수: 응."));

        assertThat(row(result, 4).kind()).isEqualTo(Kind.DIALOGUE);
    }

    @Test
    void wordsWithAParticleAreNotNames() {
        assertThat(RuleSplit.spaceName("얀은", 5)).isFalse();
        assertThat(RuleSplit.spaceName("문이", 5)).isFalse();
        assertThat(RuleSplit.spaceName("지은", 3)).isTrue();
        assertThat(RuleSplit.spaceName("윤서", 3)).isTrue();
        assertThat(RuleSplit.spaceName("민수", 2)).isTrue();
        assertThat(RuleSplit.spaceName("작은", 9)).isFalse();
    }

    @Test
    void anAuthorUnderTheTitleIsNotTheMonologueSpeaker() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("<담배의 해로움에 대해>\n체호프\n\n뉴힌\t(인사한다) 친애하는 여러분.\n\n제 아내가 강연을 하라고 했습니다."));

        assertThat(result.roster()).containsExactly("뉴힌");
    }

    @Test
    void monologueSpeakerComesFromTheTitle() {
        assertThat(RuleSplit.monologueName("햄릿 독백")).isEqualTo("햄릿");
        assertThat(RuleSplit.monologueName("오필리어의 독백")).isEqualTo("오필리어");
        assertThat(RuleSplit.monologueName("[독백] 서진")).isEqualTo("서진");
        assertThat(RuleSplit.monologueName("독백 - 문 앞에서")).isNull();
        assertThat(RuleSplit.monologueName("마지막 버스")).isNull();
        assertThat(RuleSplit.monologueName(null)).isNull();
    }

    @Test
    void turnsWrittenOnOneLineAreSplit() {
        String raw = """
                에이코 뭐고, 준코 너 그 드라마 안 봤나?  준코 띄엄띄엄 보고 있다. 키요코 그거 재밌다 아이가.
                준코 그래?  에이코 그렇다.
                키요코 나는 몰라.  준코 왜?
                에이코 몰라도 된다.
                준코 알았다.""";
        java.util.List<NumberedLine> split = RuleSplit.splitTurns(NumberedLine.of(raw), java.util.Set.of("에이코", "준코", "키요코"));

        assertThat(split).extracting(NumberedLine::text).containsExactly("에이코 뭐고, 준코 너 그 드라마 안 봤나?", "준코 띄엄띄엄 보고 있다.",
                "키요코 그거 재밌다 아이가.", "준코 그래?", "에이코 그렇다.", "키요코 나는 몰라.", "준코 왜?", "에이코 몰라도 된다.", "준코 알았다.");
        // 나뉜 조각은 서로 붙은 줄이다(번호가 이어진다)
        assertThat(split.get(1).no()).isEqualTo(split.get(0).no() + 1);
    }

    @Test
    void ordinaryLinesAreNotSplitAtANameInsideTheSentence() {
        String raw = "민수 영희 어디 갔어?\n영희 몰라. 민수 너는 알아?\n민수 나도 몰라.\n영희 그래.";
        java.util.List<NumberedLine> split = RuleSplit.splitTurns(NumberedLine.of(raw), java.util.Set.of("민수", "영희"));

        assertThat(split).hasSize(4);
    }

    // ── 줄 언어(규칙) ─────────────────────────────────────

    @Test
    void lineLanguagesByScript() {
        assertThat(RuleLanguage.of("I never left you.")).isEqualTo(new LineLanguage.Result("en", null));
        assertThat(RuleLanguage.of("Merci beaucoup, je suis très content.")).isEqualTo(new LineLanguage.Result("fr", null));
        assertThat(RuleLanguage.of("ありがとうございます")).isEqualTo(new LineLanguage.Result("ja", null));
        assertThat(RuleLanguage.of("고맙습니다. Thank you so much.")).isEqualTo(new LineLanguage.Result("en", "⟦ko⟧고맙습니다. ⟦en⟧Thank you so much."));
        // 한국어 줄에 짧은 영어 낱말이 섞이면 한국어로 둔다(받아쓰기가 한국어로 듣게)
        assertThat(RuleLanguage.of("오늘 CEO 회의가 있어서 늦었어.")).isNull();
        assertThat(RuleLanguage.of("안녕")).isNull();
        assertThat(RuleLanguage.of("HIV면 에이즈요?")).isNull();
        assertThat(RuleLanguage.of("(진료실을 치우며) Day three. 책상부터 정리하라!"))
                .isEqualTo(new LineLanguage.Result("en", "⟦en⟧Day three. ⟦ko⟧책상부터 정리하라!"));
        assertThat(RuleLanguage.of("(손을 들며) You win!")).isEqualTo(new LineLanguage.Result("en", "You win!"));
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

        // 띄운 「민 수」를 먼저 붙여 「민수」 2·「김민수」 2 — 같으면 짧은 쪽을 남긴다
        assertThat(result.roster()).containsExactly("민수", "지수");
        assertThat(row(result, 1).speaker()).isEqualTo("민수");
        assertThat(row(result, 5).speaker()).isEqualTo("민수");
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
