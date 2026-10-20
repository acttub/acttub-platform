package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.feature.reading.domain.SplitResponse.Kind;
import com.acttub.actingapi.feature.reading.domain.SplitResponse.Row;
import com.acttub.actingapi.platform.schema.CharacterAgeBand;
import com.acttub.actingapi.platform.schema.CharacterGender;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class SplitDraftTest {

    @Test
    @DisplayName("SOMA-593 7-2 9번: 머리를 뗀 대사, 블록 형식의 이어지는 줄 합치기, 판정 없는 줄은 지문, 제목·등장인물·무시 줄은 대본 밖, 장면 머리는 모델이 머리라 해도 통째로")
    void assemblesBlockFormatAndStripsHeaders() {
        String raw = """
                봄날의 끝
                등장인물: 지수, 민호

                S#1 거실

                지수
                (문을 열며) 왔어?
                늦었네.
                민호: 미안.
                민호: 차가 막혔어.
                이상한 줄
                2
                """;
        List<NumberedLine> lines = NumberedLine.of(raw);
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.TITLE, "", ""));
        rows.put(2, new Row(2, Kind.CAST, "", ""));
        rows.put(4, new Row(4, Kind.SCENE, "", "S#1 "));
        rows.put(6, new Row(6, Kind.IGNORE, "", ""));
        rows.put(7, new Row(7, Kind.DIALOGUE, "지수", ""));
        rows.put(8, new Row(8, Kind.DIALOGUE, "지수", ""));
        rows.put(9, new Row(9, Kind.DIALOGUE, "민호", "민호: "));
        rows.put(10, new Row(10, Kind.DIALOGUE, "민호", "민호: "));
        rows.put(12, new Row(12, Kind.IGNORE, "", ""));

        ScriptDraft draft = SplitDraft.assemble(null, raw, "paste", lines, rows, List.of("지수", "민호"));

        assertThat(draft.title()).isEqualTo("봄날의 끝");
        assertThat(draft.characterNames()).containsExactly("지수", "민호");
        assertThat(draft.lines()).containsExactly(
                new ScriptDraft.Line(1, "scene", null, "S#1 거실"),
                new ScriptDraft.Line(2, "dialogue", 0, "(문을 열며) 왔어? 늦었네."),
                new ScriptDraft.Line(3, "dialogue", 1, "미안."),
                new ScriptDraft.Line(4, "dialogue", 1, "차가 막혔어."),
                new ScriptDraft.Line(5, "direction", null, "이상한 줄"));
    }

    @Test
    @DisplayName("SOMA-739: 제목을 비우고 붙여넣은 블록 형식 대본은 첫 줄 화자 이름(민수)을 제목으로 쓰지 않는다")
    void speakerNameLineIsNotUsedAsFallbackTitle() {
        String raw = """
                민수
                오늘 비 온대.
                지수
                우산 챙겨.
                """;
        List<NumberedLine> lines = NumberedLine.of(raw);
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.IGNORE, "", ""));
        rows.put(2, new Row(2, Kind.DIALOGUE, "민수", ""));
        rows.put(3, new Row(3, Kind.IGNORE, "", ""));
        rows.put(4, new Row(4, Kind.DIALOGUE, "지수", ""));

        ScriptDraft draft = SplitDraft.assemble(null, raw, "paste", lines, rows, List.of("민수", "지수"));

        assertThat(draft.title()).isEqualTo("오늘 비 온대.");
    }

    @Test
    @DisplayName("배역 순서: 등장인물 소개 줄에 나온 순이 먼저고, 거기 없는 배역은 대사 많은 순(같으면 먼저 말한 순)")
    void ordersCharactersByCastListThenDialogueCount() {
        String raw = """
                나오는 사람들 — 태오, 윤서
                하나: 안녕
                윤서: 안녕
                둘: 안녕
                태오: 안녕
                둘: 또 안녕
                """;
        List<NumberedLine> lines = NumberedLine.of(raw);
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.CAST, "", ""));
        rows.put(2, new Row(2, Kind.DIALOGUE, "하나", "하나: "));
        rows.put(3, new Row(3, Kind.DIALOGUE, "윤서", "윤서: "));
        rows.put(4, new Row(4, Kind.DIALOGUE, "둘", "둘: "));
        rows.put(5, new Row(5, Kind.DIALOGUE, "태오", "태오: "));
        rows.put(6, new Row(6, Kind.DIALOGUE, "둘", "둘: "));

        ScriptDraft draft = SplitDraft.assemble("제목", raw, "paste", lines, rows, List.of());

        assertThat(draft.characterNames()).containsExactly("태오", "윤서", "둘", "하나");
        assertThat(draft.lines().get(0).characterIndex()).isEqualTo(3);
    }

    @Test
    @DisplayName("모델이 머리를 비워 보냈어도 줄이 배역 이름과 구분 부호로 시작하면 머리를 뗀다. 이름 뒤에 조사가 붙은 대사는 그대로다")
    void infersAMissingHeaderOnlyBeforeASeparator() {
        String raw = "MARA. (sitting) Did it answer?\n[지수] 왔어?\n지수야, 왔어?\n지수： 응.";
        Map<Integer, Row> rows = Map.of(
                1, new Row(1, Kind.DIALOGUE, "MARA", ""),
                2, new Row(2, Kind.DIALOGUE, "지수", ""),
                3, new Row(3, Kind.DIALOGUE, "민호", ""),
                4, new Row(4, Kind.DIALOGUE, "지수", ""));

        ScriptDraft draft = SplitDraft.assemble("t", raw, "paste", NumberedLine.of(raw), rows, List.of());

        assertThat(draft.lines()).extracting(ScriptDraft.Line::text)
                .containsExactly("(sitting) Did it answer?", "왔어?", "지수야, 왔어?", "응.");
    }

    @Test
    @DisplayName("SOMA-663: 모델이 머리를 비워도 배역 이름 뒤가 공백·탭·U+3000이면 뗀다. 한 글자 이름은 탭·U+3000·공백 두 칸 이상일 때만")
    void infersAMissingHeaderBeforeWhitespace() {
        String raw = "혜진 이준호!!\n경민\t\t그 쪽지.\n설정주\u3000 잠깐만.\n나 갈래\n나\t갈래\n나  안 가";
        Map<Integer, Row> rows = Map.of(
                1, new Row(1, Kind.DIALOGUE, "혜진", ""),
                2, new Row(2, Kind.DIALOGUE, "경민", ""),
                3, new Row(3, Kind.DIALOGUE, "설정주", ""),
                4, new Row(4, Kind.DIALOGUE, "나", ""),
                5, new Row(5, Kind.DIALOGUE, "나", ""),
                6, new Row(6, Kind.DIALOGUE, "나", ""));

        ScriptDraft draft = SplitDraft.assemble("t", raw, "paste", NumberedLine.of(raw), rows, List.of());

        assertThat(draft.lines()).extracting(ScriptDraft.Line::text)
                .containsExactly("이준호!!", "그 쪽지.", "잠깐만.", "나 갈래", "갈래", "안 가");
    }

    @Test
    @DisplayName("SOMA-663: 머리를 찾은 줄은 같은 배역이어도 새 대사다. 이름 없는 이어지는 줄과 들여 쓴 줄은 앞 대사에 붙는다")
    void aLineWithAFoundHeaderStartsANewSpeech() {
        String raw = "혜진 이준호!!\n혜진 너 애들 가르치는게 장난이야??\n규원\t하고 기가 막혀서 웃기지도 않는다.\n이게 일억 팔천이래.\nMARA. Did it answer?\nMARA. No."
                + "\n리나 그게 너무 속상해요.\n        리나 맘 모르시죠?";
        Map<Integer, Row> rows = Map.of(
                1, new Row(1, Kind.DIALOGUE, "혜진", ""),
                2, new Row(2, Kind.DIALOGUE, "혜진", ""),
                3, new Row(3, Kind.DIALOGUE, "규원", ""),
                4, new Row(4, Kind.DIALOGUE, "규원", ""),
                5, new Row(5, Kind.DIALOGUE, "MARA", ""),
                6, new Row(6, Kind.DIALOGUE, "MARA", ""),
                7, new Row(7, Kind.DIALOGUE, "리나", ""),
                8, new Row(8, Kind.DIALOGUE, "리나", ""));

        ScriptDraft draft = SplitDraft.assemble("t", raw, "paste", NumberedLine.of(raw), rows, List.of());

        assertThat(draft.lines()).extracting(ScriptDraft.Line::text).containsExactly(
                "이준호!!", "너 애들 가르치는게 장난이야??", "하고 기가 막혀서 웃기지도 않는다. 이게 일억 팔천이래.", "Did it answer?", "No.",
                "그게 너무 속상해요. 리나 맘 모르시죠?");
    }

    @Test
    @DisplayName("SOMA-663: 「- 27 -」만 있는 쪽 번호 줄은 모델이 대사·지문이라 해도 대본 줄에 넣지 않고, 앞뒤 대사는 이어진다")
    void dropsPageNumberLinesWhateverTheModelSays() {
        String raw = "아내: 저런 인간보다 못한 인간하고\n- 27 -\n살고 있다니.\n\u200B— 28 —\n남편: 그만해.";
        Map<Integer, Row> rows = Map.of(
                1, new Row(1, Kind.DIALOGUE, "아내", "아내: "),
                2, new Row(2, Kind.DIALOGUE, "아내", ""),
                3, new Row(3, Kind.DIALOGUE, "아내", ""),
                4, new Row(4, Kind.DIRECTION, "", ""),
                5, new Row(5, Kind.DIALOGUE, "남편", "남편: "));

        ScriptDraft draft = SplitDraft.assemble("t", raw, "paste", NumberedLine.of(raw), rows, List.of());

        assertThat(draft.lines()).extracting(ScriptDraft.Line::text)
                .containsExactly("저런 인간보다 못한 인간하고 살고 있다니.", "그만해.");
    }

    @Test
    @DisplayName("SOMA-663: 지문이라 한 줄도 아는 배역 이름 + 탭·U+3000·공백 세 칸 뒤에 대사가 있으면 그 배역 대사다. 괄호 지문만 있으면 지문이다")
    void aDirectionShapedLikeNameTabSpeechIsDialogue() {
        String raw = "베니\t그래.\n베니\t\t(무너진다.) 안돼!!!\n양 베드로   아주 대단한 결심.\n연출        [방백] 다시 가요.\n베니\t(노래한다)"
                + "\n베니\t[무대 밑에서]\n베니\t(아무 반응을 보이지 않는다 눈을\n베니  부인이 침대로 간다.\n모르는\t사람이 온다.\n트리니\t(웃는다) 좋아.\n베니: 응.";
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.DIRECTION, "", ""));
        rows.put(2, new Row(2, Kind.DIRECTION, "", ""));
        rows.put(3, new Row(3, Kind.DIRECTION, "", ""));
        // 4번 줄은 판정이 없다
        for (int no = 5; no <= 10; no++) {
            rows.put(no, new Row(no, Kind.DIRECTION, "", ""));
        }
        rows.put(11, new Row(11, Kind.DIALOGUE, "베니", "베니: ")); // 베니는 대사에서, 나머지는 배역 목록에서 안다

        ScriptDraft draft = SplitDraft.assemble("t", raw, "paste", NumberedLine.of(raw), rows, List.of("양 베드로", "연출", "트리니"));

        assertThat(draft.lines()).extracting(line -> line.kind() + "|"
                + (line.characterIndex() == null ? "" : draft.characterNames().get(line.characterIndex())) + "|" + line.text())
                .containsExactly(
                        "dialogue|베니|그래.", "dialogue|베니|(무너진다.) 안돼!!!", "dialogue|양 베드로|아주 대단한 결심.",
                        "dialogue|연출|[방백] 다시 가요.", "direction||베니\t(노래한다)", "direction||베니\t[무대 밑에서]",
                        "direction||베니\t(아무 반응을 보이지 않는다 눈을", "direction||베니  부인이 침대로 간다.",
                        "direction||모르는\t사람이 온다.", "dialogue|트리니|(웃는다) 좋아.", "dialogue|베니|응.");
    }

    @Test
    @DisplayName("SOMA-663: 블록 대사의 줄을 이을 때 단어 중간에서 끊긴 자리는 붙이고, 노래 구절·단어 경계는 띄운다")
    void joinsWordsBrokenAtALineEnd() {
        // 줄 끝 → 다음 줄 머리, 기대하는 이음
        String[][] cases = {
                {"살아가는 법", "을 모르잖아요", "살아가는 법을 모르잖아요"},          // 조사
                {"숨었", "다.", "숨었다."},                                           // 받침 ㅆ
                {"해준 적 있", "어요?", "해준 적 있어요?"},
                {"그래", "서 말이야", "그래서 말이야"},                                // 같은 대본에 「그래서」
                {"오, 오, 오", "잠을 깨면", "오, 오, 오 잠을 깨면"},                   // 노래 구절
                {"2년이", "다 됐네", "2년이 다 됐네"},                                 // 혼자 단어로도 흔한 「다」
                {"빨리", "와", "빨리 와"},
                {"그", "사람이 왔어", "그 사람이 왔어"},                               // 같은 대본에 「그 사람이」
                {"굿모닝 볼티모어", "와~ 날", "굿모닝 볼티모어 와~ 날"},              // 감탄사 줄
                {"쓸 ", "데 없는 소리", "쓸 데 없는 소리"},                            // 원문이 줄 끝을 띄움
                {"안녕.", "다음에 봐", "안녕. 다음에 봐"},                             // 문장부호로 끝남
        };
        StringBuilder raw = new StringBuilder("그래서 왔어. 그 사람이 왔다. 볼티모어와 날. 쓸데 없다.\n");
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.DIRECTION, "", ""));
        for (int i = 0; i < cases.length; i++) {
            String speaker = i % 2 == 0 ? "지수" : "민호";
            raw.append(cases[i][0]).append('\n').append(cases[i][1]).append('\n');
            rows.put(2 * i + 2, new Row(2 * i + 2, Kind.DIALOGUE, speaker, ""));
            rows.put(2 * i + 3, new Row(2 * i + 3, Kind.DIALOGUE, speaker, ""));
        }

        ScriptDraft draft = SplitDraft.assemble("t", raw.toString(), "paste", NumberedLine.of(raw.toString()), rows, List.of());

        assertThat(draft.lines().subList(1, draft.lines().size())).extracting(ScriptDraft.Line::text)
                .containsExactly(Arrays.stream(cases).map(c -> c[2]).toArray(String[]::new));
    }

    @Test
    @DisplayName("줄 앞의 U+200B·BOM 은 저장되는 글과 제목에 남지 않는다")
    void invisibleCharactersDoNotSurvive() {
        String raw = "\uFEFF\u200B반지하 라디오\n\u200B(낡은 라디오에서 잡음이 난다.)\n\u200B하은: 오빠, 그거 고장 난 거 아니야?";
        Map<Integer, Row> rows = Map.of(
                2, new Row(2, Kind.DIRECTION, "", ""),
                3, new Row(3, Kind.DIALOGUE, "하은", "\u200B하은: "));

        ScriptDraft draft = SplitDraft.assemble(null, raw, "paste", NumberedLine.of(raw), rows, List.of());

        assertThat(draft.title()).isEqualTo("반지하 라디오");
        assertThat(draft.lines()).containsExactly(
                new ScriptDraft.Line(1, "direction", null, "반지하 라디오"),
                new ScriptDraft.Line(2, "direction", null, "(낡은 라디오에서 잡음이 난다.)"),
                new ScriptDraft.Line(3, "dialogue", 0, "오빠, 그거 고장 난 거 아니야?"));
    }

    @Test
    @DisplayName("배역 이름은 목록으로 바로잡아 저장하고, 모델이 쓴 제목이 없으면 첫 줄이 제목이다. 배역이 없으면 빈 배역 목록이다")
    void fixesNamesAndFallsBackToFirstLineTitle() {
        String raw = "맥베스: 내일, 또 내일.\n맥베س: 그리고 또 내일.";
        List<NumberedLine> lines = NumberedLine.of(raw);
        Map<Integer, Row> rows = Map.of(
                1, new Row(1, Kind.DIALOGUE, "맥베스", "맥베스: "),
                2, new Row(2, Kind.DIALOGUE, "맥베س", "맥베س: "));

        ScriptDraft draft = SplitDraft.assemble(" ", raw, "file", lines, rows, List.of("맥베스"));

        assertThat(draft.title()).isEqualTo("맥베스: 내일, 또 내일.");
        assertThat(draft.characterNames()).containsExactly("맥베스");
        assertThat(draft.lines()).containsExactly(
                new ScriptDraft.Line(1, "dialogue", 0, "내일, 또 내일."),
                new ScriptDraft.Line(2, "dialogue", 0, "그리고 또 내일."));

        ScriptDraft prose = SplitDraft.assemble(null, "어느 날 밤이었다.", "paste", NumberedLine.of("어느 날 밤이었다."),
                Map.of(1, new Row(1, Kind.DIRECTION, "", "")), List.of());
        assertThat(prose.characterNames()).isEmpty();
        assertThat(prose.lines()).containsExactly(new ScriptDraft.Line(1, "direction", null, "어느 날 밤이었다."));
    }

    @Test
    @DisplayName("SOMA-663: 원문에 화자 머리로 쓰인 이름은 편집 거리 1인 목록 이름으로 바꾸지 않는다 — 할아버지는 아버지가 아니다")
    void aNameUsedAsAHeaderIsNotMergedIntoANearbyRosterName() {
        String raw = "할아버지 : 에엥?\n아버지 : 왜요?\n원삼처        뭐 해?\n원삼        딸기 먹자.\n검사1\n손 들어.\n형사1: 움직이지 마.";
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.DIALOGUE, "할아버지", "할아버지 : "));
        rows.put(2, new Row(2, Kind.DIALOGUE, "아버지", "아버지 : "));
        rows.put(3, new Row(3, Kind.DIALOGUE, "원삼처", "원삼처        "));
        rows.put(4, new Row(4, Kind.DIALOGUE, "원삼", "원삼        "));
        rows.put(5, new Row(5, Kind.IGNORE, "", ""));
        rows.put(6, new Row(6, Kind.DIALOGUE, "검사1", ""));
        rows.put(7, new Row(7, Kind.DIALOGUE, "형사1", "형사1: "));

        ScriptDraft draft = SplitDraft.assemble("t", raw, "paste", NumberedLine.of(raw), rows, List.of("아버지", "원삼", "형사1"));

        assertThat(draft.characterNames()).containsExactlyInAnyOrder("할아버지", "아버지", "원삼처", "원삼", "검사1", "형사1");
    }

    @Test
    @DisplayName("SOMA-663: 원문에 없는 배역 이름은 그 줄의 머리 표기로, 머리가 이름이 아니면 원문에 있는 다른 배역 이름으로 바로잡는다")
    void aNameMissingFromTheSourceTakesTheHeaderSpelling() {
        String raw = "뜨레쁠레프 당신은 왜?\n메드베젠코: 그건 왜 그렇죠?\n맥베스 부인: 오세요.\n뜨레쁠레프 그래요.\n메드베젠코: 네.\n맥베스 부인: 가요.\n"
                + "(호수를 바라본다) 아, 좋은 곳입니다.\n- 그럼 보여 드리죠, 나딸리아 스쩨빠노브나.\n- 존경하는 분.\n- 네.";
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.DIALOGUE, "треpleф", "뜨레쁠레프 "));
        rows.put(2, new Row(2, Kind.DIALOGUE, "메д베зенko", "메드베젠코: "));
        rows.put(3, new Row(3, Kind.DIALOGUE, "레이디 맥베스", "맥베스 부인: "));
        rows.put(4, new Row(4, Kind.DIALOGUE, "뜨레쁠레프", "뜨레쁠레프 "));
        rows.put(5, new Row(5, Kind.DIALOGUE, "메드베젠코", "메드베젠코: "));
        rows.put(6, new Row(6, Kind.DIALOGUE, "맥베스 부인", "맥베스 부인: "));
        // 줄 바꿈으로 떨어진 대사 — 머리가 지문이라 이름으로 쓰지 않는다(재생 099)
        rows.put(7, new Row(7, Kind.DIALOGUE, "Дорн", "(호수를 바라본다) "));
        rows.put(8, new Row(8, Kind.DIALOGUE, "이완 바실례비치", "- "));
        rows.put(9, new Row(9, Kind.DIALOGUE, "나딸리아 스쩨빠노브на", "- "));
        rows.put(10, new Row(10, Kind.DIALOGUE, "나딸리아 스쩨빠노브나", "- "));

        ScriptDraft draft = SplitDraft.assemble("t", raw, "paste", NumberedLine.of(raw), rows, List.of());

        assertThat(draft.characterNames()).containsExactlyInAnyOrder("뜨레쁠레프", "메드베젠코", "맥베스 부인", "Дорн", "이완 바실례비치",
                "나딸리아 스쩨빠노브나");
        // 머리가 「- 」뿐이면 원문에 있는 다른 배역 이름에 맞춰 보고, 그것도 멀면(이완 바실례비치) 모델 이름 그대로다 — 지어내지 않는다
        assertThat(draft.lines()).extracting(line -> draft.characterNames().get(line.characterIndex()))
                .endsWith("이완 바실례비치", "나딸리아 스쩨빠노브나", "나딸리아 스쩨빠노브나");
    }

    @Test
    @DisplayName("SOMA-663: 한 대본에서 띄어쓰기·따옴표·화면 밖 목소리 꼬리·「여 」 머리·괄호 설명만 다른 화자는 대사 많은 표기로 묶는다. 내레이션은 묶지 않는다")
    void mergesSpeakersThatDifferOnlyByVoiceTailsAndSpacing() {
        String[][] said = {
                {"장석구", "가자."}, {"장석구 (소리)", "여보세요?"}, {"장석구", "응."},
                {"서린 목소리", "나야."}, {"서린", "왜?"},
                {"형사1", "손 들어."}, {"형사 1", "움직이지 마."}, {"형사 1", "꼼짝 마."},
                {"여주VO", "안녕."}, {"여주", "응."},
                {"유리(NA)", "그날은."}, {"유리", "안녕."}, {"유리의 내레이션", "그리고."}, {"김지훈NA", "그때."}, {"김지훈", "뭐야."},
                {"여자", "저기요."}, {"남자", "네."}, {"여 자", "있잖아요."},
                {"여 베이어드 (로드릭의 어머니)", "얘야."}, {"여 베이어드", "그래."},
                {"여기자‘", "질문."}, {"여기자’", "또."}, {"여기자", "저도요."},
                {"철수(30대)", "늦었다."}, {"철수", "가자."},
        };
        StringBuilder raw = new StringBuilder();
        Map<Integer, Row> rows = new LinkedHashMap<>();
        for (int i = 0; i < said.length; i++) {
            raw.append(said[i][0]).append(": ").append(said[i][1]).append('\n');
            rows.put(i + 1, new Row(i + 1, Kind.DIALOGUE, said[i][0], said[i][0] + ": "));
        }
        Map<String, CharacterTraits> traits = Map.of("장석구 (소리)", new CharacterTraits(CharacterGender.MALE, CharacterAgeBand.ADULT));

        ScriptDraft draft = SplitDraft.assemble("t", raw.toString(), "paste", NumberedLine.of(raw.toString()), rows, List.of(), traits);

        assertThat(draft.characterNames()).containsExactlyInAnyOrder("장석구", "서린", "형사 1", "여주", "유리(NA)", "유리", "유리의 내레이션",
                "김지훈NA", "김지훈", "여자", "남자", "여 베이어드", "여기자‘", "여기자", "철수");
        assertThat(draft.lines()).extracting(line -> draft.characterNames().get(line.characterIndex()))
                .startsWith("장석구", "장석구", "장석구", "서린", "서린", "형사 1", "형사 1", "형사 1", "여주", "여주");
        assertThat(draft.characterTraits().get(draft.characterNames().indexOf("장석구")))
                .as("묶인 이름의 성별·나이대는 남긴 이름으로 옮긴다").isEqualTo(new CharacterTraits(CharacterGender.MALE, CharacterAgeBand.ADULT));
    }

    @Test
    @DisplayName("SOMA-670: 모델이 준 성별·나이대를 배역 순서대로 싣는다 — 띄어쓰기만 다른 이름도 잇고, 없는 배역은 모름")
    void carriesTraitsInCharacterOrder() {
        String raw = "윤서: 안녕.\n태오: 응.\n로스: 어.\n";
        List<NumberedLine> lines = NumberedLine.of(raw);
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.DIALOGUE, "윤서", "윤서: "));
        rows.put(2, new Row(2, Kind.DIALOGUE, "태오", "태오: "));
        rows.put(3, new Row(3, Kind.DIALOGUE, "로스", "로스: "));
        Map<String, CharacterTraits> traits = Map.of(
                "윤서", new CharacterTraits(CharacterGender.FEMALE, CharacterAgeBand.YOUNG),
                "태 오", new CharacterTraits(CharacterGender.MALE, CharacterAgeBand.SENIOR));

        ScriptDraft draft = SplitDraft.assemble(null, raw, "paste", lines, rows, List.of(), traits);

        assertThat(draft.characterNames()).containsExactly("윤서", "태오", "로스");
        assertThat(draft.characterTraits()).containsExactly(
                new CharacterTraits(CharacterGender.FEMALE, CharacterAgeBand.YOUNG),
                new CharacterTraits(CharacterGender.MALE, CharacterAgeBand.SENIOR),
                CharacterTraits.UNKNOWN);
        assertThat(SplitDraft.assemble(null, raw, "paste", lines, rows, List.of()).characterTraits())
                .as("성별·나이대가 없으면 모두 모름").containsOnly(CharacterTraits.UNKNOWN);
    }
}
