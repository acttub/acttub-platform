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
    @DisplayName("SOMA-663 M8 N6: 원문이 줄 안 화자 머리로 쓴 함께 말하기 머리와 같은 꼴로 시작하는 머리 없는 대사는 그 함께 말하기 화자의 말이다")
    void restoresWrittenGroupHeads() {
        List<NumberedLine> lines = NumberedLine.of("""
                모두 ···
                아내 진실은,
                모두 고양이가 물어갔잖아!
                모두, 자기 발을 본다.
                모두  둘이 띄운 줄.
                모두 좋아해요.
                남편 너는 몰라도 우리 집 사람들은 그 얘기를 처음부터 끝까지
                모두 들었어.
                """);
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.DIALOGUE, "모두", ""));
        rows.put(2, new Row(2, Kind.DIALOGUE, "아내", ""));
        rows.put(3, new Row(3, Kind.DIALOGUE, "아내", ""));
        rows.put(4, new Row(4, Kind.DIRECTION, "", ""));
        rows.put(5, new Row(5, Kind.DIALOGUE, "아내", ""));
        rows.put(6, new Row(6, Kind.DIALOGUE, "아내, 남편", ""));
        rows.put(7, new Row(7, Kind.DIALOGUE, "남편", ""));
        rows.put(8, new Row(8, Kind.DIALOGUE, "남편", ""));
        Map<Integer, String> heads = Map.of(1, "모두", 2, "아내", 7, "남편");

        // 4 는 지문, 5 는 머리와 띄어쓰기가 다르고, 6 은 이미 함께 말하기 화자, 8 은 줄 너비에서 끊긴 앞 줄의 말을 잇는 줄이라 그대로다
        assertThat(SplitDraft.groupHeads(lines, rows, heads)).containsOnly(Map.entry(3, new Row(3, Kind.DIALOGUE, "모두", "모두 ")));

        // 함께 말하기 머리를 줄 안 화자 머리로 쓴 줄이 없으면(블록 형식의 이름 줄 「모두」 뿐이면) 본문 첫 낱말로 보고 둔다
        List<NumberedLine> block = NumberedLine.of("모두\n헤이 마마\n트레이시\n모두 최신 음악 맞춰 춤을 추죠\n");
        Map<Integer, Row> blockRows = new LinkedHashMap<>();
        blockRows.put(1, new Row(1, Kind.IGNORE, "", ""));
        blockRows.put(2, new Row(2, Kind.DIALOGUE, "모두", ""));
        blockRows.put(3, new Row(3, Kind.IGNORE, "", ""));
        blockRows.put(4, new Row(4, Kind.DIALOGUE, "트레이시", ""));
        assertThat(SplitDraft.groupHeads(block, blockRows, Map.of(2, "모두", 4, "트레이시"))).isEmpty();
    }

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

        assertThat(draft.title()).isEqualTo("제목 없는 대본");
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
    @DisplayName("SOMA-663 N1: 모델 머리가 이름을 넘어 대사·괄호 행동·여는 따옴표·호명·말줄임표까지 먹으면 이름과 구분 부호까지만 뗀다")
    void trimsAModelHeaderThatSwallowsTheSpeech() {
        String raw = "한지훈 : 그냥 오늘 연습은 그만하자. 오늘은 못할\n것 같아. 니네들끼리 알아서해. (드러누워 버린다)\n"
                + "처녀 (겁을 집어먹고) 그만하세요\n테클라 [당황하며] 안 될 게 뭐 있나요?\n김현정\n박 선생님. 증거는 아닙니다.\n"
                + "“당신은 나 때문에 살았어.”\n한여름  ...나도.\n민성(소리)\t둘이 무슨 얘기해?\n선생: (꿈꾸듯) 나도 알아요.";
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.DIALOGUE, "한지훈", "한지훈 : "));
        rows.put(2, new Row(2, Kind.DIALOGUE, "한지훈", "것 같아. 니네들끼리 알아서해."));
        rows.put(3, new Row(3, Kind.DIALOGUE, "처녀", "처녀 (겁을 집어먹고) "));
        rows.put(4, new Row(4, Kind.DIALOGUE, "테클라", "테클라 ["));
        rows.put(5, new Row(5, Kind.IGNORE, "", ""));
        rows.put(6, new Row(6, Kind.DIALOGUE, "김현정", "박 선생님. "));
        rows.put(7, new Row(7, Kind.DIALOGUE, "서윤", "“"));
        rows.put(8, new Row(8, Kind.DIALOGUE, "한여름", "한여름  ."));
        rows.put(9, new Row(9, Kind.DIALOGUE, "민성", "민성"));
        rows.put(10, new Row(10, Kind.DIALOGUE, "선생", "선생: (꿈꾸듯) "));

        ScriptDraft draft = SplitDraft.assemble("t", raw, "paste", NumberedLine.of(raw), rows, List.of());

        assertThat(draft.lines()).extracting(ScriptDraft.Line::text).containsExactly(
                "그냥 오늘 연습은 그만하자. 오늘은 못할 것 같아. 니네들끼리 알아서해. (드러누워 버린다)", "(겁을 집어먹고) 그만하세요",
                "[당황하며] 안 될 게 뭐 있나요?", "박 선생님. 증거는 아닙니다.", "“당신은 나 때문에 살았어.”", "...나도.", "(소리)", "둘이 무슨 얘기해?",
                "(꿈꾸듯) 나도 알아요.");
    }

    @Test
    @DisplayName("SOMA-663 N1: 모델이 머리를 비워도 줄인 이름·띄어 쓴 이름·목소리 표시·함께 말하기 머리는 뗀다. 한 글자·줄인 이름에 공백 한 칸이면 그 화자 줄에서 흔한 머리일 때만")
    void findsAShortenedOrSpacedHeaderTheModelLeftEmpty() {
        String raw = "해온 집에 없는 건가.\n해온 왜.\n윤 (도현을 보며) 누구?\n윤 아니야.\n모\t두\t성부와, 성자와.\n"
                + "서윤 씨 어디 가?\n지수 너 왜 그래\n엄마E (닫힌 문 너머로) 밥 먹어!\n경진 (소리만) 저희 다음 기수도.\n둘다   (큰 소리로) 언니!!!"
                + "\n네. 루이스 할머니가 고맙대요.\n[일본군 기 이소가 키에타.\n(제혁 NA) 와 이거 진짜 나인 것 같네.\n(빅토르 모드) 아니, 왜 늦어?";
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.DIALOGUE, "윤해온", ""));
        rows.put(2, new Row(2, Kind.DIALOGUE, "윤해온", ""));
        rows.put(3, new Row(3, Kind.DIALOGUE, "윤", ""));
        rows.put(4, new Row(4, Kind.DIALOGUE, "윤", ""));
        rows.put(5, new Row(5, Kind.DIALOGUE, "모두", ""));
        rows.put(6, new Row(6, Kind.DIALOGUE, "한서윤", ""));
        rows.put(7, new Row(7, Kind.DIALOGUE, "민호", ""));
        rows.put(8, new Row(8, Kind.DIALOGUE, "엄마", ""));
        rows.put(9, new Row(9, Kind.DIALOGUE, "서경진", "경진 (소리만) "));
        rows.put(10, new Row(10, Kind.DIALOGUE, "나봉, 오봉", ""));
        rows.put(11, new Row(11, Kind.DIALOGUE, "여 제네뵈브", ""));
        rows.put(12, new Row(12, Kind.DIALOGUE, "일본군 기", ""));
        rows.put(13, new Row(13, Kind.DIALOGUE, "제혁", ""));
        rows.put(14, new Row(14, Kind.DIALOGUE, "빅토르", "(빅토르 "));

        ScriptDraft draft = SplitDraft.assemble("t", raw, "paste", NumberedLine.of(raw), rows, List.of());

        // 「서윤 씨」는 한서윤 줄에 한 번뿐이라 머리로 보지 않는다. 「지수」는 화자 이름과 이어지지 않는다
        assertThat(draft.lines()).extracting(ScriptDraft.Line::text).containsExactly(
                "집에 없는 건가.", "왜.", "(도현을 보며) 누구?", "아니야.", "성부와, 성자와.", "서윤 씨 어디 가?", "지수 너 왜 그래",
                "(닫힌 문 너머로) 밥 먹어!", "(소리만)", "저희 다음 기수도.", "(큰 소리로) 언니!!!",
                "네. 루이스 할머니가 고맙대요.", "이소가 키에타.", "와 이거 진짜 나인 것 같네.", "(빅토르 모드) 아니, 왜 늦어?");
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
                1, new Row(1, Kind.TITLE, "", ""),
                2, new Row(2, Kind.DIRECTION, "", ""),
                3, new Row(3, Kind.DIALOGUE, "하은", "\u200B하은: "));

        ScriptDraft draft = SplitDraft.assemble(null, raw, "paste", NumberedLine.of(raw), rows, List.of());

        assertThat(draft.title()).isEqualTo("반지하 라디오");
        assertThat(draft.lines()).containsExactly(
                new ScriptDraft.Line(1, "direction", null, "(낡은 라디오에서 잡음이 난다.)"),
                new ScriptDraft.Line(2, "dialogue", 0, "오빠, 그거 고장 난 거 아니야?"));
    }

    @Test
    @DisplayName("배역 이름은 목록으로 바로잡아 저장하고, 제목도 파일명도 없으면 제목 없는 대본이다. 배역이 없으면 빈 배역 목록이다")
    void fixesNamesAndFallsBackToUntitledScript() {
        String raw = "맥베스: 내일, 또 내일.\n맥베س: 그리고 또 내일.";
        List<NumberedLine> lines = NumberedLine.of(raw);
        Map<Integer, Row> rows = Map.of(
                1, new Row(1, Kind.DIALOGUE, "맥베스", "맥베스: "),
                2, new Row(2, Kind.DIALOGUE, "맥베س", "맥베س: "));

        ScriptDraft draft = SplitDraft.assemble(" ", raw, "file", lines, rows, List.of("맥베스"));

        assertThat(draft.title()).isEqualTo("제목 없는 대본");
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
    @DisplayName("SOMA-663 C2: 모델이 맞힌 함께 말하는 배역들은 머리 표기(「셋」·「미,동」)나 첫 이름으로 줄이지 않는다")
    void aGroupOfKnownSpeakersKeepsEveryone() {
        String raw = "미나네    가자.\n순이네    응.\n동진네    그래.\n셋        응, 어디 가?\n미,동     쉿, 조용히 해.\n미,동     가자.\n셋        맛있네.";
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.DIALOGUE, "미나네", "미나네    "));
        rows.put(2, new Row(2, Kind.DIALOGUE, "순이네", "순이네    "));
        rows.put(3, new Row(3, Kind.DIALOGUE, "동진네", "동진네    "));
        rows.put(4, new Row(4, Kind.DIALOGUE, "미나네, 순이네, 동진네", ""));
        rows.put(5, new Row(5, Kind.DIALOGUE, "미나네,동진네", "미,동     "));
        rows.put(6, new Row(6, Kind.DIALOGUE, "미,동", "미,동     "));
        rows.put(7, new Row(7, Kind.DIALOGUE, "셋", "셋        "));

        ScriptDraft draft = SplitDraft.assemble("t", raw, "paste", NumberedLine.of(raw), rows, List.of("미나네", "순이네", "동진네"));

        assertThat(draft.lines()).extracting(line -> draft.characterNames().get(line.characterIndex()))
                .containsExactly("미나네", "순이네", "동진네", "미나네, 순이네, 동진네", "미나네,동진네", "미,동", "셋");
    }

    @Test
    @DisplayName("SOMA-709 2번: 화면 밖 목소리 꼬리표는 이름에서 떼어 그 대사 앞 지문으로 남기고, 공백만 다른 이름은 합치며, 숫자가 다른 머리는 다른 배역이다")
    void voiceTagsBecomeDirectionsAndNumbersStayApart() {
        String raw = """
                강 국장: 들어와.
                강 국장 (소리): 거기 누구야?
                부검의 (V.O.): 사인은 질식입니다.
                부검의: 확실해요.
                형사1: 손 들어.
                형사2: 움직이지 마.
                장노인: 왔나.
                장 노인: 앉게.
                장노인: 먹게.
                """;
        Map<Integer, Row> rows = new LinkedHashMap<>();
        String[][] said = {{"강 국장", "강 국장: "}, {"강 국장 (소리)", "강 국장 (소리): "}, {"부검의 (V.O.)", "부검의 (V.O.): "}, {"부검의", "부검의: "},
                {"형사1", "형사1: "}, {"형사1", "형사2: "}, {"장노인", "장노인: "}, {"장 노인", "장 노인: "}, {"장노인", "장노인: "}};
        for (int i = 0; i < said.length; i++) {
            rows.put(i + 1, new Row(i + 1, Kind.DIALOGUE, said[i][0], said[i][1]));
        }

        ScriptDraft draft = SplitDraft.assemble("t", raw, "paste", NumberedLine.of(raw), rows, List.of("강 국장", "부검의", "형사1", "장노인"));

        assertThat(draft.characterNames()).containsExactlyInAnyOrder("강 국장", "부검의", "형사1", "형사2", "장노인");
        assertThat(draft.lines()).extracting(line -> line.kind() + ":" + (line.characterIndex() == null ? "" : draft.characterNames().get(line.characterIndex()))
                + ":" + line.text()).containsExactly(
                "dialogue:강 국장:들어와.", "direction::(소리)", "dialogue:강 국장:거기 누구야?", "direction::(V.O.)", "dialogue:부검의:사인은 질식입니다.",
                "dialogue:부검의:확실해요.", "dialogue:형사1:손 들어.", "dialogue:형사2:움직이지 마.", "dialogue:장노인:왔나.", "dialogue:장노인:앉게.",
                "dialogue:장노인:먹게.");
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
                {"민(영혼)", "연아."}, {"민", "응."},
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
                "김지훈NA", "김지훈", "여자", "남자", "여 베이어드", "여기자‘", "여기자", "철수", "민(영혼)", "민");
        assertThat(draft.lines().stream().filter(line -> line.characterIndex() != null).toList()).extracting(line -> draft.characterNames().get(line.characterIndex()))
                .startsWith("장석구", "장석구", "장석구", "서린", "서린", "형사 1", "형사 1", "형사 1", "여주", "여주");
        assertThat(draft.characterTraits().get(draft.characterNames().indexOf("장석구")))
                .as("묶인 이름의 성별·나이대는 남긴 이름으로 옮긴다").isEqualTo(new CharacterTraits(CharacterGender.MALE, CharacterAgeBand.ADULT));
    }

    @Test
    @DisplayName("SOMA-663 H5: 줄 머리가 모델 화자와 다른 연습 배역(다른 역·내레이션)이면 머리 이름을 쓴다. 표기 변형·부름말·배역 아닌 머리는 화자를 둔다")
    void usesTheHeaderRoleWhenTheModelNamedAnotherCharacter() {
        String raw = String.join("\n",
                "사모1   아니, 웃기지 않니?",
                "사모1   그러게.",
                "(제혁NA) 설마 너냐.",
                "나봉: 응.",
                "거트루드, 이리 와.",
                "모두: 와!",
                "태희NA 망했다.",
                "서화련 : (나레이션) 야!",
                "거트루드: 네.",
                "나봉숙, 노봉숙, 루시아, 제혁, 태희가 들어온다.") + "\n";
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.DIALOGUE, "나봉숙", "사모1   "));
        rows.put(2, new Row(2, Kind.DIALOGUE, "사모1", "사모1   "));
        rows.put(3, new Row(3, Kind.DIALOGUE, "제혁", "(제혁NA) "));
        rows.put(4, new Row(4, Kind.DIALOGUE, "나봉숙", "나봉: "));
        rows.put(5, new Row(5, Kind.DIALOGUE, "루시아", "거트루드, "));
        rows.put(6, new Row(6, Kind.DIALOGUE, "노봉숙", "모두: "));
        rows.put(7, new Row(7, Kind.DIALOGUE, "태희", ""));
        rows.put(8, new Row(8, Kind.DIALOGUE, "서화련", "서화련 : "));
        rows.put(9, new Row(9, Kind.DIALOGUE, "거트루드", "거트루드: "));
        rows.put(10, new Row(10, Kind.DIRECTION, "", ""));

        ScriptDraft draft = SplitDraft.assemble("t", raw, "paste", NumberedLine.of(raw), rows, List.of());

        // 「나봉」 머리의 「나봉숙」은 다른 역이 아니라 표기 변형이라 그 배역으로 두고, 이름은 원문 머리 표기(H4 「윤해온」→「해온」)를 따른다
        assertThat(draft.lines().subList(0, 9)).extracting(line -> draft.characterNames().get(line.characterIndex()))
                .containsExactly("사모1", "사모1", "제혁NA", "나봉", "루시아", "노봉숙", "태희NA", "서화련", "거트루드");
        // 모델이 머리로 준 부름말 「거트루드, 」는 대사로 남긴다(N1 머리 고르기 — 스펙 「머리」 문단의 호명)
        assertThat(draft.lines()).extracting(ScriptDraft.Line::text)
                .containsExactly("아니, 웃기지 않니?", "그러게.", "설마 너냐.", "응.", "거트루드, 이리 와.", "와!", "망했다.", "(나레이션) 야!", "네.",
                        "나봉숙, 노봉숙, 루시아, 제혁, 태희가 들어온다.");
    }

    @Test
    @DisplayName("SOMA-663 M6: 머리가 모델 화자의 표기 변형에 역할 표시(영혼)를 붙인 것이면 배역 목록에 없어도 머리 이름이다. 화면 밖 목소리 꼬리는 화자를 둔다")
    void usesAMarkedRoleHeaderMissingFromTheRoster() {
        String raw = "민  연아, 왔어?\n연  응.\n민(영혼)   연아. 잘 지내.\n민 (목소리)  여기야.\n";
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.DIALOGUE, "민", "민  "));
        rows.put(2, new Row(2, Kind.DIALOGUE, "연", "연  "));
        rows.put(3, new Row(3, Kind.DIALOGUE, "민", "민(영혼)   "));
        rows.put(4, new Row(4, Kind.DIALOGUE, "민", "민 (목소리)  "));

        ScriptDraft draft = SplitDraft.assemble("t", raw, "paste", NumberedLine.of(raw), rows, List.of("민", "연"));

        assertThat(draft.lines().stream().filter(line -> line.characterIndex() != null).toList()).extracting(line -> draft.characterNames().get(line.characterIndex())).containsExactly("민", "연", "민(영혼)", "민");
    }

    @Test
    @DisplayName("SOMA-663 H5: 머리 없이 이어지는 줄은 앞 머리에서 바로잡은 역을 잇고, 다음 머리부터는 모델 화자로 돌아간다")
    void continuationLinesFollowTheCorrectedHeaderRole() {
        String raw = "빅토르  며칠 뒤입니다.\n(빅토르 모드) 아니, 왜 늦어?\n마리오  죄송합니다.\n뭐든지  나는 뭐든지야.\n그렇지.\n빅토르: 네.\n";
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.DIALOGUE, "뭐든지", "빅토르  "));
        rows.put(2, new Row(2, Kind.DIALOGUE, "뭐든지", ""));
        rows.put(3, new Row(3, Kind.DIALOGUE, "마리오", "마리오  "));
        rows.put(4, new Row(4, Kind.DIALOGUE, "뭐든지", "뭐든지  "));
        rows.put(5, new Row(5, Kind.DIALOGUE, "뭐든지", ""));
        rows.put(6, new Row(6, Kind.DIALOGUE, "빅토르", "빅토르: "));

        ScriptDraft draft = SplitDraft.assemble("t", raw, "paste", NumberedLine.of(raw), rows, List.of());

        assertThat(draft.lines()).extracting(line -> draft.characterNames().get(line.characterIndex()))
                .containsExactly("빅토르", "마리오", "뭐든지", "빅토르");
        assertThat(draft.lines().getFirst().text()).isEqualTo("며칠 뒤입니다. (빅토르 모드) 아니, 왜 늦어?");
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

    @Test
    @DisplayName("SOMA-663 H4: 원문 머리로 쓰지 않은 목록의 성+이름·「이름 + 낱말」은 머리 이름으로, 원문이 일부러 나눈 두 이름은 둔다")
    void theHeaderSpellingWinsOverALongerModelName() {
        String[][] said = {
                // {원문 머리, 모델 화자, 대사}
                {"해온", "윤해온", "안녕."}, {"해온", "윤해온", "응."}, {"해온", "해온", "그래."}, {"", "윤해온", "(머리 없는 이어지는 줄)"},
                {"청년", "청년 화장실에", "담배가 있었대요."}, {"청년", "청년", "말보로."},
                {"웹 부인", "웹 부인", "차 드세요."}, {"웹 부인", "웹 부인", "네."}, {"웹", "웹 부인", "그래."}, {"웹", "웹", "응."},
        };
        StringBuilder raw = new StringBuilder();
        Map<Integer, Row> rows = new LinkedHashMap<>();
        for (int i = 0; i < said.length; i++) {
            String header = said[i][0].isEmpty() ? "" : said[i][0] + "  ";
            raw.append(header).append(said[i][2]).append('\n');
            rows.put(i + 1, new Row(i + 1, Kind.DIALOGUE, said[i][1], header));
        }

        ScriptDraft draft = SplitDraft.assemble("t", raw.toString(), "paste", NumberedLine.of(raw.toString()), rows, List.of("윤해온"));

        assertThat(draft.characterNames()).containsExactlyInAnyOrder("해온", "청년", "웹 부인", "웹");
        assertThat(draft.lines()).extracting(line -> draft.characterNames().get(line.characterIndex()))
                .as("「웹」 머리 한 줄에 쓴 「웹 부인」은 제 이름 머리가 더 많아 그대로다")
                .containsExactly("해온", "해온", "해온", "청년", "청년", "웹 부인", "웹 부인", "웹 부인", "웹");
        assertThat(SplitDraft.assembleWithSpeakers("t", raw.toString(), "paste", NumberedLine.of(raw.toString()), rows, List.of("윤해온"), Map.of())
                .speakers()).as("원문 줄마다 조립이 정한 화자 — 모델 이름 「윤해온」 줄도 「해온」")
                .containsEntry(1, "해온").containsEntry(4, "해온").containsEntry(5, "청년").containsEntry(9, "웹 부인");
    }

    @Test
    @DisplayName("SOMA-663 H4: 내레이션 머리·목록에 없는 다른 사람 머리는 머리 이름으로 — 부르는 말·목소리·글자 인식이 깨진 머리, 머리 없는 「이름 + 대사」는 바로잡는다")
    void aHeaderNamingSomeoneElseIsKept() {
        String raw = "등장인물: 김현정, 여자, 김스부인, 연수\n재이 (N) 오늘은.\n재이 (N) 그래.\n학생1   선생님!\n학생1   네!\n박 선생님, 왜요?\n"
                + "박 선생님, 네.\n녹음 속 목소리 안녕.\n녹음 속 목소리 응.\nAAPA : 좋아요.\nAAPA : 그래요.\n로라 (객석을 향해) 안녕하세요.\n로라 가요.\n로라 네.\n"
                + "처음 가져보는 기분이야\n처음 가져보는 느낌이야\n          만원!(함성).";
        String[][] said = {
                {"재이", "재이 (N) "}, {"재이", "재이 (N) "}, {"앙상블", "학생1   "}, {"앙상블", "학생1   "}, {"김현정", "박 선생님, "},
                {"김현정", "박 선생님, "}, {"여자", "녹음 속 목소리 "}, {"여자", "녹음 속 목소리 "}, {"김스부인", "AAPA : "}, {"김스부인", "AAPA : "},
                {"로라 (객석을 향해) 안녕하세요.", ""}, {"로라", "로라 "}, {"로라", "로라 "},
                // 가사 줄의 첫 낱말 — 공백 한 칸 머리이고 등장인물에 없다(2026-10-20 020)
                {"연수", "처음 "}, {"연수", "처음 "},
                // 화자 칸에 이름과 대사를 붙여 썼다(2026-10-20 022)
                {"연수만원!(함성).", ""},
        };
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.CAST, "", ""));
        for (int i = 0; i < said.length; i++) {
            rows.put(i + 2, new Row(i + 2, Kind.DIALOGUE, said[i][0], said[i][1]));
        }

        ScriptDraft draft = SplitDraft.assemble("t", raw, "paste", NumberedLine.of(raw), rows, List.of());

        assertThat(draft.characterNames()).containsExactlyInAnyOrder("재이 (N)", "학생1", "김현정", "여자", "김스부인", "로라", "연수");
    }

    @Test
    @DisplayName("SOMA-663 통합: 이름 뒤 쌍점 다음 글자는 머리가 아니다 — 「은중:.배리, 뭐?」의 머리는 「은중:」")
    void theHeaderStopsAtTheColon() {
        String raw = "은중:.배리, 뭐?\n상연: 응.";
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.DIALOGUE, "은중", "은중:"));
        rows.put(2, new Row(2, Kind.DIALOGUE, "상연", "상연: "));

        ScriptDraft draft = SplitDraft.assemble("t", raw, "paste", NumberedLine.of(raw), rows, List.of());

        assertThat(draft.lines()).extracting(ScriptDraft.Line::text).containsExactly(".배리, 뭐?", "응.");
    }

    @Test
    @DisplayName("SOMA-663 M1: 떼는 범위는 화자 표기와 따로다 — 배역을 가리키는 대괄호 머리는 화자를 표준 이름으로 맞춰도 떼고, 쌍점 뒤 글자는 남긴다. 배역이 아닌 대괄호는 대사다")
    void theHeaderRangeDoesNotFollowTheSpeakerSpelling() {
        String raw = "[쥴리아] 왔어?\n[졸리아] 응.\n[JIM/SAND] 같이!\n[당황하며] 왜?\n은중:.배리, 뭐?\nJIMMY: 어.\nSANDRINE: 응.\n**민우:** 봤어요?";
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.DIALOGUE, "쥴리아", "[쥴리아] "));
        rows.put(2, new Row(2, Kind.DIALOGUE, "쥴리아", "[졸리아] "));
        rows.put(3, new Row(3, Kind.DIALOGUE, "JIMMY/SAND", "[JIM/SAND] "));
        rows.put(4, new Row(4, Kind.DIALOGUE, "쥴리아", "[당황하며] "));
        rows.put(5, new Row(5, Kind.DIALOGUE, "은중", "은중:."));
        rows.put(6, new Row(6, Kind.DIALOGUE, "JIMMY", "JIMMY: "));
        rows.put(7, new Row(7, Kind.DIALOGUE, "SANDRINE", "SANDRINE: "));
        rows.put(8, new Row(8, Kind.DIALOGUE, "민우", "**민우:** "));

        ScriptDraft draft = SplitDraft.assemble("t", raw, "paste", NumberedLine.of(raw), rows, List.of());

        assertThat(draft.lines()).extracting(ScriptDraft.Line::text).containsExactly(
                "왔어?", "응.", "같이!", "[당황하며] 왜?", ".배리, 뭐?", "어.", "응.", "봤어요?");
    }

    @Test
    @DisplayName("SOMA-663 H4: 모델이 머리를 비우고 화자를 「태희」로 준 「태희NA 대사」 줄은 내레이션 배역이고 꼬리까지 머리다")
    void aNarrationTailAfterTheNameIsPartOfTheHeader() {
        String raw = "태희NA 망했다.\n태희 왜?\n태희 (N) 그래도.";
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.DIALOGUE, "태희", ""));
        rows.put(2, new Row(2, Kind.DIALOGUE, "태희", "태희 "));
        rows.put(3, new Row(3, Kind.DIALOGUE, "태희", ""));

        ScriptDraft draft = SplitDraft.assemble("t", raw, "paste", NumberedLine.of(raw), rows, List.of());

        assertThat(draft.characterNames()).containsExactlyInAnyOrder("태희NA", "태희", "태희 (N)");
        assertThat(draft.lines()).extracting(ScriptDraft.Line::text).containsExactly("망했다.", "왜?", "그래도.");
    }

    @Test
    @DisplayName("SOMA-663 M4: 괄호 행동 뒤 화자 이름표는 행동을 지문으로 떼고, • 로 이은 함께 말하기와 빗금 음성 꼬리는 이름을 지키거나 주인과 묶는다")
    void splitsInlineActionsAndReadsBulletGroupsAndSlashVoices() {
        String raw = """
                어머니: 왜 그래?
                (어머니, 갑자기 소리 지른다) 딸 그만해, 어머니!
                딸: 미안해요.
                주혁•정배 답하라!
                윤성구/음성 1949년 7월 11일.
                윤성구: 기억나?""";
        List<NumberedLine> lines = NumberedLine.of(raw);
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.DIALOGUE, "어머니", "어머니: "));
        rows.put(2, new Row(2, Kind.DIALOGUE, "딸", ""));
        rows.put(3, new Row(3, Kind.DIALOGUE, "딸", "딸: "));
        rows.put(4, new Row(4, Kind.DIALOGUE, "주혁•정배", "주혁•정배 "));
        rows.put(5, new Row(5, Kind.DIALOGUE, "윤성구/음성", "윤성구/음성 "));
        rows.put(6, new Row(6, Kind.DIALOGUE, "윤성구", "윤성구: "));

        ScriptDraft draft = SplitDraft.assemble(null, raw, "paste", lines, rows, List.of("어머니", "딸", "주혁", "정배", "윤성구"));

        assertThat(draft.characterNames()).containsExactly("딸", "윤성구", "어머니", "주혁•정배");
        assertThat(draft.lines()).containsExactly(
                new ScriptDraft.Line(1, "dialogue", 2, "왜 그래?"),
                new ScriptDraft.Line(2, "direction", null, "(어머니, 갑자기 소리 지른다)"),
                new ScriptDraft.Line(3, "dialogue", 0, "그만해, 어머니!"),
                new ScriptDraft.Line(4, "dialogue", 0, "미안해요."),
                new ScriptDraft.Line(5, "dialogue", 3, "답하라!"),
                new ScriptDraft.Line(6, "dialogue", 1, "1949년 7월 11일."),
                new ScriptDraft.Line(7, "dialogue", 1, "기억나?"));
    }

    @Test
    @DisplayName("SOMA-663 M7 N0: 한 번만 말한 화자라도 원문에서 찾은 머리가 화자 이름 그대로이고 탭으로 끝나면 더 짧은 모델 머리로 줄이지 않는다. 대사 낱말을 먹은 화자는 그대로 모델 머리까지")
    void keepsAnExactSourceHeaderOverAShorterModelHeader() {
        String raw = "모\t두\t성부와, 성자와, 성령의 이름으로. 아멘\n선생 요즘 뭐 하세요?\n민수: 네.\n민수: 아니요.";
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.DIALOGUE, "모두", "모\t"));
        rows.put(2, new Row(2, Kind.DIALOGUE, "선생 요즘", "선생 "));
        rows.put(3, new Row(3, Kind.DIALOGUE, "민수", "민수: "));
        rows.put(4, new Row(4, Kind.DIALOGUE, "민수", "민"));

        ScriptDraft draft = SplitDraft.assemble("t", raw, "paste", NumberedLine.of(raw), rows, List.of("모두", "선생", "민수"));

        assertThat(draft.lines()).extracting(ScriptDraft.Line::text)
                .containsExactly("성부와, 성자와, 성령의 이름으로. 아멘", "요즘 뭐 하세요?", "네.", "아니요.");
    }

    @Test
    @DisplayName("SOMA-663 M7 N3: 모델이 머리를 비워도 화자 이름의 한 글자 오타인 이 대본의 배역 머리는 뗀다. 배역이 아닌 비슷한 낱말은 대사다")
    void stripsAHeaderThatIsATypoOfTheSpeakerAndACastName() {
        String raw = "클로디어스 돈결아, 진정해.\n클로디어스 어디? 안 보이는데?\n클로디어스: 그래.\n선생들 모두 모였어요.\n선생님: 네.";
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.DIALOGUE, "클로디우스", ""));
        rows.put(2, new Row(2, Kind.DIALOGUE, "클로디우스", ""));
        rows.put(3, new Row(3, Kind.DIALOGUE, "클로디어스", "클로디어스: "));
        rows.put(4, new Row(4, Kind.DIALOGUE, "선생님", ""));
        rows.put(5, new Row(5, Kind.DIALOGUE, "선생님", "선생님: "));

        ScriptDraft draft = SplitDraft.assemble("t", raw, "paste", NumberedLine.of(raw), rows, List.of("클로디우스", "선생님"));

        assertThat(draft.lines()).extracting(ScriptDraft.Line::text)
                .containsExactly("돈결아, 진정해.", "어디? 안 보이는데?", "그래.", "선생들 모두 모였어요.", "네.");
    }

    @Test
    @DisplayName("SOMA-663 M7 N3: 두 번째 의견이 되살린 대사 줄의 화자가 배역이 아닌 모델 이름이면, 조립이 그 이름을 두 줄 이상에서 늘 한 배역으로 바꿨을 때만 그 배역으로")
    void revivedLinesTakeTheAssembledNameOfTheModelName() {
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.DIALOGUE, "죄인 구십구 번", "[구십구] "));
        rows.put(2, new Row(2, Kind.DIALOGUE, "죄인 구십구 번", ""));
        rows.put(3, new Row(3, Kind.DIRECTION, "", ""));
        rows.put(4, new Row(4, Kind.DIALOGUE, "엄마", ""));
        rows.put(5, new Row(5, Kind.DIALOGUE, "엄마", ""));
        rows.put(6, new Row(6, Kind.DIALOGUE, "노인", ""));
        rows.put(7, new Row(7, Kind.DIRECTION, "", ""));
        ScriptDraft draft = new ScriptDraft("t", "", "paste", List.of("구십구", "어머니", "엄마 2", "노인장"), List.of());
        var assembly = new SplitDraft.Assembly(draft, Map.of(1, "구십구", 2, "구십구", 4, "어머니", 5, "엄마 2", 6, "노인장"), Map.of());
        Map<Integer, Row> changed = Map.of(
                3, new Row(3, Kind.DIALOGUE, "죄인 구십구 번", ""),
                7, new Row(7, Kind.DIALOGUE, "엄마", ""),
                8, new Row(8, Kind.DIALOGUE, "노인", ""),
                9, new Row(9, Kind.DIALOGUE, "구십구", ""));

        Map<Integer, Row> named = assembly.assembledNames(changed, rows);

        assertThat(named.get(3).speaker()).isEqualTo("구십구");
        assertThat(named.get(7).speaker()).as("두 배역으로 갈린 모델 이름").isEqualTo("엄마");
        assertThat(named.get(8).speaker()).as("한 줄에서만 바뀐 모델 이름").isEqualTo("노인");
        assertThat(named.get(9).speaker()).isEqualTo("구십구");
    }

    @Test
    @DisplayName("SOMA-663 M7 부분 B: 숫자로 끝나는 배역 뒤 띄어 쓴 NA 도 내레이션 표시라 머리에 같이 떼고 내레이션 배역으로 둔다. 영문 이름 끝은 아니다")
    void stripsANarrationMarkAfterANumberedRole() {
        String raw = "배우1 NA 나한테는 말해도 되잖아.\n배우1 NA 왜 자꾸 숨겨?\n배우1 그래.\nAnna 왜?";
        Map<Integer, Row> rows = new LinkedHashMap<>();
        rows.put(1, new Row(1, Kind.DIALOGUE, "배우1", "배우1 NA "));
        rows.put(2, new Row(2, Kind.DIALOGUE, "배우1", ""));
        rows.put(3, new Row(3, Kind.DIALOGUE, "배우1", "배우1 "));
        rows.put(4, new Row(4, Kind.DIALOGUE, "Ann", ""));

        ScriptDraft draft = SplitDraft.assemble("t", raw, "paste", NumberedLine.of(raw), rows, List.of("배우1", "Ann"));

        assertThat(draft.lines()).extracting(ScriptDraft.Line::text).containsExactly("나한테는 말해도 되잖아.", "왜 자꾸 숨겨?", "그래.", "Anna 왜?");
        assertThat(draft.characterNames()).contains("배우1 NA", "배우1");
    }
}
