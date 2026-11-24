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

    @Test
    void unwrapLeavesTextWithoutVisibleCutsAlone() {
        // 폭까지 찬 줄이 끝 부호로 닫히는 보통 대본 — 끊긴 자리가 없으니 그대로다
        StringBuilder raw = new StringBuilder();
        for (int k = 0; k < 12; k++) raw.append("민수 오늘은 무대가 아주 넓어 보이고 조명도 밝아서 좋다.\n영희 그럼 같이 시작해 보자, 지금 바로.\n");
        java.util.List<NumberedLine> lines = NumberedLine.of(raw.toString());

        assertThat(RuleSplit.unwrap(lines)).isSameAs(lines);
    }

    @Test
    void unwrapJoinsCutLinesInAnyText() {
        // 끊긴 자리가 글 줄의 5% 넘게 보이면 파일 종류를 묻지 않고 잇는다
        StringBuilder raw = new StringBuilder();
        for (int k = 0; k < 10; k++) raw.append("민수 오늘은 무대가 아주 넓어 보이고 조명도 밝아서 무언가를 시작하\n고 싶은 마음이 들어.\n영희 그럼 같이 시작해 보자.\n");

        assertThat(RuleSplit.unwrap(NumberedLine.of(raw.toString()))).extracting(NumberedLine::text)
                .contains("민수 오늘은 무대가 아주 넓어 보이고 조명도 밝아서 무언가를 시작하고 싶은 마음이 들어.").hasSize(20);
    }

    // ── 구분 부호 머리·쌍점 블록·인물 설명 (2026-11-23) ──

    @Test
    void spacedDashHeadsRepeatedByTwoNamesAreSpeakers() {
        RuleSplit.Result result = full("혜정 - 살려줘.\n동은 - 왜 그래?\n혜정 - 누가 따라와.\n동은 - 어디?\n혜정 - 저기 골목.");

        assertThat(result.roster()).containsExactly("혜정", "동은");
        assertThat(row(result, 2).speaker()).isEqualTo("동은");
    }

    @Test
    void slashHeadsWithASpaceAreSpeakersButPairedRolesStayWhole() {
        RuleSplit.Result result = full("태하/ 그럼 내일 보자.\n서윤/ 내일은 안 돼.\n태하/ 왜?\n서윤/ 약속 있어.");

        assertThat(result.roster()).containsExactly("태하", "서윤");
        assertThat(full("해리/헤라 어디 가?\n민수 집에.\n해리/헤라 같이 가.\n민수 그래.\n해리/헤라 좋아.").roster()).contains("해리/헤라");
    }

    @Test
    void closingParenAndNumberColonHeadsAreSpeakers() {
        assertThat(full("장영철) 안녕하세요.\n김미진) 네, 오셨어요.\n장영철) 오늘 춥네요.\n김미진) 그러게요.").roster())
                .containsExactly("장영철", "김미진");
        assertThat(full("1 : 너 거기 있어?\n2 : 아니.\n1 : 그럼 어디야?\n2 : 비밀.").roster()).containsExactly("1", "2");
    }

    @Test
    void nameColonLinesStartBlocks() {
        RuleSplit.Result result = full("여자:\n오늘 늦었네.\n\n남자:\n차가 막혔어.\n\n여자:\n변명은.\n\n남자:\n미안해.");

        assertThat(result.roster()).containsExactly("여자", "남자");
        assertThat(row(result, 5).speaker()).isEqualTo("남자");
    }

    @Test
    void aColonLineInsideParenthesesIsThatPersonsLine() {
        RuleSplit.Result result = full("김부장: 자네 왔나.\n박대리: 네, 부장님.\n(김부장 : 믿어도 되겠지..)\n박대리: 걱정 마세요.\n김부장: 그래.");

        assertThat(row(result, 3)).isEqualTo(new Row(3, Kind.DIALOGUE, "김부장", ""));
    }

    @Test
    void castDescriptionsWithoutAHeaderAreCast() {
        RuleSplit.Result result = full("""
                봄날의 정류장

                윤아 여, 20대 후반, 회사원
                도현 남, 30대 초반, 버스 기사
                미숙 여, 60대, 윤아의 엄마

                S#1. 정류장 - 밤

                윤아: 막차 끊겼어요?
                도현: 아직 하나 남았어요.
                윤아: 다행이다.
                도현: 타세요.""");

        assertThat(row(result, 3).kind()).isEqualTo(Kind.CAST);
        assertThat(row(result, 5).kind()).isEqualTo(Kind.CAST);
        assertThat(row(result, 9).speaker()).isEqualTo("윤아");
    }

    // ── 지난번 규칙 (2026-11-22) ──

    @Test
    void castSectionWithDescriptionParagraphsIsIgnoredAsCast() {
        RuleSplit.Result result = full("""
                등장인물
                지우 - 열일곱, 고등학생
                늘 무언가를 그리고 있다. 말수가 적다.
                하린 - 지우의 단짝

                무대, 텅 빈 미술실.

                지우: 왔어?
                하린: 응, 늦었지.
                지우: 괜찮아.""");

        assertThat(row(result, 3).kind()).isEqualTo(Kind.CAST);
        assertThat(result.roster()).containsExactlyInAnyOrder("지우", "하린");
    }

    @Test
    void hangulNamePeriodHeadsAreSpeakers() {
        RuleSplit.Result result = full("민수. 어디 가?\n영희. 시장에.\n민수. 같이 가.\n영희. 그래.\n민수. 좋아.\n영희. 빨리 와.");

        assertThat(result.roster()).containsExactly("민수", "영희");
        assertThat(row(result, 2).speaker()).isEqualTo("영희");
    }

    @Test
    void attachedMarkHeadsAreSpeakers() {
        assertThat(full("병사- 거기 서라!\n소년- 저요?\n병사- 그래, 너.\n소년- 왜요?").roster()).containsExactly("병사", "소년");
        assertThat(full("현우; 해인아!\n해인; 응?\n현우; 가자.\n해인; 어디로?").roster()).containsExactly("현우", "해인");
        assertThat(full("여)나 갈게.\n남)어디 가?\n여)집에.\n남)데려다줄게.").roster()).containsExactly("여", "남");
    }

    @Test
    void numberSpeakersSeenOftenAreSpeakers() {
        assertThat(full("1 응? 뭐가?\n2 저거 봐.\n3 뭔데.\n1 아무것도 없는데.\n2 다시 봐.\n3 정말이네.\n1 이상하다.\n2 그치?\n3 가자.").roster())
                .containsExactly("1", "2", "3");
    }

    @Test
    void runningHeadersBesidePageNumbersAreNotSpeakers() {
        StringBuilder raw = new StringBuilder();
        for (int page = 1; page <= 4; page++) {
            raw.append("한빛대학교 26-").append(page).append(" 정기공연\n").append(page).append("\n");
            raw.append("민수 오늘 연습 몇 시야?\n영희 일곱 시.\n민수 늦지 마.\n영희 알았어.\n\n");
        }
        RuleSplit.Result result = full(raw.toString());

        assertThat(result.roster()).containsExactly("민수", "영희");
        assertThat(row(result, 1).kind()).isNotEqualTo(Kind.DIALOGUE);
    }

    @Test
    void directionMarksAroundNamesAreInvisible() {
        RuleSplit.Result result = full("‭민수‬ 어디 가?\n‭영희‬ 집에.\n‭민수‬ 같이 가.\n‭영희‬ 그래.");

        assertThat(result.roster()).containsExactly("민수", "영희");
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

    // ── r4 대조에서 찾은 오류 (2026-11-22) ───────────────────

    @Test
    void anActionLineWithALongParenthesisHandsTheNextLinesToThatPerson() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("""
                민수
                안녕.

                영희
                응.

                민수
                오늘 어땠어?

                영희
                별로.

                영희 (고개를 끄덕이며 가방을 챙겨 들고 문 쪽으로 천천히 걸어간다)
                그냥 그랬어.

                민수 (창밖을 오래 바라보다가, 천천히 돌아서며 낮게 웃는다)
                그래, 가자."""));

        assertThat(row(result, 14)).isEqualTo(new Row(14, Kind.DIALOGUE, "영희", ""));
        assertThat(row(result, 17)).isEqualTo(new Row(17, Kind.DIALOGUE, "민수", ""));
    }

    @Test
    void aColonHeadWithOnlyAnActionHandsTheNextLineToThatPerson() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("민수 : 안녕.\n영희 : 응.\n민수 : 오늘 어땠어?\n영희 : (한숨을 쉰다)\n그냥 그랬어. 너는?\n민수 : 나도."));

        assertThat(row(result, 5)).isEqualTo(new Row(5, Kind.DIALOGUE, "영희", ""));
    }

    @Test
    void aBracketedNameAloneOnALineStartsThatPersonsLines() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("민수: 안녕.\n영희: 응.\n민수: 가자.\n\n[영희]\n잠깐만 기다려 줘.\n민수: 그래."));

        assertThat(row(result, 5).kind()).isEqualTo(Kind.IGNORE);
        assertThat(row(result, 6)).isEqualTo(new Row(6, Kind.DIALOGUE, "영희", ""));
    }

    @Test
    void aLongActionLineOfANameOnlyTheFullRulesKnowHandsOverTheNextLine() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("민수 안녕.\n영희 응.\n민수 (창밖을 오래 바라보며 천천히 웃는다)\n그래, 가자.\n영희 좋아."));

        assertThat(row(result, 3).kind()).isEqualTo(Kind.DIRECTION);
        assertThat(row(result, 4)).isEqualTo(new Row(4, Kind.DIALOGUE, "민수", ""));
    }

    @Test
    void actionHeadNamesAndBracketNameLines() {
        java.util.Set<String> known = java.util.Set.of("민수", "준");
        assertThat(RuleSplit.actionHeadName("민수 (웃는다)", known)).isEqualTo("민수");
        assertThat(RuleSplit.actionHeadName("민수 ： (한숨)", known)).isEqualTo("민수");
        assertThat(RuleSplit.actionHeadName("민수: (한숨)", known)).isEqualTo("민수");
        assertThat(RuleSplit.actionHeadName("[민수] (웃는다)", known)).isEqualTo("민수");
        assertThat(RuleSplit.actionHeadName("철수 (웃는다)", known)).isNull();
        assertThat(RuleSplit.actionHeadName("(웃는다)", known)).isNull();
        assertThat(RuleSplit.actionHeadName("민수 웃는다", known)).isNull();
        assertThat(RuleSplit.bracketNameLine("[민수]", known)).isEqualTo("민수");
        assertThat(RuleSplit.bracketNameLine("[어린 민수]", known)).isEqualTo("민수");
        assertThat(RuleSplit.bracketNameLine("[어린 준]", known)).isNull();
        assertThat(RuleSplit.bracketNameLine("[철수]", known)).isNull();
        assertThat(RuleSplit.bracketNameLine("[민수] 안녕", known)).isNull();
    }

    @Test
    void aTitleWhoseNamePartIsSpeechIsNotTheMonologueSpeaker() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("마지막 버스_오늘은요(20대)\n오늘도 늦었네.\n왜 나만 이렇게 바쁠까?"));

        assertThat(result.roster()).doesNotContain("오늘은요");
    }

    @Test
    void shortColonScriptsSkipTitlesAndLongNames() {
        assertThat(RuleSplit.full(NumberedLine.of("독백: 문 앞에서\n서진: 열쇠는 맞는데 손이 안 움직여.")).roster()).doesNotContain("독백");
        assertThat(RuleSplit.full(NumberedLine.of("가나다라마바사아자: 안녕\n민호: 응 오랜만이야")).roster()).doesNotContain("가나다라마바사아자");
        assertThat(RuleSplit.full(NumberedLine.of("\n\n")).rows().values()).allMatch(r -> r.kind() == Kind.IGNORE);
    }

    @Test
    void aMonologueSpeakerAfterAnUnderscoreInTheFirstLine() {
        RuleSplit.Result result = RuleSplit.full(NumberedLine.of("마지막 버스_서진(20대 여성)\n오늘도 늦었네.\n왜 나만 이렇게 바쁠까?"));

        assertThat(result.roster()).containsExactly("서진");
        assertThat(row(result, 1).kind()).isEqualTo(Kind.TITLE);
        assertThat(row(result, 2)).isEqualTo(new Row(2, Kind.DIALOGUE, "서진", ""));
    }

    @Test
    void aShortScriptMadeOnlyOfColonHeadsKeepsItsFirstSpeaker() {
        RuleSplit.Result two = RuleSplit.full(NumberedLine.of("지수:안녕 잘 지냈어\n민호:응 오랜만이야"));
        RuleSplit.Result one = RuleSplit.full(NumberedLine.of("지수: 오늘 정말 하고 싶은 말이 많아. 들어줄래?"));

        assertThat(two.roster()).containsExactly("지수", "민호");
        assertThat(row(two, 1).speaker()).isEqualTo("지수");
        assertThat(one.roster()).containsExactly("지수");
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
    // ── 2026-11-21 풀규칙 보강 ─────────────────────────────

    private static RuleSplit.Result full(String raw) {
        return RuleSplit.full(NumberedLine.of(raw));
    }

    private static String label(RuleSplit.Result result, int no) {
        Row r = result.rows().get(no);
        return r == null ? "-" : r.kind() == Kind.DIALOGUE ? r.speaker() : r.kind().name();
    }

    @Test
    void numberedTwoWordNamesAreReadAsOneHead() {
        RuleSplit.Result result = full("""
                등장인물
                3번 위원
                7번 위원

                3번 위원 뭐가 문제죠?
                7번 위원 시간이 없다고요.
                3번 위원 그래도 말은 해야죠.
                7번 위원 그럼 하세요.""");

        assertThat(label(result, 5)).isEqualTo("3번 위원");
        assertThat(label(result, 6)).isEqualTo("7번 위원");
        assertThat(row(result, 6).header()).isEqualTo("7번 위원 ");
    }

    @Test
    void bracketedNameLinesStartBlocks() {
        RuleSplit.Result result = full("""
                [하늘]
                오늘은 바람이 차네.
                [바다]
                그러게, 겨울이 왔나 봐.
                [하늘]
                집에 가자.
                [바다]
                응, 가자.""");

        assertThat(label(result, 1)).isEqualTo("IGNORE");
        assertThat(label(result, 2)).isEqualTo("하늘");
        assertThat(label(result, 4)).isEqualTo("바다");
        assertThat(label(result, 8)).isEqualTo("바다");
    }

    @Test
    void colonHeadsDropBulletsAndActorParens() {
        RuleSplit.Result result = full("""
                * 도담(배우1): 여기 앉아도 돼요?
                * 세찬(배우2): 그럼요, 앉으세요.
                * 도담(배우1): 고마워요.""");

        assertThat(label(result, 1)).isEqualTo("도담");
        assertThat(label(result, 2)).isEqualTo("세찬");
    }

    @Test
    void stageBracketAndNameParenCommaAreDirections() {
        RuleSplit.Result result = full("""
                도담: 왔어?
                세찬: 응, 방금.
                [무대] 창밖으로 비가 내리고 있다
                세찬(배우2), 우산을 접어 문 옆에 세워 두고
                도담: 비 많이 와?""");

        assertThat(label(result, 3)).isEqualTo("DIRECTION");
        assertThat(label(result, 4)).isEqualTo("DIRECTION");
    }

    @Test
    void namesEndingInDaNeedFiveHeads() {
        StringBuilder raw = new StringBuilder();
        for (int k = 0; k < 5; k++) raw.append("로다 어디 가?\n\n미루 산책 가.\n\n");
        RuleSplit.Result result = full(raw.toString());

        assertThat(label(result, 1)).isEqualTo("로다");
        assertThat(RuleSplit.spaceName("로다", 4)).isFalse();
        assertThat(RuleSplit.spaceName("잠근다", 9)).isFalse();
        assertThat(RuleSplit.spaceName("했다", 9)).isFalse();
    }

    @Test
    void numberOnlySpeakersNeedThreeNumbers() {
        RuleSplit.Result result = full("""
                1 얼음!
                2 땡!
                3 너희 뭐 해?
                1 놀고 있지.
                2 같이 할래?
                3 싫어.
                1 왜?
                2 재밌는데.
                3 그래도 싫어.""");

        assertThat(label(result, 3)).isEqualTo("3");
        assertThat(label(result, 4)).isEqualTo("1");
    }

    @Test
    void dashSemicolonAndParenMarksSplitHeads() {
        RuleSplit.Result result = full("""
                병사- 거기 서라!
                도둑; 싫은데?
                병사- 잡히면 끝이야.
                도둑; 못 잡을걸.
                여)나 갈게.
                남)가지 마.
                여)안녕.
                남)잘 가.""");

        assertThat(label(result, 1)).isEqualTo("병사");
        assertThat(label(result, 2)).isEqualTo("도둑");
        assertThat(label(result, 5)).isEqualTo("여");
        assertThat(label(result, 6)).isEqualTo("남");
    }

    @Test
    void onceSeenNameLinesBeforeTheFirstSpeechAreNotSpeakers() {
        RuleSplit.Result result = full("""
                연극

                겨울 정류장
                작 아무개

                도담: 버스 언제 와?
                세찬: 곧 오겠지.
                도담: 추워.""");

        assertThat(label(result, 3)).isNotEqualTo("겨울 정류장");
        assertThat(result.roster()).containsExactly("도담", "세찬");
    }

    @Test
    void shortStageCuesInsideBlocksAreDirections() {
        RuleSplit.Result result = full("""
                하늘
                오늘은 춥다
                긴 사이.
                집에 가자
                바다
                그래, 가자
                하늘 등장.
                하늘
                왔어?
                바다
                응""");

        assertThat(label(result, 2)).isEqualTo("하늘");
        assertThat(label(result, 3)).isEqualTo("DIRECTION");
        assertThat(label(result, 7)).isEqualTo("DIRECTION");
    }

    @Test
    void narrationUnderABlockNameIsADirection() {
        RuleSplit.Result result = full("""
                하늘
                이제 그만 가자
                하늘, 가방을 들고 문 쪽으로 걸어간다.
                바다
                잠깐만
                바다
                어디 가?
                하늘
                집에""");

        assertThat(label(result, 2)).isEqualTo("하늘");
        assertThat(label(result, 3)).isEqualTo("DIRECTION");
    }

    @Test
    void spacedFullNamesAreJoined() {
        RuleSplit.Result result = full("""
                로이 버튼 어서 와요.
                케이 모건 늦어서 미안해요.
                로이 버튼 괜찮아요.
                케이 모건 다들 기다렸죠?
                로이 버튼 아니요, 조금만요.
                케이 모건 다행이네요.""");

        assertThat(label(result, 1)).isEqualTo("로이 버튼");
        assertThat(label(result, 2)).isEqualTo("케이 모건");
        assertThat(row(result, 1).header()).isEqualTo("로이 버튼 ");
    }

    @Test
    void nameLinesWithATrailingMarkStartBlocks() {
        RuleSplit.Result result = full("""
                도담: 오늘도 아파?
                세찬: 조금.
                도담: 어디가?
                세찬: 그냥 여기저기.

                도담:
                숨을 쉴 때만 아파

                세찬 :
                생각할 때만 아파""");

        assertThat(label(result, 6)).isEqualTo("IGNORE");
        assertThat(label(result, 7)).isEqualTo("도담");
        assertThat(label(result, 9)).isEqualTo("IGNORE");
        assertThat(label(result, 10)).isEqualTo("세찬");
    }

    @Test
    void aNameLineNextToAPageNumberStaysAName() {
        RuleSplit.Result result = full("""
                하늘
                오늘은 바람이 차
                바다
                겨울이니까
                2
                하늘
                집에 가자
                바다
                그래
                하늘
                내일 봐
                바다
                잘 가""");

        assertThat(label(result, 7)).isEqualTo("하늘");
        assertThat(label(result, 9)).isEqualTo("바다");
    }

    @Test
    void aHeadedLineEndsTheBlockBeforeIt() {
        RuleSplit.Result result = full("""
                도담: 거기 누구야?
                세찬: 나야.
                도담
                놀랐잖아
                세찬: 미안, 놀라게 하려던 건
                아니었어.
                도담: 됐어.""");

        assertThat(label(result, 4)).isEqualTo("도담");
        assertThat(label(result, 6)).isEqualTo("세찬");
    }

    @Test
    void commonWordsWithAColonAreSpeakers() {
        RuleSplit.Result result = full("""
                나: 여기 누구 있어요?
                엄마: 왜 그렇게 소리를 질러.
                나: 아무도 없는 줄 알았지.
                엄마: 밥은 먹었니?""");

        assertThat(label(result, 1)).isEqualTo("나");
        assertThat(label(result, 3)).isEqualTo("나");
    }

    @Test
    void screenAndCaptionHeadsAreDirections() {
        RuleSplit.Result result = full("""
                도담: 이거 봤어?
                화면: 낡은 사진 한 장이 비친다
                세찬: 언제 찍은 거야?
                자막: 십 년 전
                도담: 기억 안 나?
                화면: 사진 속 두 아이""");

        assertThat(label(result, 2)).isEqualTo("DIRECTION");
        assertThat(label(result, 4)).isEqualTo("DIRECTION");
        assertThat(label(result, 3)).isEqualTo("세찬");
    }

    // ── 앞부분·악보 생략 ─────────────────────────────

    @Test
    void creditsShowInfoAndPageLinesBeforeTheFirstSpeechAreIgnored() {
        RuleSplit.Result result = full("""
                하얀 우산

                한겨울 작
                나무숲 옮김

                푸른극회 제 12회 정기공연
                WHITE UMBRELLA
                - 1 -

                작은 다락방. 창밖으로 눈이 내린다.

                도담: 눈 온다.
                세찬: 진짜네.
                도담: 나가자.
                세찬: 추워.""");

        assertThat(label(result, 3)).isEqualTo("IGNORE");
        assertThat(label(result, 4)).isEqualTo("IGNORE");
        assertThat(label(result, 6)).isEqualTo("IGNORE");
        assertThat(label(result, 7)).isEqualTo("IGNORE");
        assertThat(label(result, 8)).isEqualTo("IGNORE");
        assertThat(label(result, 10)).isEqualTo("DIRECTION");
        assertThat(label(result, 12)).isEqualTo("도담");
    }

    @Test
    void synopsisMetaAndNoticeAreIgnoredButTheSituationStays() {
        RuleSplit.Result result = full("""
                장르: 청춘 멜로
                본 이야기는 허구이며 실제 인물과 관계없습니다.

                [시놉시스]
                두 친구가 마지막 버스를 기다린다.
                서로 말하지 못한 비밀이 있다.

                늦은 밤 정류장. 가로등 하나가 깜빡인다.

                도담: 버스 왔어?
                세찬: 아직.
                도담: 늦네.
                세찬: 그러게. 오디션은 어땠어?""");

        assertThat(label(result, 1)).isEqualTo("IGNORE");
        assertThat(label(result, 2)).isEqualTo("IGNORE");
        assertThat(label(result, 4)).isEqualTo("IGNORE");
        assertThat(label(result, 5)).isEqualTo("IGNORE");
        assertThat(label(result, 6)).isEqualTo("IGNORE");
        assertThat(label(result, 8)).isEqualTo("DIRECTION");
        assertThat(label(result, 10)).isEqualTo("도담");
        assertThat(label(result, 13)).isEqualTo("세찬");
    }

    @Test
    void auditionGuideAndRoleLinesBeforeTheFirstSpeechAreIgnored() {
        RuleSplit.Result result = full("""
                창작뮤지컬 〈초록 신호〉
                ‘도담’ 역
                대사는 입에 붙지 않으면 편하게 바꿔도 됩니다.

                도담: 신호 바뀌었어.
                세찬: 뛰자.
                도담: 늦겠다.
                세찬: 빨리.""");

        assertThat(label(result, 1)).isEqualTo("IGNORE");
        assertThat(label(result, 2)).isEqualTo("IGNORE");
        assertThat(label(result, 3)).isEqualTo("IGNORE");
        assertThat(label(result, 5)).isEqualTo("도담");
    }

    @Test
    void frontMatterStopsAtTheFirstSpeech() {
        RuleSplit.Result result = full("""
                도담: 버스 왔어?
                세찬: 아직. 연출 선생님이 늦는대.
                도담: 공연 날인데.
                세찬: 그러게.""");

        assertThat(label(result, 2)).isEqualTo("세찬");
        assertThat(label(result, 3)).isEqualTo("도담");
    }

    @Test
    void scoreChordsTempoAndSongPartsAreIgnoredButSungLinesStay() {
        RuleSplit.Result result = full("""
                M01. 첫눈
                | Am | F | C | G |
                Verse 1
                ♩=96
                도담: 눈이 와요
                하얗게 내려와요
                세찬: 손을 잡아요
                따뜻하게 잡아요
                도담: 같이 걸어요
                세찬: 천천히 걸어요""");

        assertThat(label(result, 2)).isEqualTo("IGNORE");
        assertThat(label(result, 3)).isEqualTo("IGNORE");
        assertThat(label(result, 4)).isEqualTo("IGNORE");
        assertThat(label(result, 5)).isEqualTo("도담");
        assertThat(label(result, 6)).isEqualTo("도담");
        assertThat(label(result, 7)).isEqualTo("세찬");
        assertThat(label(result, 8)).isEqualTo("세찬");
    }

    @Test
    void lyricsUnderANameLineStayThatRolesSpeech() {
        RuleSplit.Result result = full("""
                M02. 겨울밤

                도담
                별이 떠요
                C  G  Am  F
                하늘 가득 떠요

                세찬
                달도 떠요
                우리 위에 떠요

                도담
                같이 봐요

                세찬
                그래요

                도담
                손 잡아요

                세찬
                꼭 잡아요""");

        assertThat(label(result, 4)).isEqualTo("도담");
        assertThat(label(result, 5)).isEqualTo("IGNORE");
        assertThat(label(result, 6)).isEqualTo("도담");
        assertThat(label(result, 9)).isEqualTo("세찬");
        assertThat(label(result, 10)).isEqualTo("세찬");
    }

    @Test
    void singerLineUnderASongHeadIsIgnored() {
        RuleSplit.Result result = full("""
                M03. 별
                - 도담, 세찬
                도담: 별이 떠요
                세찬: 달도 떠요
                도담: 같이 봐요
                세찬: 그래요""");

        assertThat(label(result, 2)).isEqualTo("IGNORE");
        assertThat(label(result, 3)).isEqualTo("도담");
        assertThat(label(result, 4)).isEqualTo("세찬");
    }

    @Test
    void brokenSymbolLinesAreIgnored() {
        RuleSplit.Result result = full("""
                도담: 여기야.
                |      {   =   |
                세찬: 어디?
                도담: 여기라니까.
                세찬: 안 보여.""");

        assertThat(label(result, 2)).isEqualTo("IGNORE");
        assertThat(label(result, 3)).isEqualTo("세찬");
    }

    // ── 머리 모양·번호 배역·끝부분 ─────────────────────────

    @Test
    void firstWordsOutsideTheDominantHeadShapeDoNotBecomeNames() {
        // 대사는 「한 칸 들여 이름 + 두 칸」, 이어지는 대사는 세 칸 들여, 지문은 들여쓰기 없이
        RuleSplit.Result result = full("""
                 민지  저 아직 음식 못 받았는데요?!
                 수아  나도 못 받았어.
                 민지  누가 먼저 먹은 거야?
                 수아  모르지.
                 민지  우리 중에.. 진짜 AI가 있긴 할까요?
                   빨리 이 모든 게 끝났으면 좋겠어요.
                 수아  나도 그래.

                쓰러진 민지를 내려다본다.

                 수아  일어나 봐.
                   빨리 일어나.
                 민지  (눈을 뜨며) 왜.
                 수아  다행이다.

                쓰러진 의자를 일으켜 세운다.

                 민지  이제 가자.
                   빨리 가자.""");

        assertThat(result.roster()).containsExactly("민지", "수아");
        assertThat(label(result, 6)).isEqualTo("민지");
        assertThat(label(result, 9)).isEqualTo("DIRECTION");
        assertThat(label(result, 12)).isEqualTo("수아");
        assertThat(label(result, 16)).isEqualTo("DIRECTION");
        assertThat(label(result, 19)).isEqualTo("민지");
    }

    @Test
    void numberedRolesOfAConfirmedFamilyAreNamesEvenOnce() {
        RuleSplit.Result result = full("""
                 수아  여기가 어디야?
                 민지  모르겠어.
                 참가자 9  내가 진짜 AI라고 생각하는 거예요?
                 참가자 13 계속 거짓말만 했잖아.
                 참가자 12 맞아. 앞뒤가 맞아야 믿지!
                 참가자 9  아니 기억이 안 났다니까?!
                 수아  다들 그만해요.
                 진행자  판별을 진행하겠습니다.
                 참가자 12 난 반대야.
                 참가자 13 나도.
                 민지  나는 찬성.
                 진행자  동의하십니까?
                 수아  잠깐만요.
                 참가자 7 누가 목숨 걸고 실험하고 싶다고 했어.
                 진행요원 1 물러나십시오.
                 진행자  계속하겠습니다.
                 민지  무서워.
                 수아  괜찮아.
                 진행요원 2 식사는 인간의 수만큼만 준비됩니다.
                 민지  배고파.
                 수아  나도.
                 참가자 11 난 나갑니다.
                 진행자  좋습니다.
                 민지  나도 나갈래.
                 수아  같이 가.""");

        assertThat(result.roster()).contains("참가자 7", "참가자 11", "진행요원 1", "진행요원 2")
                .doesNotContain("참가자", "진행요원");
        assertThat(label(result, 14)).isEqualTo("참가자 7");
        assertThat(label(result, 15)).isEqualTo("진행요원 1");
        assertThat(label(result, 19)).isEqualTo("진행요원 2");
        assertThat(label(result, 22)).isEqualTo("참가자 11");
    }

    @Test
    void aColonLineAfterTheLastSpeechIsWorkInfoNotARole() {
        RuleSplit.Result result = full("""
                민지 저 아직 음식 못 받았는데요?
                수아 나도 못 받았어.
                민지 누가 먼저 먹은 거야?
                수아 모르지.
                민지 이제 끝났으면 좋겠어.
                수아 나도 그래.

                분류 : 인공지능 (AI)
                외부 배치 승인""");

        assertThat(result.roster()).containsExactly("민지", "수아");
        assertThat(label(result, 6)).isEqualTo("수아");
        assertThat(label(result, 8)).isEqualTo("IGNORE");
        assertThat(label(result, 9)).isEqualTo("IGNORE");
    }

    @Test
    void scriptsWrittenWithOneSpaceAfterTheNameKeepTheirNames() {
        RuleSplit.Result result = full("""
                민수 안녕.
                지영 응 안녕.
                민수  밥 먹었어?
                지영 아니 아직.
                민수 같이 먹자.
                지영 좋아.
                하준 나도 갈래.
                민수 그래 같이 가.
                하준 고마워.""");

        assertThat(result.roster()).containsExactly("민수", "지영", "하준");
        assertThat(label(result, 7)).isEqualTo("하준");
    }

    @Test
    void aShortWideGapScriptFullOfNumberedRolesKeepsItsHeadShape() {
        String raw = """
                S#1. 실험실. 밤

                연구원들이 모여 있다.
                진행자가 앞으로 나선다.

                 하윤  여기가 어디예요?
                 도겸  나도 몰라. 눈 떠 보니 여기였어.
                 하윤  문이 잠겼어요.
                   빨리 나가고 싶어요.
                 참가자 3 우리 다 같은 처지예요.
                 도겸  누구세요?
                 참가자 3 저도 방금 깼어요.
                 참가자 5 다들 진정해요.
                 하윤  어떻게 진정해요!
                   빨리 문 열어 주세요.
                 참가자 5 소리 지르지 마요.

                쓰러진 참가자 5의 손이 떨린다.
                 진행요원 1 자리로 돌아가십시오.
                 도겸  싫은데요.
                 진행요원 2 경고합니다.
                 하윤  도겸 씨, 그만해요.
                   빨리 앉아요.
                 도겸  알았어.

                쓰러진 도겸을 하윤이 부축한다.
                 하윤  괜찮아요?
                 도겸  응.

                분류 : 스릴러 (단막)
                """;
        java.util.List<NumberedLine> lines = RuleSplit.unwrap(NumberedLine.of(raw));
        lines = RuleSplit.splitTurns(lines, new java.util.HashSet<>(RuleSplit.full(lines, true).roster()));
        RuleSplit.Result result = RuleSplit.full(lines, true);

        assertThat(result.roster()).containsExactly("하윤", "도겸", "참가자 3", "참가자 5", "진행요원 1", "진행요원 2");
        assertThat(label(result, 9)).isEqualTo("하윤");
        assertThat(label(result, 15)).isEqualTo("하윤");
        assertThat(label(result, 18)).isEqualTo("DIRECTION");
        assertThat(label(result, 19)).isEqualTo("진행요원 1");
        assertThat(label(result, 21)).isEqualTo("진행요원 2");
        assertThat(label(result, 23)).isEqualTo("하윤");
        assertThat(label(result, 30)).isEqualTo("IGNORE");
    }
}
