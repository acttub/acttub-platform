package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * 모델의 답을 읽는다 (SOMA-593 7-2 6번·7-14). 답은 {@code 줄번호<TAB>종류<TAB>배역<TAB>떼어낼머리} 한 줄씩이고, 첫 호출은
 * 맨 앞에 {@code 대본<TAB>예|아니오} 한 줄을 더 쓴다.
 *
 * <p>버리는 줄: 보낸 적 없는 줄 번호, 여섯 종류 밖, 떼어낼 머리가 그 줄의 시작과 다른 것(보이지 않는 글자·공백은 빼고 견준다). 버린 줄은 빠진 줄과 같이 다시 묻는다. 판단 줄이 없거나 깨졌으면 대본으로 본다 — 판단
 * 실패가 넣기를 막지 않게.
 *
 * <p>버리지 않고 고쳐 읽는 답 (SOMA-663): 종류 칸의 {@code 대사}·{@code D}·{@code d=윤서} 같은 꼴은 그 종류로(이름은 배역 칸이 비었을 때
 * 배역으로) 읽는다. 떼어낼 머리가 공백만 다르면 원문 글자로 맞추고, 대사에서 머리가 줄 전체를 덮으면(대사 글을 머리 칸에
 * 옮겨 쓴 답) 머리를 버린다. 배역이 빈 대사는 머리가 {@code 윤서: }·{@code [로스] } 꼴이면 그 이름을 배역으로 쓰고, 아니면 머리를
 * 버리고 배역을 비운 채 받는다 — 앞뒤 조각을 다 받은 뒤 {@link #fillSpeakers} 가 채우거나 버린다. 2026-10-21 재생 221편의 첫 판에서 버리던 줄
 * 3,616개 중 2,101개를 이렇게 받았고, 다시 묻는 줄이 5,192개에서 3,151개로 줄었다.
 *
 * <p>짧은 대본(조각 하나)의 첫 호출은 답 끝에 {@code 배역} 한 줄과 그 아래 {@code 이름<TAB>성별<TAB>나이대} 줄들을 더 쓴다
 * (SOMA-670). 머리 줄 뒤의 줄은 줄 판정으로 읽히면 줄 판정이고 아니면 배역 줄이다 — 블록이 없거나 깨졌으면 성별·나이대를
 * 모를 뿐 줄 판정은 그대로다.
 *
 * @param rows 받아들인 줄. 번호 → 판정
 * @param script 판단 줄의 답. 없거나 깨졌으면 {@code null}
 * @param rejected 버린 줄 수
 * @param traits 「배역」 블록의 성별·나이대. 이름 → 값. 블록이 없으면 비어 있다
 * @param refused 머리가 줄 시작과 달라 버린 줄의 답(머리 칸은 비움). 다시 물은 답의 화자를 견줄 근거다({@link #lineage})
 */
public record SplitResponse(Map<Integer, Row> rows, Boolean script, int rejected, Map<String, CharacterTraits> traits,
        Map<Integer, Row> refused) {

    private static final String JUDGMENT_PREFIX = "대본\t";
    /** 종류 칸에 배역을 붙여 쓴 답 — {@code d=샬럿}. */
    private static final Pattern NUMBERED = Pattern.compile("(?m)^\\s*~?\\d+\\t");
    private static final Pattern NAMED_KIND = Pattern.compile("([a-zA-Z])\\s*=\\s*(.+)");
    /** 「배역」 블록의 머리 줄. 지시문({@code ScriptSplitPrompt})과 같은 글자다. */
    public static final String CAST_HEADER = "배역";
    /** 함께 말하는 화자의 이름 구분. */
    private static final Pattern SPEAKERS = Pattern.compile("[,，/·&+、]");
    /** 이름 없는 대사 규칙에서 혼자 말하는 사람의 이름 — {@code ScriptSplitPrompt} 의 「화자」와 같은 글자다. */
    private static final String MONOLOGUE = "화자";
    /** 줄 맨 앞 이름 + 쌍점 머리. */
    private static final Pattern COLON_HEAD = Pattern.compile("([^:：]{1,10}?)\\s*[:：][\\s\\p{Z}]*(?=\\S)");
    /** 여러 낱말에 문장 끝 부호로 끝나는 글 — 이름이 아니라 말이다. */
    private static final Pattern SENTENCE = Pattern.compile("\\S+\\s.*[.?!…。]");
    /** 블록 형식의 이름 줄로 볼 짧은 이름(글자·숫자·공백 10자까지). */
    private static final Pattern NAME_LINE = Pattern.compile("[\\p{L}\\p{N}][\\p{L}\\p{N} ]{0,9}");

    /** 효과음 화자 표기(띄어쓰기·괄호 무시) — 「(음 향)」은 배역이 아니라 지문이다(SOMA-709). */
    private static final Pattern SOUND = Pattern.compile("(?iu)음향|효과음?|배경음악?|음악|sfx|se|bgm|sound");
    /** 괄호 화자 중 화면 밖 목소리 — 「(목소리) 거기 누구야?」는 들리는 말이라 대사다. */
    private static final Pattern VOICE = Pattern.compile("(?iu)목?소리|음성|전화|v\\.?o\\.?|o\\.?s\\.?|off");
    /** 이름이 아니라 대사 앞 낱말이 화자 칸에 들어간 꼴 — 접속사·대명사 낱말, 「~의/~은/~는」으로 끝나는 말(SOMA-709). */
    private static final Pattern FUNCTION_WORD = Pattern.compile("그리고|그러나|그런데|하지만|그래서|그러면|그럼|또는|혹은|및|또|내|나|너|네|저|제|우리|저희|그|그녀|그들|이것|그것|저것|당신|자네");
    private static final Pattern MODIFIER_END = Pattern.compile("\\p{IsHangul}+[의은는]");
    /** 원문 머리로 쓰인 이름 뒤의 구분 — 줄 끝, 쌍점·쌍반점·마침표·닫는 괄호·탭·U+3000, 공백 두 칸, 괄호 설명. */
    private static final Pattern HEAD_END = Pattern.compile("(?s)(?:[:：;.)\\]\\t\\u3000]|\\s{2}|\\s*\\().*|");

    public SplitResponse {
        rows = Map.copyOf(rows);
        traits = Map.copyOf(traits);
        refused = Map.copyOf(refused);
    }

    public boolean notScript() {
        return Boolean.FALSE.equals(script);
    }

    /**
     * 번호로 시작하는 줄도 판단 줄도 없는 답 — 설명·다른 작업의 답처럼 형식을 벗어난 답이다 (SOMA-663 M1). 2026-10-21 재생의 첫 답
     * 하나는 나누기 대신 환경 동기화 보고를 썼다. 판단 줄만 있거나 문맥 줄에만 답한 답은 형식 안의 덜 쓴 답이라 잘린 답처럼 빠진 줄
     * 다시 묻기가 맡는다.
     */
    public static boolean unformatted(String answer) {
        String text = tabs(answer);
        return !NUMBERED.matcher(text).find() && parse(text, List.of()).script() == null;
    }

    /**
     * 칸 구분을 탭으로 맞춘다 — 모델이 형식 설명의 「<TAB>」이나 「\t」를 글자 그대로 쓴 답이 있다(2026-10-20 053 의 「대본<TAB>예」가
     * 배역이 됐고, 2026-10-21 재생에서 058 의 「대본<TAB>아니오」가 거절로 읽히지 않았고 027 의 「24\td\t보미\t」 150줄이 버려졌다).
     * 줄 판정·판단 줄·배역 목록·띄어쓰기 답이 같이 쓴다.
     */
    public static String tabs(String answer) {
        return answer.replace("<TAB>", "\t").replace("\\t", "\t");
    }

    public static SplitResponse parse(String text, List<NumberedLine> sent) {
        Map<Integer, String> source = new LinkedHashMap<>();
        for (NumberedLine line : sent) {
            source.put(line.no(), line.text());
        }
        Map<Integer, Row> rows = new LinkedHashMap<>();
        Map<String, CharacterTraits> traits = new LinkedHashMap<>();
        Map<Integer, Row> refused = new LinkedHashMap<>();
        Boolean script = null;
        boolean first = true;
        boolean inCast = false;
        int rejected = 0;
        for (String raw : tabs(text).split("\n")) {
            String line = raw.strip();
            if (line.isEmpty()) {
                continue;
            }
            if (line.equals(CAST_HEADER)) {
                inCast = true;
                first = false;
                continue;
            }
            if (first) {
                first = false;
                Boolean judged = judgment(raw);
                if (judged != null) {
                    script = judged;
                    continue;
                }
            }
            Row row = row(raw, source);
            if (row == null) {
                if (inCast) {
                    castLine(raw, traits);
                } else {
                    rejected++;
                }
                continue;
            }
            if (row.header() == null) {
                refused.put(row.no(), new Row(row.no(), row.kind(), row.speaker(), ""));
                rejected++;
                continue;
            }
            rows.put(row.no(), row);
        }
        return new SplitResponse(rows, script, rejected, traits, refused);
    }

    /** 배역 목록 호출의 답에서 이름만 — 한 줄에 {@code 이름<TAB>성별<TAB>나이대}(이름만 써도 받는다). */
    public static List<String> roster(String text) {
        return new ArrayList<>(rosterTraits(text).keySet());
    }

    /**
     * 배역 목록 호출의 답 (SOMA-670). 한 줄에 {@code 이름<TAB>성별<TAB>나이대}, 글머리표·번호를 떼고 판단 줄과 「배역」 머리
     * 줄은 뺀다. 같은 이름은 처음 줄을 쓴다.
     */
    public static Map<String, CharacterTraits> rosterTraits(String text) {
        Map<String, CharacterTraits> traits = new LinkedHashMap<>();
        for (String raw : tabs(text).split("\n")) {
            if (judgment(raw) != null || raw.strip().equals(CAST_HEADER)) {
                continue;
            }
            castLine(raw, traits);
        }
        return traits;
    }

    /** {@code 이름<TAB>성별<TAB>나이대} 한 줄. 이름이 비면 버린다. 목록 밖 값은 모름이다. */
    private static void castLine(String raw, Map<String, CharacterTraits> traits) {
        String[] fields = raw.split("\t", -1);
        String name = fields[0].strip().replaceFirst("^[-*•\\d.)\\s]+", "").strip();
        if (name.isEmpty()) {
            return;
        }
        traits.putIfAbsent(name, CharacterTraits.parse(fields.length > 1 ? fields[1] : null, fields.length > 2 ? fields[2] : null));
    }

    private static Boolean judgment(String raw) {
        String line = raw.strip();
        if (!line.startsWith(JUDGMENT_PREFIX)) {
            return null;
        }
        String answer = line.substring(JUDGMENT_PREFIX.length()).strip();
        return switch (answer) {
            case "예" -> Boolean.TRUE;
            case "아니오", "아니요" -> Boolean.FALSE;
            default -> null;
        };
    }

    private static Row row(String raw, Map<Integer, String> source) {
        String[] fields = raw.split("\t", -1);
        if (fields.length < 2) {
            return null;
        }
        int no;
        try {
            no = Integer.parseInt(fields[0].strip());
        } catch (NumberFormatException notANumber) {
            return null;
        }
        String original = source.get(no);
        String speaker = fields.length > 2 ? fields[2].strip() : "";
        Kind kind = Kind.of(fields[1]);
        Matcher named = NAMED_KIND.matcher(fields[1].strip());
        if (kind == null && named.matches()) {
            kind = Kind.of(named.group(1));
            speaker = speaker.isEmpty() ? named.group(2).strip() : speaker;
        }
        if (original == null || kind == null) {
            return null;
        }
        // 원문 머리 안의 탭(「모⇥두⇥」)은 칸 구분과 같은 글자라 머리가 뒤 칸으로 넘친다 — 뒤 칸을 이어 원문 머리와 맞으면 그것을 쓴다(SOMA-663 M1, 재생 066)
        String joined = fields.length > 4 ? header(original, String.join("\t", Arrays.copyOfRange(fields, 3, fields.length))) : null;
        String header = joined != null ? joined : header(original, fields.length > 3 ? fields[3] : "");
        // 머리가 줄 시작과 다른 답은 대개 다른 줄의 답을 옮겨 쓴 것이다 — 머리만 버리고 받아 보니(2026-10-20 재생) 표본 12줄 중 8줄이 다시
        // 묻기 답보다 틀렸다. 버리고 다시 묻는다. 다만 그 머리가 이 줄 안의 괄호 행동 뒤에 적힌 화자 이름표이고 배역과 같으면
        // (「(어머니, 소리 지른다) 딸 그만해」·「뿌리⇥(말은 없지만…) ... 가지⇥한진이요.」) 화자 근거는 맞다 — 떼지 못하는 머리만 버린다(재생 213·120)
        if (header == null && kind == Kind.DIALOGUE && innerTag(original, fields[3], speaker)) {
            header = "";
        }
        if (header == null) {
            return new Row(no, kind, kind == Kind.DIALOGUE ? speaker.replaceFirst("[\\s:：;]+$", "") : "", null);
        }
        // 머리 칸에 대사 글을 옮겨 쓴 답 — 그대로 떼면 대사가 사라진다. 배역 이름으로 시작하는 한 줄(「여자 방송기자 (소리)」·「[주인]」)은
        // 블록 형식의 이름 줄이라 그대로 둔다.
        if (kind == Kind.DIALOGUE && !header.isEmpty() && ScriptText.visible(original).strip().equals(ScriptText.visible(header).strip())
                && (speaker.isEmpty() || !header.replaceFirst("^[\\[(]", "").startsWith(speaker.split("\\s+")[0]))) {
            header = "";
        }
        // 배역 칸 끝의 구분 부호(「은수, 영숙 :」)는 머리의 것이다 — 이름으로 두면 머리를 찾지 못해 머리가 대사에 남았다(SOMA-663 M1, 재생 052)
        speaker = speaker.replaceFirst("[\\s:：;]+$", "");
        // 배역 칸에 종류 이름을 쓴 답(「대사」)은 배역이 빈 것이다.
        if (speaker.matches("대사|지문|장면 ?머리|제목|등장인물|무시")) {
            speaker = "";
        }
        // 배역 칸이 비었으면 「윤서: 」·「[로스] 」 꼴의 머리만 이름으로 믿는다. 그 밖의 머리는 대개 대사의 첫 낱말(「그리고 」)이라 버린다 —
        // 이름으로 쓰면 2026-10-20 재생 053·109에서 배역이 50명을 넘었다.
        if (kind == Kind.DIALOGUE && speaker.isEmpty()) {
            String written = header.strip();
            boolean nameHeader = written.endsWith(":") || written.endsWith("：") || written.matches("\\[[^\\]]+]");
            speaker = nameHeader ? SplitDraft.nameOf(header) : "";
            header = nameHeader ? header : "";
        }
        return new Row(no, kind, kind == Kind.DIALOGUE ? speaker : "", header);
    }

    /** 답한 머리가 줄 맨 앞이 아니라 그 줄의 닫힌 괄호 행동 뒤에 적힌 배역 이름표인가 — 이름이 배역 칸과 같고 뒤에 말이 이어진다. */
    private static boolean innerTag(String original, String answered, String speaker) {
        String line = ScriptText.visible(original);
        String tag = ScriptText.visible(answered).strip();
        String name = SplitDraft.nameOf(answered);
        int at = tag.isEmpty() ? -1 : line.indexOf(tag);
        return at > 0 && !name.isEmpty() && CharacterNames.squash(name).equals(CharacterNames.squash(speaker))
                && line.substring(0, at).contains(")") && !line.substring(at + tag.length()).isBlank();
    }

    /**
     * 떼어낼 머리를 원문 글자로. 보이지 않는 글자는 빼고 견주고, 공백만 다르면(「딱딱이 : 」와 「딱딱이⇥: 」) 원문의 그 부분을 머리로 쓴다.
     * 머리가 없으면 빈 문자열, 줄의 시작과 다르면 null.
     */
    private static String header(String original, String answered) {
        String line = ScriptText.visible(original).stripLeading();
        String wanted = ScriptText.visible(answered).stripLeading();
        if (wanted.isBlank()) {
            return "";
        }
        if (line.startsWith(wanted)) {
            return answered.stripLeading();
        }
        int at = 0;
        for (int i = 0; i < wanted.length(); i++) {
            char c = wanted.charAt(i);
            if (Character.isWhitespace(c) || Character.isSpaceChar(c)) {
                continue;
            }
            while (at < line.length() && (Character.isWhitespace(line.charAt(at)) || Character.isSpaceChar(line.charAt(at)))) {
                at++;
            }
            if (at >= line.length() || line.charAt(at) != c) {
                return null;
            }
            at++;
        }
        return line.substring(0, at);
    }

    /**
     * 앞뒤 조각의 답을 다 받은 뒤, 배역이 빈 대사를 채운다 (SOMA-663). 줄이 이 대본의 배역 이름 + 공백·구분 부호로 시작하면 그 배역,
     * 아니면 바로 앞 대사의 배역이다(그 사이에는 무시 줄만 있어야 한다 — 블록 형식의 이름 줄). 채우지 못한 줄은 판정에서 뺀다 — 빠진 줄과
     * 같이 다시 묻고, 그래도 남으면 지문이다. 첫 판 답에서 배역 빈 대사의 대부분은 앞 대사가 줄을 넘어 이어지는 줄이었고, 조각 첫 줄이면
     * 앞 조각의 마지막 대사에 이어졌다.
     */
    public static void fillSpeakers(List<NumberedLine> lines, Map<Integer, Row> rows) {
        sentences(lines, rows);
        List<String> known = rows.values().stream().filter(row -> row.kind() == Kind.DIALOGUE && !row.speaker().isEmpty())
                .map(Row::speaker).distinct().sorted(Comparator.comparingInt(String::length).reversed()).toList();
        String previous = null;
        for (NumberedLine line : lines) {
            Row row = rows.get(line.no());
            if (row == null || row.kind() != Kind.DIALOGUE && row.kind() != Kind.IGNORE) {
                previous = null;
                continue;
            }
            if (row.kind() == Kind.IGNORE) {
                // 블록 형식의 이름 줄(「앰버, 페니, 트레이시」)이면 그 뒤 대사는 그 배역이다.
                String name = SplitDraft.nameOf(line.text());
                previous = known.contains(name) ? name : previous;
                continue;
            }
            if (row.speaker().isEmpty()) {
                String speaker = leadingName(line.text(), known);
                speaker = speaker != null ? speaker : previous;
                if (speaker == null) {
                    rows.remove(line.no());
                    continue;
                }
                row = new Row(row.no(), Kind.DIALOGUE, speaker, row.header());
                rows.put(row.no(), row);
            }
            previous = row.speaker();
        }
    }

    /**
     * 줄 전체를 배역 칸에 옮겨 쓴 대사 답 — 여러 낱말이고 문장 끝 부호로 끝나면 이름이 아니라 말이다 (SOMA-663 M8 부분 D). 이름으로 받으면 뒤
     * 줄들이 그 문장을 화자로 이어받았다(재생 054 「누가 대신 써넣었는지도 모르고요.」). 줄이 다른 줄이 쓰는 배역 이름 + 공백으로 시작하면 그
     * 배역과 머리로(「리틀이네즈 유명세 있는 사람은 전부 저래요?」, 재생 007), 짧은 이름 + 쌍점으로 시작하면 그 이름과 머리로(「다같이 : 온새미로
     * 파이팅!」, 재생 029), 아니면 배역을 비워 앞 대사에 잇는다.
     */
    static void sentences(List<NumberedLine> lines, Map<Integer, Row> rows) {
        List<String> known = rows.values().stream().filter(row -> row.kind() == Kind.DIALOGUE && !row.speaker().isEmpty()
                && !SENTENCE.matcher(row.speaker()).matches()).map(Row::speaker).distinct()
                .sorted(Comparator.comparingInt(String::length).reversed()).toList();
        for (NumberedLine line : lines) {
            Row row = rows.get(line.no());
            String text = ScriptText.visible(line.text()).stripLeading();
            if (row == null || row.kind() != Kind.DIALOGUE || !SENTENCE.matcher(row.speaker().strip()).matches()
                    || !CharacterNames.squash(text).equals(CharacterNames.squash(row.speaker()))) {
                continue;
            }
            Matcher head = known.stream().map(listed -> Pattern.compile(Pattern.quote(listed) + "[\\s\\p{Z}]+(?=\\S)").matcher(text))
                    .filter(Matcher::lookingAt).findFirst().orElse(null);
            Matcher colon = COLON_HEAD.matcher(text);
            if (head != null) {
                rows.put(line.no(), new Row(line.no(), Kind.DIALOGUE, head.group().strip(), head.group()));
            } else if (colon.lookingAt() && NAME_LINE.matcher(colon.group(1).strip()).matches()) {
                rows.put(line.no(), new Row(line.no(), Kind.DIALOGUE, colon.group(1).strip(), colon.group()));
            } else {
                rows.put(line.no(), new Row(line.no(), Kind.DIALOGUE, "", ""));
            }
        }
    }

    /**
     * 원문 어디에도(띄어쓰기 무시) 없는 대사 화자 이름 — 모델이 옮기거나 지어낸 「student 3」·「이반 Калияев」(SOMA-663 M3, 재생 186·077) —
     * 을 원문 근거가 있는 이름으로 바꾼다. 근거는 그 줄 머리의 이름, 그 줄을 시작하는 다른 대사의 원문 화자 이름, 바로 위 블록 형식의 이름 줄
     * 순이고, 근거가 없는 줄(이어지는 줄)은 같은 이름의 다른 줄에서 가장 많이 나온 근거를 따른다. 근거가 하나도 없는 이름은 그대로 둔다 —
     * 조립이 원문 머리로 바로잡는다. 여럿이 함께 하는 화자(「JIMMY/SAND」)는 이름마다 본다. 이름 없는 대사로 다시 나눈 답(「화자」)에는 쓰지 않는다.
     */
    public static void ground(List<NumberedLine> lines, Map<Integer, Row> rows) {
        String source = CharacterNames.squash(ScriptText.visible(String.join("\n", lines.stream().map(NumberedLine::text).toList())));
        List<String> known = rows.values().stream().filter(row -> row.kind() == Kind.DIALOGUE && !row.speaker().isBlank()
                && grounded(row.speaker(), source)).map(Row::speaker).distinct()
                .sorted(Comparator.comparingInt(String::length).reversed()).toList();
        Map<Integer, String> found = new LinkedHashMap<>();
        Map<String, Map<String, Integer>> votes = new LinkedHashMap<>();
        NumberedLine above = null;
        for (NumberedLine line : lines) {
            Row row = rows.get(line.no());
            if (row != null && row.kind() == Kind.DIALOGUE && !grounded(row.speaker(), source)) {
                String text = CharacterNames.squash(ScriptText.visible(line.text()));
                Row before = above == null ? null : rows.get(above.no());
                String name = before != null && before.kind() == Kind.IGNORE ? SplitDraft.nameOf(above.text()) : "";
                String header = SplitDraft.nameOf(row.header());
                String speaker = NAME_LINE.matcher(header).matches() ? header : known.stream()
                        .filter(listed -> CharacterNames.squash(listed).length() >= 2 && text.startsWith(CharacterNames.squash(listed)))
                        .findFirst().orElse(NAME_LINE.matcher(name).matches() ? name : null);
                if (speaker != null) {
                    found.put(line.no(), speaker);
                    votes.computeIfAbsent(row.speaker(), key -> new LinkedHashMap<>()).merge(speaker, 1, Integer::sum);
                }
            }
            above = line;
        }
        rows.replaceAll((no, row) -> {
            if (row.kind() != Kind.DIALOGUE || grounded(row.speaker(), source)) {
                return row;
            }
            String speaker = found.getOrDefault(no, votes.getOrDefault(row.speaker(), Map.of()).entrySet().stream()
                    .max(Map.Entry.comparingByValue()).map(Map.Entry::getKey).orElse(row.speaker()));
            return new Row(no, Kind.DIALOGUE, speaker, row.header());
        });
    }

    /**
     * 머리가 줄 시작과 달라 버린 줄을 다시 물어 받은 화자가 원문 어디에도 없고 다른 줄에도 없는 새 이름이면, 버린 첫 답의 화자가 다른 줄에서 쓰는
     * 이름일 때 그 화자로 되돌린다 (SOMA-663 M8 N4). 머리는 계속 버린다 — 첫 답의 화자 계보만 잇는다. 이름 없는 한 사람의 말에서 첫 줄만 다시
     * 묻자 지어낸 새 이름(「브릭」)이 생겨 같은 사람이 갈렸다(재생 158). 원문에 있는 이름이나 다른 줄도 쓰는 이름으로 다시 답했으면 그 답을 둔다.
     */
    public static void lineage(List<NumberedLine> lines, Map<Integer, Row> rows, Map<Integer, Row> refused) {
        String source = CharacterNames.squash(ScriptText.visible(String.join("\n", lines.stream().map(NumberedLine::text).toList())));
        Map<String, Long> uses = rows.values().stream().filter(row -> row.kind() == Kind.DIALOGUE)
                .collect(Collectors.groupingBy(Row::speaker, LinkedHashMap::new, Collectors.counting()));
        refused.forEach((no, first) -> {
            Row row = rows.get(no);
            if (row == null || row.kind() != Kind.DIALOGUE || first.kind() != Kind.DIALOGUE || first.speaker().isBlank()
                    || row.speaker().equals(first.speaker()) || grounded(row.speaker(), source) || uses.getOrDefault(row.speaker(), 0L) > 1
                    || uses.getOrDefault(first.speaker(), 0L) == 0) {
                return;
            }
            rows.put(no, new Row(no, Kind.DIALOGUE, first.speaker(), row.header()));
        });
    }

    /**
     * 이름 없는 대사 규칙으로 다시 나눈 답에서 원문 머리로 이름을 밝힌 화자 하나와 혼자 말하는 사람 「화자」만 있고, 이름 밝힌 말이 먼저 나오며 장면이
     * 바뀌지 않으면 「화자」는 그 사람이다 — 이름표가 첫 줄에만 있는 독백의 이어지는 말을 「화자」로 갈랐다(SOMA-663 M8 N5, 재생 110). 이름이
     * 둘 이상이거나 「화자1」·「화자2」처럼 여럿이 주고받는 답, 장면 줄이 있는 답은 그대로 둔다.
     */
    public static void monologue(Map<Integer, Row> rows) {
        List<Row> spoken = rows.values().stream().filter(row -> row.kind() == Kind.DIALOGUE).sorted(Comparator.comparingInt(Row::no)).toList();
        List<String> names = spoken.stream().map(Row::speaker).distinct().toList();
        if (names.size() != 2 || !names.contains(MONOLOGUE) || rows.values().stream().anyMatch(row -> row.kind() == Kind.SCENE)) {
            return;
        }
        String named = names.getFirst().equals(MONOLOGUE) ? null : names.getFirst();
        if (named == null || spoken.stream().noneMatch(row -> row.speaker().equals(named) && !row.header().isBlank())) {
            return;
        }
        rows.replaceAll((no, row) -> row.kind() == Kind.DIALOGUE && row.speaker().equals(MONOLOGUE)
                ? new Row(no, Kind.DIALOGUE, named, row.header()) : row);
    }

    /**
     * 효과음 표기(「(음 향)」·「효과음」)나 괄호로만 된 화자(「(천둥)」)의 대사 판정을 지문으로 바꾼다 (SOMA-709). 머리도 버려 줄 글이 그대로 지문이
     * 된다. 괄호 안이 다른 줄이 쓰는 배역 이름이거나 내레이션·화면 밖 목소리 표시면 둔다.
     */
    public static void sounds(Map<Integer, Row> rows) {
        Set<String> known = rows.values().stream().filter(row -> row.kind() == Kind.DIALOGUE).map(row -> CharacterNames.squash(row.speaker()))
                .collect(Collectors.toSet());
        rows.replaceAll((no, row) -> {
            String name = CharacterNames.squash(row.speaker());
            boolean wrapped = name.length() > 2 && name.startsWith("(") && name.endsWith(")");
            String inner = wrapped ? name.substring(1, name.length() - 1) : name;
            boolean sound = SOUND.matcher(inner).matches()
                    || wrapped && !known.contains(inner) && !CharacterNames.narration(inner) && !CharacterNames.narration(name)
                    && !VOICE.matcher(inner).matches();
            return row.kind() == Kind.DIALOGUE && sound ? new Row(no, Kind.DIRECTION, "", "") : row;
        });
    }

    /**
     * 화자 칸에 이름 조각이 든 대사 판정을 고친다 (SOMA-709). 그 줄(블록 형식이면 위 이름 줄)이 원문 머리로 더 긴 배역 이름을 쓰면 그 배역이다
     * (「젊은」 → 「젊은 시워드」). 원문 머리로 한 번도 쓰이지 않은 의심 이름 — 접속사·대명사 낱말, 「~의/~은/~는」으로 끝나는 말, 깨진 글자가
     * 섞인 이름, 대본 전체에서 {@link SpeakerMerge#RARE} 줄 이하인 이름 — 은 판정에서 빼고 돌려준다. 빠진 줄 다시 묻기가 이 줄을 다시 묻고,
     * 그래도 답이 없으면 돌려받은 판정으로 되돌린다. 「하은」처럼 ~은 으로 끝나는 이름도 원문 머리면 이름이다. 배역 이름만 이은 함께 말하기
     * 화자는 보지 않는다.
     *
     * @param roster 배역 목록 호출이 준 이름들 — 더 긴 배역 이름 후보에 더한다
     * @return 다시 물을 줄의 원래 판정
     */
    public static Map<Integer, Row> fragments(List<NumberedLine> lines, Map<Integer, Row> rows, List<String> roster) {
        Map<String, Integer> count = new LinkedHashMap<>();
        rows.values().stream().filter(row -> row.kind() == Kind.DIALOGUE && !row.speaker().isBlank())
                .forEach(row -> count.merge(row.speaker(), 1, Integer::sum));
        Set<String> names = new LinkedHashSet<>(roster);
        names.addAll(count.keySet());
        Set<String> squashed = names.stream().map(CharacterNames::squash).collect(Collectors.toSet());
        Map<String, Boolean> headed = new HashMap<>();
        String block = null;
        for (NumberedLine line : lines) {
            Row row = rows.get(line.no());
            if (row == null || row.kind() != Kind.DIALOGUE && row.kind() != Kind.IGNORE) {
                block = null;
                continue;
            }
            if (row.kind() == Kind.IGNORE) {
                block = line.text();
                continue;
            }
            String speaker = row.speaker();
            if (speaker.isBlank()) {
                continue;
            }
            String source = block;
            String longer = names.stream().filter(name -> !name.equals(speaker) && CharacterNames.squash(name).length() > CharacterNames.squash(speaker).length()
                    && CharacterNames.squash(name).startsWith(CharacterNames.squash(speaker))
                    && (headed(line.text(), name) || source != null && CharacterNames.squash(source).equals(CharacterNames.squash(name))))
                    .max(Comparator.comparingInt(String::length)).orElse(null);
            if (longer != null) {
                rows.put(line.no(), new Row(line.no(), Kind.DIALOGUE, longer, ""));
            } else if (headed(line.text(), speaker) || source != null && CharacterNames.squash(source).equals(CharacterNames.squash(speaker))) {
                headed.put(speaker, true);
            }
        }
        Map<Integer, Row> asked = new LinkedHashMap<>();
        rows.forEach((no, row) -> {
            String name = row.speaker();
            if (row.kind() != Kind.DIALOGUE || name.isBlank() || headed.containsKey(name)
                    || Stream.of(SPEAKERS.split(name)).count() > 1 && Stream.of(SPEAKERS.split(name)).allMatch(part -> squashed.contains(CharacterNames.squash(part)))) {
                return;
            }
            String bare = CharacterNames.squash(name);
            boolean fragment = FUNCTION_WORD.matcher(bare).matches() || MODIFIER_END.matcher(bare).matches()
                    || CharacterNames.mixesScripts(name) || CharacterNames.hasForeignLetters(name);
            if (fragment || count.getOrDefault(name, 0) <= SpeakerMerge.RARE) {
                asked.put(no, row);
            }
        });
        asked.keySet().forEach(rows::remove);
        return asked;
    }

    /** 줄이 그 이름(띄어쓰기 무시, 앞 대괄호·괄호 허용)을 원문 머리로 쓰는가 — 이름 뒤가 {@link #HEAD_END} 다. */
    static boolean headed(String text, String name) {
        String shown = ScriptText.visible(text).stripLeading();
        int at = shown.startsWith("[") || shown.startsWith("(") ? 1 : 0;
        String wanted = CharacterNames.squash(name);
        int matched = 0;
        while (at < shown.length() && matched < wanted.length()) {
            char c = shown.charAt(at);
            if (Character.isWhitespace(c)) {
                at++;
            } else if (c == wanted.charAt(matched)) {
                at++;
                matched++;
            } else {
                return false;
            }
        }
        return matched == wanted.length() && HEAD_END.matcher(shown.substring(at)).matches();
    }

    private static boolean grounded(String speaker, String source) {
        return List.of(SPEAKERS.split(speaker)).stream().map(CharacterNames::squash).allMatch(source::contains);
    }

    /**
     * 줄이 {@code 이름:}·{@code [이름]}·{@code 이름⇥} 처럼 아는 배역 이름 + 구분 부호·탭·U+3000·공백 두 칸으로 시작하면 그 이름. 공백 한
     * 칸은 보지 않는다 — 앞 대사가 이어지는 줄이 「트레이시 턴블라드가 소개하는 춤 입니다」처럼 이름으로 시작할 수 있다.
     */
    private static String leadingName(String text, List<String> known) {
        String line = ScriptText.visible(text).stripLeading();
        int start = line.startsWith("[") || line.startsWith("(") ? 1 : 0;
        for (String name : known) {
            int end = start + name.length();
            if (!line.startsWith(name, start) || end >= line.length()) {
                continue;
            }
            if ("\t\u3000:：.)]".indexOf(line.charAt(end)) >= 0 || line.startsWith("  ", end)) {
                return name;
            }
        }
        return null;
    }

    /**
     * 줄 하나의 판정.
     *
     * @param header 그 줄 맨 앞에서 뗄 부분(예: {@code 윤서: }). 없으면 빈 문자열
     */
    public record Row(int no, Kind kind, String speaker, String header) {
    }

    /** 모델이 쓰는 한 글자 종류. */
    public enum Kind {
        DIALOGUE("d", "대사"),
        DIRECTION("x", "지문"),
        SCENE("s", "장면머리"),
        TITLE("t", "제목"),
        CAST("c", "등장인물"),
        IGNORE("i", "무시");

        private final String code;
        private final String word;

        Kind(String code, String word) {
            this.code = code;
            this.word = word;
        }

        /** 한 글자(대소문자 무시)나 지시문의 종류 이름({@code 대사}·{@code 지문}·{@code 장면 머리} …). 모르는 꼴은 null. */
        static Kind of(String code) {
            String written = code.strip();
            for (Kind kind : values()) {
                if (kind.code.equalsIgnoreCase(written) || kind.word.equals(written.replace(" ", ""))) {
                    return kind;
                }
            }
            return null;
        }
    }
}
