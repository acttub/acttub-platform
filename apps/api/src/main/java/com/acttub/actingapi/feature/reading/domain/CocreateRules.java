package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.IntUnaryOperator;
import java.util.regex.Pattern;

/**
 * 찍을 대사 같이 만들기(SOMA-721)의 규칙 — 조건을 정하고, 모델이 쓴 대본을 검사한다. 2026-10-19 인계본(로컬 시험판
 * {@code server.py})의 값과 검사를 옮겼고, 코칭용 1인 독백을 더했다.
 *
 * <p>분량은 <b>추정</b>이다: 공백·문장부호를 포함한 대사 5자를 1초로 보고, 허용 범위 ±25% 도 시험 가정이다. 실제 배우의
 * 낭독 시간으로 보정한 값이 아니므로 화면은 「약 1분」처럼 보인다.
 */
public final class CocreateRules {

    /** 고를 수 있는 분량(분). */
    public static final List<Integer> LENGTHS = List.of(1, 3, 10);
    /** 성공한 수정만 센다. 버전을 되돌려도 돌려주지 않는다. */
    public static final int FREE_REVISIONS = 3;
    /** 한 사람이 24시간에 만들 수 있는 대본 수(비용 상한). */
    public static final int DAILY_LIMIT = 20;
    public static final int MAX_CHARACTERS = 4;
    /** 대사 5자 = 1초(추정). */
    public static final int CHARS_PER_SECOND = 5;
    public static final int DIRECTION_MAX = 25;

    public static final List<String> EMOTIONS = List.of("설렘", "분노", "슬픔", "긴장", "서운함", "담담함");
    public static final List<String> SITUATIONS = List.of("이별", "오디션 직전", "가족 다툼", "고백", "사과", "오랜만의 재회");
    /** 감정을 고르지 않았다는 앱의 값. 서버가 고른다. */
    public static final String ANY_EMOTION = "잘 모르겠어요";
    public static final String ANY_SITUATION = "아무거나 좋아요";

    /** 경력. 대사 한 줄 길이의 기준이 다르다. */
    public enum Experience {
        BEGINNER("입문 (연기 경험 거의 없음)", 15, 28),
        EXAM("입시생", 15, 40),
        EXPERIENCED("경력자 (단편영화·연극 출연)", 15, 40);

        private final String label;
        private final int lineMin;
        private final int lineMax;

        Experience(String label, int lineMin, int lineMax) {
            this.label = label;
            this.lineMin = lineMin;
            this.lineMax = lineMax;
        }

        public String label() {
            return label;
        }

        public String lineLen() {
            return lineMin + "~" + lineMax;
        }
    }

    /** @param minorAllowed 10대에게도 쓰는가 */
    public record Slot(String name, String text, boolean minorAllowed) {
    }

    public static final List<Slot> ENDINGS = List.of(
            new Slot("떠난다", "배우 배역이 원하는 걸 못 얻고 스스로 자리를 뜬다", true),
            new Slot("털어놓는다", "배우 배역이 숨겨 온 진짜 이유를 말하면서 대화의 흐름이 바뀐다", true),
            new Slot("미룬다", "배우 배역이 결론을 미루고 다음을 기약하는 행동으로 끝난다", true),
            new Slot("받아들인다", "배우 배역이 상대의 결정을 받아들이고 먼저 정리한다", true),
            new Slot("받아낸다", "배우 배역이 끝내 상대의 약속을 받아 낸다", false));

    public static final List<Slot> PROPS = List.of(
            new Slot("종이", "종이 (서류·편지·영수증·원서 중 하나)", true),
            new Slot("선물", "선물 (작은 상자)", true),
            new Slot("음식", "음식이나 음료", true),
            new Slot("열쇠", "열쇠", true),
            new Slot("휴대폰", "휴대폰 (문자 한 통)", false),
            new Slot("사진", "휴대폰 (사진 한 장)", false),
            new Slot("옷", "옷이나 목도리", false));

    private static final List<String> BAD_DIRECTION = List.of("눈빛", "표정", "숨을", "숨이", "한숨", "망설", "머뭇", "떨리", "떨린",
            "흔들", "한참", "눈을 피", "대답하지 못", "목소리", "울컥", "애써", "감정", "미소", "웃음기", "눈물");
    private static final List<String> WRITTEN = List.of("는 거니", "하는구나.", "이니까요", "것이다", "이었다");
    private static final List<String> EMOTION_WORDS = List.of("서운해", "화났", "화가 나", "슬퍼", "슬프", "설레", "죄책감", "억울해");
    private static final List<String> SAFETY = List.of("한강", "죽고", "죽을", "죽어", "뛰어내", "자살", "토할", "손목", "약을 먹",
            "개자식", "씨발", "새끼");
    private static final Pattern BRACKETS = Pattern.compile("[()（）\\[\\]]");
    private static final Set<String> KINDS = Set.of("scene", "direction", "dialogue");

    private CocreateRules() {
    }

    /**
     * 생성 조건. 수정할 때도 같은 값을 쓴다(배역 수·분량·내 대사 수만 바뀐다).
     *
     * @param actor 「20대 여성」 같은 나이대·성별. 모르면 빈 글
     * @param direction 원하는 방향. 없으면 「없음」
     * @param myLines 배우 배역 대사 줄 수의 기준. 만든 뒤에는 실제 줄 수로 바꾼다
     */
    public record Conditions(
            Experience experience,
            String actor,
            String purpose,
            boolean minor,
            String emotion,
            String situation,
            String direction,
            int characterCount,
            int minutes,
            Slot ending,
            Slot prop,
            int myLines) {

        public boolean monologue() {
            return characterCount == 1;
        }

        public String lineLen() {
            return experience.lineLen();
        }

        public Conditions resized(int count, int lengthMinutes) {
            return new Conditions(experience, actor, purpose, minor, emotion, situation, direction, count, lengthMinutes,
                    ending, prop, defaultMyLines(lengthMinutes, count));
        }

        public Conditions withMyLines(int lines) {
            return new Conditions(experience, actor, purpose, minor, emotion, situation, direction, characterCount, minutes,
                    ending, prop, lines);
        }

        public Conditions withSlot(Slot nextEnding, Slot nextProp) {
            return new Conditions(experience, actor, purpose, minor, emotion, situation, direction, characterCount, minutes,
                    nextEnding, nextProp, myLines);
        }
    }

    /** 문제 하나. {@code index} 가 없으면 줄 하나로 고칠 수 없는 구조 문제다. */
    public record Issue(Integer index, String why) {

        public boolean structural() {
            return index == null;
        }

        /** 고친 뒤에도 남으면 보이지 않는 문제 — 구조·안전·연속 발화. 줄 길이 같은 가벼운 경고는 보인다. */
        public boolean fatal() {
            return index == null || why.startsWith("안전") || why.contains("연속");
        }
    }

    public static boolean allowedLength(Integer minutes) {
        return minutes != null && LENGTHS.contains(minutes);
    }

    public static boolean allowedCount(Integer count) {
        return count != null && count >= 1 && count <= MAX_CHARACTERS;
    }

    /** 내 대사 줄 수의 기준 — 대화는 분당 6줄(상대도 합계 6줄), 독백은 분당 12줄. */
    public static int defaultMyLines(int minutes, int count) {
        return count == 1 ? minutes * 12 : minutes * 6;
    }

    public static int targetChars(int minutes) {
        return minutes * 300;
    }

    public static int minChars(int minutes) {
        return minutes * 225;
    }

    public static int maxChars(int minutes) {
        return minutes * 375;
    }

    /** 대사 글자 수로 어림한 낭독 시간(초). */
    public static int estimatedSeconds(CocreatedScript script) {
        return Math.round(script.dialogueChars() / (float) CHARS_PER_SECOND);
    }

    /** 생성·수정 프롬프트의 {@code [분량 조건]}. */
    public static String lengthRules(int minutes, int count) {
        int beats = Map.of(1, 3, 3, 4, 10, 6).getOrDefault(minutes, 3);
        String lines = count == 1
                ? "독백 대사 %d줄 안팎이므로 한 대사는 평균 25자에 가깝게 쓴다. ".formatted(minutes * 12)
                : "내 대사 %d줄, 상대역 합계 %d줄 안팎이므로 한 대사는 평균 25자에 가깝게 쓴다. ".formatted(minutes * 6, minutes * 6);
        return ("전체 낭독 분량은 약 %d분이다. 대사 텍스트 합계는 공백·문장부호를 포함해 %d자 안팎으로 쓴다(허용 %d~%d자). ")
                .formatted(minutes, targetChars(minutes), minChars(minutes), maxChars(minutes))
                + lines
                + ("설계도에서 %d개의 흐름을 계획하고 골고루 배분한다. 새 정보, 상대의 반응, 시도의 변화를 만들며 같은 요구나 설명을 "
                        + "반복해서 분량을 채우지 않는다. ").formatted(beats)
                + (count == 1 ? "" : "배역 수가 늘어도 전체 길이는 늘리지 않는다. ")
                + "특히 긴 장면은 도입→첫 시도→새 정보→전술 변화→결정→여운으로 발전시키되 각 흐름에 구체적인 사건을 둔다.";
    }

    /** 수정 프롬프트 4번 규칙의 배역 칸. */
    public static String castRule(int count, int myLines) {
        return count == 1
                ? "1인 독백(상대 대사 없음, 상대의 반응은 짧은 지문으로만), 독백 대사 %d줄 기준".formatted(myLines)
                : "같은 사람의 대사 연속 금지, 배우 배역 대사 %d줄 기준, 상대역 대사 합계도 비슷한 줄 수".formatted(myLines);
    }

    /**
     * 결말·소품을 고른다. 최근에 쓴 것과 이번 요청에서 이미 시도한 것은 피하고, 다 빠지면 처음부터 다시 고른다.
     *
     * @param pick 0 이상 n 미만의 수를 고르는 함수(테스트가 고정한다)
     */
    public static Slot pick(List<Slot> slots, boolean minor, Collection<String> avoid, IntUnaryOperator pick) {
        List<Slot> open = slots.stream().filter(slot -> slot.minorAllowed() || !minor).toList();
        List<Slot> fresh = open.stream().filter(slot -> !avoid.contains(slot.name())).toList();
        List<Slot> pool = fresh.isEmpty() ? open : fresh;
        return pool.get(Math.floorMod(pick.applyAsInt(pool.size()), pool.size()));
    }

    /** 배역 수와 요청을 프롬프트의 {@code characters} 자리에 넣을 예시 JSON. */
    public static String charactersSchema(int count) {
        List<String> items = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            items.add("{\"name\":\"이름\",\"gender\":\"m 또는 f\",\"age_band\":\"child, young, adult, senior 중 하나\",\"mine\":"
                    + (i == 0) + "}");
        }
        return "[" + String.join(",", items) + "]";
    }

    /**
     * 모델이 쓴 대본을 검사한다. 구조가 깨졌으면 그 문제 하나만 돌려준다.
     */
    public static List<Issue> check(CocreatedScript script, Conditions conditions) {
        Issue broken = structure(script);
        if (broken != null) {
            return List.of(broken);
        }
        String[] range = conditions.lineLen().split("~");
        int lo = Integer.parseInt(range[0]);
        int hi = Integer.parseInt(range[1]);
        List<Issue> issues = new ArrayList<>();
        List<CocreatedScript.Line> lines = script.lines();
        String mine = script.mine().name();
        List<Integer> dialogue = new ArrayList<>();
        for (int i = 0; i < lines.size(); i++) {
            if ("dialogue".equals(lines.get(i).kind())) {
                dialogue.add(i);
            }
        }
        int myCount = script.myLines();
        if (script.characters().size() != conditions.characterCount()) {
            issues.add(new Issue(null, "배역 수 %d명(선택 %d명)".formatted(script.characters().size(), conditions.characterCount())));
        }
        Set<String> speakers = new HashSet<>();
        dialogue.forEach(i -> speakers.add(lines.get(i).character()));
        if (speakers.size() != script.characters().size()) {
            issues.add(new Issue(null, "대사가 없는 배역"));
        }
        if (!conditions.monologue()) {
            double share = dialogue.isEmpty() ? 0 : myCount / (double) dialogue.size();
            if (share < .25 || share > .6) {
                issues.add(new Issue(null, "내 배역의 대사 비중이 너무 적거나 많음"));
            }
            for (int k = 1; k < dialogue.size(); k++) {
                int a = dialogue.get(k - 1);
                int b = dialogue.get(k);
                if (b == a + 1 && lines.get(a).character().equals(lines.get(b).character())) {
                    issues.add(new Issue(b, "같은 사람이 연속으로 말함"));
                }
            }
        }
        int chars = script.dialogueChars();
        int minutes = conditions.minutes();
        if (chars < minChars(minutes) || chars > maxChars(minutes)) {
            issues.add(new Issue(null, "분량 %d자(목표 %d분, 허용 %d~%d자)".formatted(chars, minutes, minChars(minutes), maxChars(minutes))));
        }
        for (int i = 0; i < lines.size(); i++) {
            CocreatedScript.Line line = lines.get(i);
            String text = line.text();
            if (SAFETY.stream().anyMatch(text::contains)) {
                issues.add(new Issue(i, "안전 금지어(죽음·자해·욕설·몸 이상)"));
            }
            if ("dialogue".equals(line.kind())) {
                if (text.length() < lo || text.length() > hi) {
                    issues.add(new Issue(i, "길이 %d자(기준 %s자)".formatted(text.length(), conditions.lineLen())));
                }
                if (BRACKETS.matcher(text).find()) {
                    issues.add(new Issue(i, "대사 안 괄호"));
                }
                if (EMOTION_WORDS.stream().anyMatch(text::contains)) {
                    issues.add(new Issue(i, "감정 이름을 대사로 말함"));
                }
                if (WRITTEN.stream().anyMatch(text::contains)) {
                    issues.add(new Issue(i, "글 같은 어미"));
                }
            } else if ("direction".equals(line.kind())) {
                if (text.length() > DIRECTION_MAX) {
                    issues.add(new Issue(i, "지문 %d자(25자 이내)".formatted(text.length())));
                }
                List<String> bad = BAD_DIRECTION.stream().filter(text::contains).toList();
                if (!bad.isEmpty()) {
                    issues.add(new Issue(i, "지문에 표정·속마음(%s)".formatted(String.join(",", bad))));
                }
            }
        }
        return List.copyOf(issues);
    }

    private static Issue structure(CocreatedScript script) {
        if (script == null || script.title() == null || script.title().isBlank()) {
            return new Issue(null, "대본 JSON 구조 오류");
        }
        Set<String> names = new HashSet<>();
        int mine = 0;
        for (CocreatedScript.Role role : script.characters()) {
            if (role.name() == null || role.name().isBlank() || !names.add(role.name())) {
                return new Issue(null, "내 배역 지정 또는 배역 이름 오류");
            }
            mine += role.mine() ? 1 : 0;
        }
        if (mine != 1) {
            return new Issue(null, "내 배역 지정 또는 배역 이름 오류");
        }
        if (script.lines().isEmpty()) {
            return new Issue(null, "대사 JSON 구조 오류");
        }
        for (CocreatedScript.Line line : script.lines()) {
            if (!KINDS.contains(line.kind()) || line.text() == null || line.text().isBlank()) {
                return new Issue(null, "대사 JSON 구조 오류");
            }
            if ("dialogue".equals(line.kind()) != (line.character() != null)) {
                return new Issue(null, "대사 JSON 구조 오류");
            }
            if (line.character() != null && !names.contains(line.character())) {
                return new Issue(null, "모르는 배역의 대사");
            }
        }
        return null;
    }
}
