package com.acttub.actingapi.feature.reading.domain;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.reading.domain.SplitResponse.Kind;
import com.acttub.actingapi.feature.reading.domain.SplitResponse.Row;

/**
 * 규칙 나누기 (SOMA-1090). 나누기 모델과 같은 답 — 줄마다 종류·배역·떼어낼 머리({@link SplitResponse.Row}) — 을 원문 모양만 보고 낸다.
 * 확신하는 줄만 답하고 나머지는 비워 둔다. 워커는 빈 줄만 「빠진 줄 다시 묻기」로 모델에 보낸다(하이브리드).
 *
 * <p>규칙은 나누기 지시문({@code ScriptSplitPrompt})을 그대로 옮긴다: 쪽 번호·반복 머리글·블록 형식의 이름 줄은 무시,
 * 괄호로만 된 줄은 지문, 대사 안의 짧은 괄호 지문은 대사에 둔다. 배역은 등장인물 소개·쌍점 머리·대괄호 머리·대문자 이름+마침표·
 * 블록 이름 줄에서 모으고, 「이름 + 띄어쓰기」 머리는 그렇게 모은 이름이거나 다른 모양이 주된 대본이 아닐 때 자주 줄 앞에 나오는
 * 이름만 받는다. 머리는 조립({@link SplitDraft})이 화자 이름으로 원문에서 다시 찾으므로 여기 머리는 참고값이다.
 *
 * <p>빈 줄: 원문의 빈 줄과, 보이지 않는 글자(폭 없는 공백·한글 채움 문자·줄바꿈 없는 공백)만 있는 줄. 블록은 빈 줄에서 끝난다.
 *
 * <p>판단을 못 하는 줄(머리 없는 줄이 대사 바로 뒤에 붙어 있음 등)은 답하지 않는다. 2026-11-19 운영 대본 1,784편 재생에서 반복 쪽
 * 머리글이 블록 이름으로, 한글 채움 문자 줄이 글 있는 줄로 읽혀 블록형 일치가 23%였다 — 그 두 자리를 막았다.
 */
public final class RuleSplit {

    /** 대본의 주된 머리 모양. 보고·평가용이다. */
    public enum Format { COLON, BRACKET, PERIOD, BLOCK, SPACE, MIXED, NONE }

    /**
     * @param rows 답한 줄. 번호 → 판정
     * @param roster 모은 배역 이름(처음 나온 순서) 중 대사가 있는 것
     * @param format 주된 머리 모양
     * @param total 받은 줄 수
     */
    public record Result(Map<Integer, Row> rows, List<String> roster, Format format, int total) {
        /** 답한 줄의 비율. */
        public double coverage() {
            return total == 0 ? 0 : (double) rows.size() / total;
        }

        /** 대사 줄 수. */
        public long dialogues() {
            return rows.values().stream().filter(row -> row.kind() == Kind.DIALOGUE).count();
        }

        /**
         * 모델 첫 판을 건너뛰어도 되는가 — 배역이 있고, 대사를 셋 이상 잡았고, 답한 줄이 하한 이상이다. 아니면 지금처럼 모델이
         * 처음부터 나눈다(대본 판단 포함).
         */
        public boolean confident() {
            return !roster.isEmpty() && dialogues() >= MIN_DIALOGUES && coverage() >= MIN_COVERAGE;
        }
    }

    /**
     * 규칙이 이만큼 이상 답해야 모델 첫 판을 건너뛴다. 나머지는 빠진 줄로 모델이 답한다. 2026-11-19 운영 대본 재생: 답 비율 0.5~0.6 구간의
     * 규칙 정밀도(저장된 AI 결과와 같은 종류·화자)가 88.6%, 0.4~0.5 구간은 79.7%라 0.5에서 끊는다.
     */
    public static final double MIN_COVERAGE = 0.5;
    static final int MIN_DIALOGUES = 3;
    /** 「이름 + 띄어쓰기」 머리를 소개 없이 받으려면 이만큼 이상 줄 앞에 나와야 한다. */
    static final int SPACE_HEAD_MIN = 3;
    /** 배역 이름 길이 상한(글자). 「남자 1」「LOMOV」「어머니」 정도를 넘는 머리는 이름이 아니라 말이다. */
    static final int NAME_MAX = 12;

    /** 보이지 않거나 공백 노릇만 하는 글자 — 폭 없는 공백, BOM, 단어 결합자, 한글 채움 문자(ㅤ·ﾠ·초성·중성 채움), 줄바꿈 없는 공백들. */
    private static final Pattern INVISIBLE = Pattern.compile("[\\u0000\\u200B-\\u200D\\uFEFF\\u2060\\u3164\\uFFA0\\u115F\\u1160\\u00A0\\u2007\\u202F]");
    private static final Pattern PAGE = Pattern.compile("(?i)[-–—(\\[]?\\s*(?:p\\.?|page|쪽)?\\s*\\d{1,3}\\s*(?:쪽|/\\s*\\d{1,3})?\\s*[-–—)\\]]?");
    private static final Pattern DIGITS = Pattern.compile("\\d+");
    private static final Pattern SCENE = Pattern.compile(
            "(?iu)(?:s\\s*#\\s*\\d+|#\\s*\\d+|씬\\s*\\d+|scene\\s+[0-9ivx]+|act\\s+[0-9ivx]+|int\\.|ext\\.|"
                    + "제\\s*[0-9일이삼사오육칠팔구십]+\\s*(?:막|장|경|장면)|[0-9]+\\s*(?:막|장)(?=\\s|$|[.:])|프롤로그|에필로그|막간)(?:\\b|\\s|[.:/,]|$).*");
    /** 괄호 한 묶음이 줄 전체인 줄 — 「(웃으며)」「[무대 어두워진다]」. 「[민수] 가자! (웃으며)」처럼 대괄호로 시작해 괄호로 끝나는 대사 줄은 아니다. */
    private static final Pattern PAREN_ONLY = Pattern.compile("\\([^()]*\\)|（[^（）]*）|\\[[^\\[\\]]*]|［[^［］]*］");
    /** 이름 줄 괄호 속 목소리 표시 — 「민수 (V.O.)」는 이름 줄이고, 「민수 (창밖을 본다)」는 그 사람의 행동 지문이다. */
    private static final Pattern VOICE_MARK = Pattern.compile(
            "(?iu)\\s*(?:v\\.?\\s*o\\.?|o\\.?\\s*s\\.?|o\\.?\\s*c\\.?|e|f|off|cont'?d|소리|목소리|전화|전화\\s*목소리|내레이션|나레이션|독백|방백|노래|이어서|계속|속마음|생각|화면|영상|녹음|음성)\\s*");
    private static final Pattern NAME_PAREN = Pattern.compile(".*?[(（]([^)）]*)[)）]\\s*");
    /** 장면 표기 더 — 「12. 거실, 밤」「- 암전 -」「장면 2」「S# 골목 - 밤」. */
    private static final Pattern SCENE_MORE = Pattern.compile(
            "(?iu)\\d{1,3}\\.\\s*[^.!?]{1,20}?[,/\\-–].*|[-–—=~*]\\s*[가-힣A-Za-z]{1,4}\\s*[-–—=~*]|"
                    + "(?:장면|막|장|씬|신|에피소드|챕터|파트|part|chapter|episode)\\s*\\d{1,3}\\s*[.:]?|s\\s*#.*");
    /** 작가·연출 표기 줄. 「작」「글」은 쌍점이 있을 때만(「글쎄, …」는 대사다). */
    private static final Pattern AUTHOR = Pattern.compile(
            "(?iu)(?:(?:작|글)\\s*[:：]|(?:극본|각본|각색|원작|연출|작가|지은이)\\s*[:：]?|written by\\b|by\\s)\\s*\\S.*");
    /** 만든 사람 표기 — 「지도교사 : …」「무대감독: …」. 대사 앞이면 제목 묶음이다. */
    private static final Pattern CREDIT = Pattern.compile(
            "(?iu)(?:지도\\s*(?:교사|선생님?)|학생\\s*연출|조연출|연출|무대\\s*감독|기획(?:\\s*팀장)?|제작|프로듀서|pd|촬영|편집|안무|"
                    + "음악\\s*감독|음향|조명|의상|분장|소품|무대|무대\\s*디자인|드라마투르그|각색|극본|작가|원작|번역|출연)"
                    + "(?:\\s*(?:감독|팀장|담당|팀|디자이너|디자인|크루))?");
    private static final Pattern CAST_HEADER = Pattern.compile(
            "(?iu)(?:등장\\s*인물|나오는\\s*(?:사람들?|이들?|인물들?)|등장인물\\s*소개|배역|인물|cast|characters)\\s*(?:[:：]\\s*(.*))?");
    /** 소개 줄: 「윤기 --- 서른둘」「민재: 스물일곱, …」「세라(29) …」「아이, 일곱 살」. */
    private static final Pattern CAST_LINE = Pattern.compile("([^\\s:：,(（\\-–—]{1,12}(?: [0-9A-Za-z]{1,3})?)\\s*(?:[-–—]{1,3}|[:：]|[,(（]|\\s{2,})\\s*\\S.*");
    private static final Pattern COLON_HEAD = Pattern.compile("([^\\s:：()（）\\[\\]][^:：]{0,13}?)\\s*[:：]\\s*(?=\\S)");
    private static final Pattern BRACKET_HEAD = Pattern.compile("\\[\\s*([^\\]]{1,12}?)\\s*]\\s*(?=\\S)");
    private static final Pattern PERIOD_HEAD = Pattern.compile("([A-Z][A-Z'\\- ]{0,18}[A-Z])\\.\\s+(?=\\S)");
    private static final Pattern SPACE_HEAD = Pattern.compile("(\\S{1,8})(\\s+)(?=\\S)");
    /** 글자 사이를 띄운 이름 머리: 「베 티 …」「헤 일 …」(양쪽 맞춤 PDF). 한 글자씩 띄운 2~4글자. */
    private static final Pattern SPACED_HEAD = Pattern.compile("(\\p{IsHangul}(?: \\p{IsHangul}){1,3})\\s+(?=\\S)");
    /** 조연 이름으로 받지 않을 끝 글자 — 조사·어미(「당신이」「대해서」「사람들한테」). */
    private static final Pattern MINOR_NOT = Pattern.compile(".*(?:이|서|고|도|만|지|니|나|한테|에게|께|랑|와|과|로|의|면|며|데|게|는|은|가|를|을|에|요|다|야|어|아)");
    /** 탭으로 나눈 머리: 「택배⇥…」. 표에서 옮긴 대본이 이 모양이다. */
    private static final Pattern TAB_HEAD = Pattern.compile("([^\\t]{1,12}?)\\s*\\t\\s*(?=\\S)");
    /** 띄어쓰기 두 칸 이상으로 나눈 머리. 탭과 함께 강한 구분이다. */
    private static final Pattern WIDE_HEAD = Pattern.compile("(\\S{1,8})(\\s{2,}|\\t)(?=\\S)");
    /** 마침표·서술 끝으로 닫힌 줄. */
    private static final Pattern CLOSED = Pattern.compile(".*(?:[.。]|다|음|함|중)[\"”’')）]*");
    /** 서술 지문 끝 — 「~한다.」「~선다.」「~있다.」 */
    private static final Pattern NARRATIVE = Pattern.compile(".*(?:[는ㄴ]다|한다|있다|없다|된다|본다|간다|온다|선다|앉는다|든다|난다|진다|켠다|끈다)[.。]?[\"”’']?");
    /** 대사 말투로 끝나는 줄. */
    private static final Pattern SPEECH_END = Pattern.compile(".*(?:[?!~♪]|요|야|아|어|여|해|워|와|라|냐|지|니|까|네|래|게|줘|자|죠|군|구나|거든|잖아|라고|는데|는걸|ㅋ|ㅎ)[.!?…~]*[\"”’']?");
    /** 「[페이지] 12」처럼 쪽을 대괄호로 적은 줄. */
    private static final Pattern BRACKET_PAGE = Pattern.compile("\\[[^\\]]{1,10}]\\s*\\d{1,4}\\s*");
    /** 「[막] 1장」「[씬 3]」처럼 장면을 대괄호로 적은 줄. */
    private static final Pattern BRACKET_SCENE = Pattern.compile("\\[\\s*(?:막|장|씬|장면|scene|act)\\s*[0-9]*\\s*]\\s*.*", Pattern.CASE_INSENSITIVE);
    /** 블록 이름 줄: 짧은 이름 하나(괄호 꼬리 허용 — 「민수 (V.O.)」). */
    private static final Pattern NAME_LINE = Pattern.compile("([\\p{L}\\p{N}][\\p{L}\\p{N} ]{0,10}?)\\s*(?:[(（][^)）]{1,12}[)）])?");
    /** 문장으로 끝나거나 말을 담은 글 — 이름이 아니다. */
    private static final Pattern SENTENCE_END = Pattern.compile(".*[.?!…。~,]$");
    /** 줄 앞에 자주 오지만 배역 이름이 아닌 말. */
    private static final Set<String> NOT_NAMES = Set.copyOf(List.of(
            "아니", "아니야", "아냐", "그래", "그래서", "그럼", "그러면", "그런데", "근데", "그리고", "그러나", "하지만", "그냥", "그게",
            "그거", "이거", "저거", "이건", "그건", "저건", "네", "예", "응", "어", "아", "야", "왜", "뭐", "뭘", "진짜", "정말", "지금",
            "오늘", "내일", "어제", "내가", "나는", "난", "너는", "넌", "우리", "우린", "저는", "전", "제가", "당신", "자네", "너", "나",
            "저", "제", "그", "그녀", "이", "좀", "잠깐", "제발", "다시", "또", "아직", "벌써", "이제", "그때", "여기", "거기", "저기",
            "어디", "언제", "누가", "무슨", "어떻게", "왜요", "네가", "니가", "내", "다", "더", "안", "못", "잘", "참", "혹시",
            "그러니까", "그니까", "있잖아", "알았어", "모르겠어", "괜찮아", "미안해", "고마워", "어머", "어머나", "아이고", "음", "흠",
            "(사이)", "사이", "암전", "조명", "음악", "효과", "소리", "다음", "처음", "마지막", "모두", "다들", "함께", "같이",
            "페이지", "쪽", "막", "장", "씬", "장면", "page", "scene", "act", "주", "참고", "각주", "메모", "노트"));

    private RuleSplit() {
    }

    public static Result of(List<NumberedLine> lines) {
        Text text = new Text(lines);
        Map<Integer, Row> rows = new LinkedHashMap<>();
        Set<String> names = new LinkedHashSet<>();

        // 1. 등장인물 소개(머리줄 + 이어지는 소개 줄, 또는 「등장인물: 하람, 보라」 한 줄)
        Set<Integer> cast = castSection(text, names);
        Set<String> castNames = Set.copyOf(names);

        // 2. 반복 머리글: 숫자를 # 로 바꿔 같은 글이 첫 줄과 같거나, 숫자가 든 글이 세 번 이상
        Map<String, Integer> repeats = new HashMap<>();
        for (int i = 0; i < text.size(); i++) {
            if (!text.blank(i)) repeats.merge(digitless(text.get(i)), 1, Integer::sum);
        }
        int firstIndex = text.firstContent();
        // 첫 줄이 제목처럼 혼자 떨어져 있을 때만 그 글의 반복을 머리글로 본다 — 첫 줄이 블록 이름(「수아」)인 대본이 있다
        boolean titleFirst = firstIndex >= 0 && (!text.adjacent(firstIndex, firstIndex + 1)
                || PAGE.matcher(text.get(firstIndex + 1)).matches());
        String firstKey = titleFirst ? digitless(text.get(firstIndex)) : null;

        // 3. 머리 후보를 세어 배역을 모은다(나온 순서를 지킨다)
        Map<String, Integer> colon = new LinkedHashMap<>();
        Map<String, Integer> bracket = new LinkedHashMap<>();
        Map<String, Integer> period = new LinkedHashMap<>();
        Map<String, Integer> standalone = new LinkedHashMap<>();
        Set<String> headerish = new HashSet<>();
        Map<String, Integer> first = new LinkedHashMap<>();
        Map<String, Integer> tab = new LinkedHashMap<>();
        Map<String, Integer> wide = new LinkedHashMap<>();
        int nonEmpty = text.contentCount();
        // 글자 사이를 띄운 이름: 줄 앞 한 글자씩 띄운 글의 앞부분(2글자 이상)을 이어 붙여 센다
        Map<String, Integer> spacedCount = new LinkedHashMap<>();
        for (int i = 0; i < text.size(); i++) {
            if (cast.contains(i) || text.blank(i)) continue;
            for (String joined : spacedPrefixes(text.get(i))) spacedCount.merge(joined, 1, Integer::sum);
        }
        Set<String> spacedNames = new LinkedHashSet<>();
        spacedCount.forEach((name, n) -> {
            if (n >= SPACE_HEAD_MIN && n * 50 >= nonEmpty && hangulName(name) && name.length() >= 2) spacedNames.add(name);
        });
        // 더 긴 이름이 절반 이상 같이 나오면 짧은 쪽은 그 앞부분일 뿐이다(「아비게」↔「아비게일」)
        Set<String> spacedAll = Set.copyOf(spacedNames);
        spacedNames.removeIf(name -> spacedAll.stream().anyMatch(other -> other.length() > name.length() && other.startsWith(name)
                && spacedCount.get(other) * 2 >= spacedCount.get(name)));
        for (int i = 0; i < text.size(); i++) {
            if (cast.contains(i) || text.blank(i)) continue;
            String t = text.get(i);
            String name = colonName(t);
            if (name != null) colon.merge(name, 1, Integer::sum);
            name = group(BRACKET_HEAD, t);
            if (name != null && nameLike(name)) bracket.merge(name, 1, Integer::sum);
            name = group(PERIOD_HEAD, t);
            if (name != null) period.merge(name, 1, Integer::sum);
            name = standaloneName(t);
            if (name != null && text.adjacent(i, i + 1) && standaloneName(text.get(i + 1)) == null) {
                standalone.merge(name, 1, Integer::sum);
                // 쪽 번호 옆이나 반복 머리글 자리의 짧은 줄은 이름이 아니라 머리글이다
                if (pageNear(text, i) || i != firstIndex && digitless(t).equals(firstKey)) headerish.add(name);
                if (i == firstIndex && titleFirst) headerish.add(name);
            }
            name = group(SPACE_HEAD, t);
            boolean spacedLine = spacedPrefixes(t).stream().anyMatch(spacedNames::contains);
            if (name != null && nameLike(name) && !spacedLine) first.merge(name, 1, Integer::sum);
            name = group(TAB_HEAD, t);
            if (name != null && nameLike(name.strip())) tab.merge(name.strip(), 1, Integer::sum);
            name = group(WIDE_HEAD, t);
            if (name != null && nameLike(name)) wide.merge(name, 1, Integer::sum);
        }
        String firstLine = firstIndex < 0 ? "" : text.get(firstIndex);
        // 쌍점·대괄호·대문자 머리가 대본의 주된 모양이면 한 번만 말하는 배역도 받는다 — 첫 줄만 빼고(「독백: 문 앞에서」 같은 제목)
        boolean colonFormat = dominant(colon, nonEmpty);
        boolean bracketFormat = dominant(bracket, nonEmpty);
        boolean periodFormat = dominant(period, nonEmpty);
        String firstColon = colonName(firstLine);
        String firstBracket = group(BRACKET_HEAD, firstLine);
        colon.forEach((name, n) -> {
            if (n == 1 && CREDIT.matcher(name).matches()) return;
            if (n >= 2 || castNames.contains(name) || colonFormat && !name.equals(firstColon) && shortName(name)) names.add(name);
        });
        bracket.forEach((name, n) -> {
            if (n >= 2 || castNames.contains(name) || bracketFormat && !name.equals(firstBracket) && shortName(name)) names.add(name);
        });
        period.forEach((name, n) -> { if (n >= 2 || periodFormat) names.add(name); });
        // 탭 머리: 탭 앞 짧은 이름이 주된 모양이면(표에서 옮긴 대본) 탭 앞을 이름으로 받는다
        boolean tabFormat = dominant(tab, nonEmpty);
        if (tabFormat) {
            tab.forEach((name, n) -> { if (!headerish.contains(name)) names.add(name); });
        }
        // 블록: 서로 다른 이름 둘 이상이 각각 두 번 이상 이름 줄로 나와야 블록 대본이다. 쌍점·대괄호·대문자·탭이 주된 대본은 아니다.
        // 긴 대본은 대사가 길어 이름 줄 비율이 낮다 — 비율이 아니라 횟수로 본다(2026-11-19 재생: 소개에 이름 하나만 잡힌 블록 대본에서
        // 다른 인물 이름 줄이 앞 사람 대사로 이어 붙었다).
        Map<String, Integer> standaloneAll = Map.copyOf(standalone);
        headerish.removeAll(castNames);
        standalone.keySet().removeAll(headerish);
        long repeatedNames = standalone.values().stream().filter(n -> n >= 2).count();
        int blockTotal = standalone.values().stream().mapToInt(Integer::intValue).sum();
        boolean blockFormat = !colonFormat && !bracketFormat && !periodFormat && !tabFormat && repeatedNames >= 2 && blockTotal >= 4;
        standalone.forEach((name, n) -> {
            if (castNames.contains(name) || blockFormat && n >= 2) names.add(name);
        });
        // 「이름 + 띄어쓰기」: 다른 모양이 주된 대본이 아니면 자주 줄 앞에 나오는 이름을 받는다 — 둘 이상이거나 소개가 있을 때만.
        // 블록 대본에서 받으면 블록 대사의 첫 낱말(「다음 줄까지 …」의 「다음」)이 배역이 된다.
        if (!colonFormat && !bracketFormat && !periodFormat && !blockFormat && !tabFormat) {
            List<String> candidates = new ArrayList<>();
            for (Map.Entry<String, Integer> e : first.entrySet()) {
                if (!names.contains(e.getKey()) && e.getValue() >= SPACE_HEAD_MIN && e.getValue() * 50 >= nonEmpty
                        && hangulName(e.getKey())) {
                    candidates.add(e.getKey());
                }
            }
            candidates.addAll(spacedNames);
            if (candidates.size() >= 2 || !castNames.isEmpty()) {
                names.addAll(candidates);
                // 주연이 섰으면 두 번 이상 줄 앞에 나온 이름도 받는다(조연). 조사·어미로 끝나는 낱말은 말이라 뺀다.
                first.forEach((name, n) -> {
                    if (n >= 2 && hangulName(name) && name.length() >= 2 && !MINOR_NOT.matcher(name).matches()) names.add(name);
                });
                // 띄어쓰기형이 섰으면 두 칸 이상·탭으로 떨어진 머리는 한 번만 나와도 이름이다(조연 「택배」)
                wide.forEach((name, n) -> { if (hangulName(name)) names.add(name); });
            }
        }

        // 4. 줄마다 판정
        String block = null;
        boolean unknownBlock = false;
        boolean seenBody = false;
        int previous = -1;
        int[] hits = new int[Format.values().length];
        for (int i = 0; i < text.size(); i++) {
            int no = lines.get(i).no();
            if (text.blank(i)) {
                rows.put(no, row(no, Kind.IGNORE));
                continue;
            }
            String t = text.get(i);
            boolean afterGap = previous < 0 || !text.adjacent(previous, i);
            int before = previous;
            previous = i;
            if (afterGap) {
                block = null;
                unknownBlock = false;
            }
            if (cast.contains(i)) {
                rows.put(no, row(no, Kind.CAST));
                continue;
            }
            if (PAGE.matcher(t).matches() || BRACKET_PAGE.matcher(t).matches()) {
                rows.put(no, row(no, Kind.IGNORE));
                continue;
            }
            String key = digitless(t);
            boolean knownStart = names.contains(standaloneName(t)) || head(t, names) != null;
            // 반복 머리글: 제목 줄의 반복이거나, 쪽 번호 바로 옆에서 숫자만 바뀌며 세 번 이상 나오는 줄
            if (i != firstIndex && !knownStart && (key.equals(firstKey) && repeats.get(key) >= 2
                    || hasDigit(t) && repeats.get(key) >= 3 && between(t, 4, 60) && pageNear(text, i))) {
                rows.put(no, row(no, Kind.IGNORE));
                continue;
            }
            if (scene(t)) {
                rows.put(no, row(no, Kind.SCENE));
                block = null;
                seenBody = true;
                continue;
            }
            String credit = colonName(t);
            boolean creditLine = credit != null && CREDIT.matcher(credit).matches() && !names.contains(credit);
            if (!seenBody && (creditLine || i - Math.max(firstIndex, 0) < 5 && AUTHOR.matcher(t).matches() && !names.contains(credit))) {
                rows.put(no, row(no, Kind.TITLE));
                continue;
            }
            if (PAREN_ONLY.matcher(t).matches()) {
                rows.put(no, row(no, Kind.DIRECTION));
                continue;
            }
            String nameLine = standaloneName(t);
            if (nameLine != null && names.contains(nameLine) && text.adjacent(i, i + 1)) {
                rows.put(no, row(no, actionParen(t) ? Kind.DIRECTION : Kind.IGNORE));
                block = nameLine;
                hits[Format.BLOCK.ordinal()]++;
                seenBody = true;
                continue;
            }
            // 블록 대본에서 받지 않은 이름 같은 줄(한 번만 나온 조연 등): 그 줄과 이어지는 줄은 모델에 맡긴다
            if (blockFormat && nameLine != null && text.adjacent(i, i + 1) && standaloneName(text.get(i + 1)) == null) {
                block = null;
                unknownBlock = true;
                continue;
            }
            Head head = head(t, names);
            if (head != null) {
                String body = t.substring(Math.min(t.length(), head.header.strip().length())).strip();
                // 「노인 (천천히 일어선다)」처럼 이름 뒤가 괄호뿐이면 그 사람의 행동 지문이다
                if (PAREN_ONLY.matcher(body).matches()) {
                    rows.put(no, row(no, Kind.DIRECTION));
                    block = null;
                    unknownBlock = false;
                    seenBody = true;
                    continue;
                }
                // 「이름 + 띄어쓰기」 머리 뒤가 서술(「레베카 일어선다.」)이면 이름으로 시작하는 지문일 수 있다 — 모델에 맡긴다
                if (head.format == Format.SPACE && narrative(body)) {
                    block = null;
                    unknownBlock = false;
                    seenBody = true;
                    continue;
                }
                rows.put(no, new Row(no, Kind.DIALOGUE, head.name, head.header));
                block = null;
                unknownBlock = false;
                seenBody = true;
                hits[head.format.ordinal()]++;
                continue;
            }
            if (unknownBlock) {
                continue;
            }
            if (block != null) {
                // 블록 안에서 처음 보는 이름 같은 줄(이름 줄로 두 번 이상 나온 글)은 다른 사람의 이름 줄일 수 있다 — 블록을 끊고 모델에 맡긴다
                if (nameLine != null && standaloneAll.getOrDefault(nameLine, 0) >= 2) {
                    block = null;
                    continue;
                }
                rows.put(no, new Row(no, Kind.DIALOGUE, block, ""));
                continue;
            }
            // 대사 앞의 첫 줄은 제목이다 — 짧고 이름 머리가 아니면
            if (!seenBody && i == firstIndex && t.codePointCount(0, t.length()) <= 40) {
                rows.put(no, row(no, Kind.TITLE));
                continue;
            }
            // 머리 없는 줄: 바로 앞이 대사이고 빈 줄 없이 이어지면 대사의 이어지는 줄일 수 있다 — 판단하지 않는다
            if (!afterGap && before >= 0 && previousDialogue(rows, lines.get(before).no())) {
                continue;
            }
            // 머리 모양이 분명한 대본에서 따로 떨어진 머리 없는 줄은 지문 말투일 때만 지문이다. 대사 말투(?·!·「~요」)거나 애매하면
            // 모델에 맡긴다 — 빈 줄 뒤에 이어 쓴 대사를 지문으로 단정하던 자리다(2026-11-19 재생: 지문→대사 3만 8천 줄).
            if (!names.isEmpty() && directionLike(t)) {
                rows.put(no, row(no, Kind.DIRECTION));
            }
        }
        List<String> roster = new ArrayList<>();
        for (String name : names) {
            boolean speaks = rows.values().stream().anyMatch(row -> row.kind() == Kind.DIALOGUE && row.speaker().equals(name));
            if (speaks) roster.add(name);
        }
        return new Result(rows, roster, format(hits), lines.size());
    }

    // ── 풀규칙(실험) ─────────────────────────────────────

    /**
     * 풀규칙 (SOMA-1090 실험, 운영 경로에 붙이지 않음): 모델 없이 모든 줄에 답한다. {@link #of}가 답한 줄은 그대로 두고, 비운 줄을 정해진
     * 규칙으로 채운다 — 대사에 바로 이어지는 줄은 서술이면 지문·아니면 앞 사람 대사, 모르는 이름 줄(블록·쌍점·대괄호)은 새 배역, 비운 줄 앞에
     * 두 번 이상 나온 이름 같은 낱말도 배역, 떨어진 줄은 서술이면 지문·아니면 앞 사람 대사. 이름을 하나도 못 찾으면 서술이 대부분인 글은 대본이
     * 아니라고 보고(대사 0), 아니면 한 사람 독백({@link Monologue#PLACEHOLDER})으로 본다. 규칙만으로 어디까지 되는지 재는 용도다.
     */
    public static Result full(List<NumberedLine> lines) {
        return full(lines, true);
    }

    /**
     * @param rejectProse 이름을 못 찾은 산문을 대본 아님(대사 0)으로 둘지. 사용자가 「그래도 나누기」를 골랐으면 false — 한 사람 독백으로 본다.
     */
    public static Result full(List<NumberedLine> lines, boolean rejectProse) {
        Result base = of(lines);
        Text text = new Text(lines);
        Map<Integer, Row> rows = new LinkedHashMap<>(base.rows());
        Set<String> known = new LinkedHashSet<>(base.roster());
        Map<String, Integer> fresh = new HashMap<>();
        for (int i = 0; i < text.size(); i++) {
            if (text.blank(i) || rows.containsKey(lines.get(i).no())) continue;
            String name = leadingName(text.get(i));
            if (name != null) fresh.merge(name, 1, Integer::sum);
        }
        fresh.forEach((name, n) -> {
            // 두 번 이상이면 받는다. 끝 글자 걸러내기(「민서」「은지」)에 걸리는 낱말은 세 번, 한 글자 이름(「준」)은 네 번 이상 나와야 받는다.
            boolean plain = name.length() >= 2 && !MINOR_NOT.matcher(name).matches();
            if (plain ? n >= 2 : n >= (name.length() == 1 ? 4 : 3)) known.add(name);
        });
        boolean prose = rejectProse && known.isEmpty() && proseLike(text);
        boolean monologue = known.isEmpty() && !prose;
        // 독백 화자: 맨 위 세 줄 안에 이름 줄(첫 줄 제목은 빼고)이나 「이름:」만 있는 줄이 있으면 그 이름
        String monologueName = Monologue.PLACEHOLDER;
        if (monologue) {
            int seen = 0;
            for (int i = 0; i < text.size() && seen < 3; i++) {
                if (text.blank(i)) continue;
                seen++;
                String t = text.get(i);
                String alone = t.replaceFirst("\\s*[:：]\\s*$", "");
                String name = seen > 1 ? standaloneName(alone) : null;
                if (name != null && hangulName(name.replace(" ", ""))) {
                    monologueName = name;
                    rows.put(lines.get(i).no(), row(lines.get(i).no(), Kind.IGNORE));
                    break;
                }
            }
        }

        String chain = null;
        String last = null;
        String block = null;
        int previous = -1;
        for (int i = 0; i < text.size(); i++) {
            int no = lines.get(i).no();
            if (text.blank(i)) {
                rows.putIfAbsent(no, row(no, Kind.IGNORE));
                continue;
            }
            boolean adjacent = previous >= 0 && text.adjacent(previous, i);
            previous = i;
            if (!adjacent) {
                chain = null;
                block = null;
            }
            String t = text.get(i);
            Row existing = rows.get(no);
            if (existing != null) {
                if (existing.kind() == Kind.DIALOGUE) {
                    chain = existing.speaker();
                    last = chain;
                } else if (existing.kind() != Kind.IGNORE) {
                    chain = null;
                    block = null;
                }
                continue;
            }
            Row filled;
            String nameLine = standaloneName(t);
            Head head = head(t, known);
            if (head == null) {
                Matcher labeled = LABELED_HEAD.matcher(t);
                if (labeled.lookingAt() && known.contains(labeled.group(1))) head = new Head(labeled.group(1), labeled.group(), Format.SPACE);
            }
            String strong = colonName(t);
            if (strong != null && (strong.contains(" ") || strong.codePointCount(0, strong.length()) > 6)) strong = null;
            if (strong == null) {
                String bracketed = group(BRACKET_HEAD, t);
                strong = bracketed != null && nameLike(bracketed.strip()) ? bracketed.strip() : null;
            }
            if (prose) {
                filled = row(no, Kind.DIRECTION);
            } else if (PAREN_ONLY.matcher(t).matches()) {
                filled = row(no, Kind.DIRECTION);
            } else if (!monologue && nameLine != null && text.adjacent(i, i + 1) && standaloneName(text.get(i + 1)) == null) {
                // 모르는 이름 줄 — 블록 형식의 새 배역(행동 괄호가 붙으면 그 줄은 지문)
                filled = row(no, actionParen(t) ? Kind.DIRECTION : Kind.IGNORE);
                block = nameLine;
                known.add(nameLine);
                chain = null;
            } else if (head != null) {
                // 이름 머리가 블록보다 먼저다 — 블록 안에 다른 사람 머리 줄이 오면 그 사람 대사다
                String body = t.substring(Math.min(t.length(), head.header.strip().length())).strip();
                filled = PAREN_ONLY.matcher(body).matches() || told(body) ? row(no, Kind.DIRECTION)
                        : new Row(no, Kind.DIALOGUE, head.name, head.header);
                block = null;
            } else if (block != null) {
                filled = new Row(no, Kind.DIALOGUE, block, "");
            } else if (!monologue && strong != null) {
                known.add(strong);
                filled = new Row(no, Kind.DIALOGUE, strong, "");
            } else if (monologue) {
                filled = told(t) ? row(no, Kind.DIRECTION) : new Row(no, Kind.DIALOGUE, monologueName, "");
            } else if (chain != null) {
                filled = told(t) ? row(no, Kind.DIRECTION) : new Row(no, Kind.DIALOGUE, chain, "");
            } else if (directionLike(t) || last == null) {
                filled = row(no, Kind.DIRECTION);
            } else {
                filled = new Row(no, Kind.DIALOGUE, last, "");
            }
            rows.put(no, filled);
            if (filled.kind() == Kind.DIALOGUE) {
                chain = filled.speaker();
                last = chain;
            } else if (filled.kind() != Kind.IGNORE) {
                chain = null;
            }
        }
        List<String> roster = new ArrayList<>();
        rows.values().stream().sorted(java.util.Comparator.comparingInt(Row::no)).filter(row -> row.kind() == Kind.DIALOGUE)
                .map(Row::speaker).distinct().forEach(roster::add);
        return new Result(rows, roster, base.format(), lines.size());
    }

    /** 비운 줄 앞의 이름 같은 낱말 — 쌍점·대괄호 머리, 또는 조사로 끝나지 않는 한글 2~5자 첫 낱말. */
    private static String leadingName(String t) {
        String name = colonName(t);
        if (name != null) return name;
        // 번호·기호가 붙은 이름: 「남자 2」「여자1」「학생A」, 또는 「A」「B」 한 글자
        Matcher labeled = LABELED_HEAD.matcher(t);
        if (labeled.lookingAt()) return labeled.group(1);
        name = group(BRACKET_HEAD, t);
        if (name != null && nameLike(name.strip())) return name.strip();
        name = group(SPACE_HEAD, t);
        return name != null && hangulName(name) && name.length() <= 4 ? name : null;
    }

    /**
     * 풀규칙의 서술 판정 — {@link #narrative}에 더해 현재형 서술(받침 ㄴ·「는」 + 다: 「잠근다」「들어온다」「웃는다」)과 「있다·없다」로
     * 끝나는 줄. 대사 말투 끝이면 아니다. 하이브리드({@link #of})는 쓰지 않는다.
     */
    private static boolean told(String t) {
        if (narrative(t)) return true;
        if (SPEECH_END.matcher(t).matches()) return false;
        String bare = t.replaceAll("[\\s.。…\"”’')）]+$", "");
        if (bare.length() < 2 || !bare.endsWith("다")) return false;
        char before = bare.charAt(bare.length() - 2);
        boolean finalN = before >= 0xAC00 && before <= 0xD7A3 && (before - 0xAC00) % 28 == 4;
        return finalN || before == '는' || bare.endsWith("있다") || bare.endsWith("없다");
    }

    /** 번호·기호가 붙은 이름 머리 — 「남자 2 …」「여자1 …」「학생A …」「A …」. */
    private static final Pattern LABELED_HEAD = Pattern.compile("(\\p{IsHangul}{1,4} ?[0-9A-Z]{1,2}|[A-Z])\\s+(?=\\S)");

    /** 이름을 못 찾은 글이 산문인가 — 글 있는 줄의 60% 이상이 서술로 닫힌다. */
    private static boolean proseLike(Text text) {
        int content = 0;
        int told = 0;
        for (int i = 0; i < text.size(); i++) {
            if (text.blank(i)) continue;
            content++;
            if (directionLike(text.get(i))) told++;
        }
        return content > 0 && told * 10 >= content * 6;
    }

    // ── 원문 ───────────────────────────────────────────

    /** 판단용 글과 빈 줄·이웃 판정. 빈 줄 = 원문 빈 줄(번호가 건너뜀)이나 보이지 않는 글자만 있는 줄. */
    private static final class Text {
        private final List<NumberedLine> lines;
        private final List<String> text;

        Text(List<NumberedLine> lines) {
            this.lines = lines;
            this.text = new ArrayList<>(lines.size());
            for (NumberedLine line : lines) {
                text.add(clean(line.text()));
            }
        }

        int size() { return text.size(); }

        String get(int i) { return text.get(i); }

        boolean blank(int i) { return text.get(i).isEmpty(); }

        /** {@code a} 바로 다음 줄이 {@code b} 이고 둘 다 글이 있는가(사이에 빈 줄 없음). */
        boolean adjacent(int a, int b) {
            return b == a + 1 && b < text.size() && lines.get(b).no() == lines.get(a).no() + 1 && !blank(a) && !blank(b);
        }

        int firstContent() {
            for (int i = 0; i < text.size(); i++) {
                if (!blank(i)) return i;
            }
            return -1;
        }

        int contentCount() {
            int n = 0;
            for (int i = 0; i < text.size(); i++) {
                if (!blank(i)) n++;
            }
            return n;
        }
    }

    // ── 등장인물 소개 ─────────────────────────────────────

    private static Set<Integer> castSection(Text text, Set<String> names) {
        Set<Integer> cast = new LinkedHashSet<>();
        for (int i = 0; i < Math.min(text.size(), 40); i++) {
            if (text.blank(i)) continue;
            Matcher header = CAST_HEADER.matcher(text.get(i));
            if (!header.matches()) continue;
            cast.add(i);
            String inline = header.group(1);
            if (inline != null && !inline.isBlank()) {
                for (String name : inline.split("\\s*[,，、/·]\\s*")) {
                    String n = name.strip();
                    if (nameLike(n)) names.add(n);
                }
                return cast;
            }
            // 소개 묶음은 빈 줄에서 끝난다(머리줄 바로 뒤의 빈 줄은 건너뛴다)
            int j = i + 1;
            while (j < text.size() && text.blank(j)) j++;
            for (int last = -1; j < text.size(); j++) {
                if (last >= 0 && !text.adjacent(last, j)) break;
                String t = text.get(j);
                Matcher line = CAST_LINE.matcher(t);
                String name = line.matches() ? line.group(1).strip() : standaloneName(t);
                if (name == null || !nameLike(name)) break;
                names.add(name);
                cast.add(j);
                last = j;
            }
            return cast;
        }
        return cast;
    }

    // ── 머리 ───────────────────────────────────────────

    private record Head(String name, String header, Format format) {
    }

    private static Head head(String t, Set<String> names) {
        Matcher spaced = SPACED_HEAD.matcher(t);
        if (spaced.lookingAt()) {
            String[] syllables = spaced.group(1).split(" ");
            for (int k = syllables.length; k >= 2; k--) {
                String joined = String.join("", java.util.Arrays.copyOf(syllables, k));
                if (names.contains(joined)) {
                    String raw = String.join(" ", java.util.Arrays.copyOf(syllables, k));
                    return new Head(joined, raw + " ", Format.SPACE);
                }
            }
        }
        Matcher m = COLON_HEAD.matcher(t);
        if (m.lookingAt()) {
            String name = m.group(1).strip();
            if (names.contains(name)) return new Head(name, m.group(), Format.COLON);
        }
        m = BRACKET_HEAD.matcher(t);
        if (m.lookingAt() && names.contains(m.group(1).strip())) {
            return new Head(m.group(1).strip(), m.group(), Format.BRACKET);
        }
        m = PERIOD_HEAD.matcher(t);
        if (m.lookingAt() && names.contains(m.group(1))) {
            return new Head(m.group(1), m.group(), Format.PERIOD);
        }
        m = SPACE_HEAD.matcher(t);
        if (m.lookingAt() && names.contains(m.group(1))) {
            return new Head(m.group(1), m.group(), Format.SPACE);
        }
        // 「세라(아이를 보며) …」처럼 이름 바로 뒤에 괄호가 붙은 줄
        for (String name : names) {
            if (t.startsWith(name) && t.length() > name.length() && (t.charAt(name.length()) == '(' || t.charAt(name.length()) == '（')) {
                return new Head(name, name, Format.SPACE);
            }
        }
        return null;
    }

    private static String colonName(String t) {
        String name = group(COLON_HEAD, t);
        if (name == null) return null;
        name = name.strip();
        return nameLike(name) ? name : null;
    }

    private static String standaloneName(String t) {
        if (t == null) return null;
        Matcher m = NAME_LINE.matcher(t);
        if (!m.matches()) return null;
        String name = m.group(1).strip();
        // 낱말 둘까지 — 둘째는 번호·기호(「남자 1」)이거나 짧은 호칭(「김 형사」). 「다들 궁금하겠지」 같은 노랫말 줄은 이름이 아니다.
        String[] parts = name.split("\\s+");
        if (parts.length > 2) return null;
        if (parts.length == 2 && !parts[1].matches("[0-9A-Za-z]{1,3}|\\p{IsHangul}")
                && !(parts[0].codePointCount(0, parts[0].length()) <= 2 && parts[1].codePointCount(0, parts[1].length()) <= 3)) {
            return null;
        }
        return nameLike(name) && !scene(t) ? name : null;
    }

    /** 이름으로 볼 수 있는 글 — 짧고, 글자가 있고, 문장 끝 부호가 없고, 흔한 말이 아니다. */
    static boolean nameLike(String name) {
        if (name == null || name.isBlank()) return false;
        int length = name.codePointCount(0, name.length());
        if (length > NAME_MAX) return false;
        if (!name.codePoints().anyMatch(Character::isLetter)) return false;
        if (SENTENCE_END.matcher(name).matches()) return false;
        if (name.split("\\s+").length > 3) return false;
        return !NOT_NAMES.contains(name);
    }

    /** 이 모양의 머리가 셋 이상이고 글이 있는 줄의 30% 이상인가. */
    private static boolean dominant(Map<String, Integer> heads, int nonEmpty) {
        int total = heads.values().stream().mapToInt(Integer::intValue).sum();
        return total >= 3 && total * 10 >= nonEmpty * 3;
    }

    /** 한 번만 나온 머리를 받을 만큼 짧은 이름 — 8자까지. */
    private static boolean shortName(String name) {
        return name.codePointCount(0, name.length()) <= 8;
    }

    /** 소개 없이 「이름 + 띄어쓰기」로 받을 이름 — 한글 1~5자, 조사·어미로 끝나지 않음. */
    private static boolean hangulName(String name) {
        // 조사·어미로 끝나는 낱말(「민수는」「했다」)만 거른다 — 「윤서」「은지」처럼 이름에 흔한 끝 글자는 둔다
        return name.matches("\\p{IsHangul}{1,5}") && !NOT_NAMES.contains(name)
                && !name.endsWith("는") && !name.endsWith("은") && !name.endsWith("가") && !name.endsWith("를")
                && !name.endsWith("을") && !name.endsWith("에") && !name.endsWith("요") && !name.endsWith("다");
    }

    // ── 도우미 ─────────────────────────────────────────

    /** 지문 말투인가 — 서술 끝(「~다.」「~음」)이고 대사 말투 끝이 아니다. 한글이 없는 줄(영어 대본)은 물음·느낌표가 없으면 지문이다. */
    public static boolean directionLike(String t) {
        if (t.codePoints().noneMatch(c -> Character.UnicodeScript.of(c) == Character.UnicodeScript.HANGUL)) {
            return !t.contains("?") && !t.contains("!");
        }
        // 「~다.」「~국.」처럼 마침표나 서술로 끝나면 지문. 대사 말투로 끝나거나 부호 없이 끝나는 줄(노랫말)은 아니다.
        return !SPEECH_END.matcher(t).matches() && CLOSED.matcher(t).matches();
    }

    /** 줄 앞 한 글자씩 띄운 글의 이어 붙인 앞부분들(2글자 이상). 「베 티 가 …」→ 베티, 베티가. */
    private static List<String> spacedPrefixes(String t) {
        Matcher m = SPACED_HEAD.matcher(t);
        if (!m.lookingAt()) return List.of();
        String[] syllables = m.group(1).split(" ");
        List<String> out = new ArrayList<>();
        StringBuilder b = new StringBuilder(syllables[0]);
        for (int k = 1; k < syllables.length; k++) {
            b.append(syllables[k]);
            out.add(b.toString());
        }
        return out;
    }

    /** 장면 표기 줄인가. */
    private static boolean scene(String t) {
        return SCENE.matcher(t).matches() || BRACKET_SCENE.matcher(t).matches() || SCENE_MORE.matcher(t).matches();
    }

    /** 이름 줄의 괄호가 목소리 표시가 아닌 행동인가 — 「도윤 (창밖을 본다)」. 괄호가 없으면 아니다. */
    private static boolean actionParen(String t) {
        Matcher m = NAME_PAREN.matcher(t);
        return m.matches() && !m.group(1).isBlank() && !VOICE_MARK.matcher(m.group(1)).matches();
    }

    /** 서술 지문 말투인가(이름으로 시작하는 줄의 나머지). */
    private static boolean narrative(String body) {
        return NARRATIVE.matcher(body).matches() && !SPEECH_END.matcher(body).matches();
    }

    /** 쪽 번호 줄 바로 앞뒤인가. */
    private static boolean pageNear(Text text, int i) {
        for (int k = Math.max(0, i - 2); k <= Math.min(text.size() - 1, i + 2); k++) {
            if (k != i && !text.blank(k) && PAGE.matcher(text.get(k)).matches()) return true;
        }
        return false;
    }

    private static Format format(int[] hits) {
        int total = 0;
        int best = -1;
        for (Format f : List.of(Format.COLON, Format.BRACKET, Format.PERIOD, Format.BLOCK, Format.SPACE)) {
            total += hits[f.ordinal()];
            if (best < 0 || hits[f.ordinal()] > hits[best]) best = f.ordinal();
        }
        if (total == 0) return Format.NONE;
        return hits[best] * 10 >= total * 8 ? Format.values()[best] : Format.MIXED;
    }

    private static boolean previousDialogue(Map<Integer, Row> rows, int previousNo) {
        Row previous = rows.get(previousNo);
        return previous == null || previous.kind() == Kind.DIALOGUE;
    }

    private static String group(Pattern pattern, String t) {
        Matcher m = pattern.matcher(t);
        return m.lookingAt() ? m.group(1) : null;
    }

    private static String digitless(String t) {
        return DIGITS.matcher(t).replaceAll("#");
    }

    private static boolean hasDigit(String t) {
        return t.chars().anyMatch(Character::isDigit);
    }

    private static boolean between(String t, int min, int max) {
        int length = t.codePointCount(0, t.length());
        return length >= min && length <= max;
    }

    private static Row row(int no, Kind kind) {
        return new Row(no, kind, "", "");
    }

    /** 판단용 글 — NFC, 보이지 않는 글자 제거, 앞뒤 공백 제거. 머리는 조립이 원문에서 다시 찾는다. */
    public static String clean(String raw) {
        String nfc = Normalizer.normalize(raw == null ? "" : raw, Normalizer.Form.NFC);
        return INVISIBLE.matcher(nfc).replaceAll("").strip();
    }
}
