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

    /**
     * 보이지 않거나 공백 노릇만 하는 글자 — 폭 없는 공백, BOM, 단어 결합자, 한글 채움 문자(ㅤ·ﾠ·초성·중성 채움), 쓰기 방향 표시(PDF 에서 줄마다
     * 붙어 나오는 U+202D·U+202C 등), 줄바꿈 없는 공백들. 방향 표시가 이름 앞뒤에 붙어 「이름 + 띄어쓰기」 머리를 못 찾던 자리다.
     */
    private static final Pattern INVISIBLE = Pattern.compile("[\\u0000\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF\\u2060\\u3164\\uFFA0\\u115F\\u1160]");
    /** 줄바꿈 없는 공백들 — 지우지 않고 보통 공백으로 바꾼다. 지우면 「에이코␣뭐고」가 「에이코뭐고」로 붙는다(2026-11-21 희곡 재생). */
    private static final Pattern WIDE_SPACE = Pattern.compile("[\\u00A0\\u2007\\u202F]");
    private static final Pattern PAGE = Pattern.compile("(?iu)[-–—(\\[]?\\s*+(?:p\\.?|page|쪽)?\\s*+\\d{1,3}\\s*+(?:쪽|/\\s*+\\d{1,3})?\\s*+[-–—)\\]]?");
    private static final Pattern DIGITS = Pattern.compile("\\d+");
    private static final Pattern SCENE = Pattern.compile(
            "(?iu)(?:s\\s*#\\s*\\d+|#\\s*\\d+|씬\\s*\\d+|scene\\s+[0-9ivx]+|act\\s+[0-9ivx]+|int\\.|ext\\.|"
                    + "제\\s*[0-9일이삼사오육칠팔구십]+\\s*(?:막|장|경|장면)|[0-9]+\\s*(?:막|장)(?=\\s|$|[.:])|프롤로그|에필로그|막간)(?:\\b|\\s|[.:/,]|$).*");
    /** 괄호 한 묶음이 줄 전체인 줄 — 「(웃으며)」「[무대 어두워진다]」. 「[민수] 가자! (웃으며)」처럼 대괄호로 시작해 괄호로 끝나는 대사 줄은 아니다. */
    private static final Pattern PAREN_ONLY = Pattern.compile("\\([^()]*\\)|（[^（）]*）|\\[[^\\[\\]]*]|［[^［］]*］");
    /** 이름 줄 괄호 속 목소리 표시 — 「민수 (V.O.)」는 이름 줄이고, 「민수 (창밖을 본다)」는 그 사람의 행동 지문이다. */
    private static final Pattern VOICE_MARK = Pattern.compile(
            "(?iu)\\s*(?:v\\.?\\s*o\\.?|o\\.?\\s*s\\.?|o\\.?\\s*c\\.?|e|f|off|cont'?d|소리|목소리|전화|전화\\s*목소리|내레이션|나레이션|독백|방백|노래|이어서|계속|속마음|생각|화면|영상|녹음|음성)\\s*");
    /** 장면 표기 더 — 「12. 거실, 밤」「- 암전 -」「장면 2」「S# 골목 - 밤」. */
    private static final Pattern SCENE_MORE = Pattern.compile(
            "(?iu)\\d{1,3}\\.\\s*[^.!?]{1,20}?[,/\\-–].*|[-–—=~*]\\s*[가-힣A-Za-z]{1,4}\\s*[-–—=~*]|"
                    + "(?:장면|막|장|씬|신|에피소드|챕터|파트|part|chapter|episode)\\s*\\d{1,3}\\s*[.:]?|s\\s*#.*");
    /** 작가·연출 표기 줄. 「작」「글」은 쌍점이 있을 때만(「글쎄, …」는 대사다). */
    private static final Pattern AUTHOR = Pattern.compile(
            "(?iu)(?:(?:작|글)\\s*+[:：]|(?:극본|각본|각색|원작|연출|작가|지은이)\\s*+[:：]?+|written by\\b|by(?=\\s))\\s*+\\S.*");
    /** 만든 사람 표기 — 「지도교사 : …」「무대감독: …」. 대사 앞이면 제목 묶음이다. */
    private static final Pattern CREDIT = Pattern.compile(
            "(?iu)(?:지도\\s*(?:교사|선생님?)|학생\\s*연출|조연출|연출|무대\\s*감독|기획(?:\\s*팀장)?|제작|프로듀서|pd|촬영|편집|안무|"
                    + "음악\\s*감독|음향|조명|의상|분장|소품|무대|무대\\s*디자인|드라마투르그|각색|극본|작가|원작|번역|출연|조감독|조명보|"
                    + "의상\\s*분장|영상|그래픽|홍보|사진|무대\\s*미술|기술\\s*감독|제작\\s*감독|하우스\\s*매니저|오퍼레이터)"
                    + "(?:\\s*(?:감독|팀장|담당|팀|디자이너|디자인|크루|보))?");
    private static final Pattern CAST_HEADER = Pattern.compile(
            "(?iu)(?:등장\\s*+인물|나오는\\s*+(?:사람들?|이들?|인물들?)|등장인물\\s*+소개|배역|인물|cast|characters)\\s*+(?:[:：]\\s*+(.*))?");
    /** 소개 줄: 「윤기 --- 서른둘」「민재: 스물일곱, …」「세라(29) …」「아이, 일곱 살」. */
    private static final Pattern CAST_LINE = Pattern.compile("([^\\s:：,(（\\-–—]{1,12}(?: [0-9A-Za-z]{1,3})?)(?:\\s*+(?:[-–—]{1,3}|[:：]|[,(（])|\\s{2,}+)\\s*+\\S.*");
    private static final Pattern COLON_HEAD = Pattern.compile("([^\\s:：()（）\\[\\]][^:：]{0,13}?)\\s*[:：]\\s*(?=\\S)");
    private static final Pattern BRACKET_HEAD = Pattern.compile("\\[\\s*([^\\]]{1,12}?)\\s*]\\s*(?=\\S)");
    private static final Pattern PERIOD_HEAD = Pattern.compile("([A-Z][A-Z'\\- ]{0,18}[A-Z])\\.\\s+(?=\\S)");
    /** 한글 이름 + 마침표 머리 — 「민수. 어디 가?」「민수. (웃으며) 가자」. 번역 희곡 모양이다. 흔한 말(「그래. 가자」)과 갈라야 해서 주된 모양일 때만 쓴다. */
    private static final Pattern HANGUL_PERIOD_HEAD = Pattern.compile("(\\p{IsHangul}{1,7}+)\\.[^\\S\\n]++(?=\\S)");
    private static final Pattern SPACE_HEAD = Pattern.compile("(\\S{1,8})(\\s+)(?=\\S)");
    /** 글자 사이를 띄운 이름 머리: 「베 티 …」「헤 일 …」(양쪽 맞춤 PDF). 한 글자씩 띄운 2~4글자. */
    private static final Pattern SPACED_HEAD = Pattern.compile("(\\p{IsHangul}(?: \\p{IsHangul}){1,3})\\s+(?=\\S)");
    /** 조연 이름으로 받지 않을 끝 글자 — 조사·어미(「당신이」「대해서」「사람들한테」). */
    private static final Pattern MINOR_NOT = Pattern.compile(".*(?:이|서|고|도|만|지|니|나|한테|에게|께|랑|와|과|로|의|면|며|데|게|는|은|가|를|을|에|요|다|야|어|아)");
    /**
     * 탭으로 나눈 머리: 「택배⇥…」「7번 배심원⇥…」「경비 ⇥⇥…」「7번 배심원(웃으며)⇥…」. 이름은 앞뒤가 공백이 아닌 12자까지이고 이름 뒤 괄호
     * 지시는 이름에 넣지 않는다. 표에서 옮긴 대본이 이 모양이다.
     */
    private static final Pattern TAB_HEAD = Pattern.compile(
            "([^\\t\\s(（:：]++(?:[^\\S\\t]++[^\\t\\s(（:：]++){0,2})[^\\S\\t]*+(?:[(（][^)）\\t]{0,30}+[)）])?+[^\\S\\t]*+[:：]?[^\\S\\t]*+\\t\\s*+(?=\\S)");
    /** 「무대 …」「무대, …」「[무대] …」 — 무대를 화자 자리에 적은 지문. */
    private static final Pattern STAGE = Pattern.compile("(?:무대(?:[^\\S\\n]*+[,，:：])?|[\\[［]무대[\\]］])[^\\S\\n]*+(?<=[\\s\\]］])\\S.*");
    /** 두 낱말 이름의 둘째 낱말로 받는 호칭·역할 — 「김 형사」「늙은 여자」「아파트 경비」. */
    private static final Set<String> TITLE_WORDS = Set.of("형사", "선생", "선생님", "부인", "씨", "양", "군", "과장", "부장", "대리", "사장",
            "회장", "박사", "교수", "기자", "경관", "경비", "간호사", "엄마", "아빠", "모", "부", "할머니", "할아버지", "아저씨", "아줌마", "언니",
            "오빠", "누나", "형", "동생", "배심원", "주임", "반장", "경위", "경사", "순경", "의사", "실장", "팀장", "국장", "원장", "소장", "차장",
            "대표", "감독", "작가", "목소리", "소리", "여자", "남자", "노인", "소녀", "소년", "여인", "사내", "아이", "청년", "노파", "부부", "일행");
    /** 이름 끝으로 오지 않는 조사·어미 — 줄 앞 낱말이 이것으로 끝나면 말이다(「당신의」「알파와」「두려운」「이해할」). */
    private static final Pattern WORD_END = Pattern.compile(".*(?:의|와|과|랑|에게|한테|께서|에서|처럼|지만|려고|다고|했던|으로|로|도|만|는|은|을|를|에|게|며|면|듯|히|던|할|려운|러운|다운|겠|었|았)");
    /** 띄어쓰기 두 칸 이상이나 탭으로 나눈 머리({@link #wideName}). 강한 구분이다. */
    private static final Pattern WIDE_HEAD = Pattern.compile("(\\S{1,8})(\\s+)(?=\\S)");
    /** 마침표·서술 끝으로 닫힌 줄. */
    private static final Pattern CLOSED = Pattern.compile(".*(?:[.。]|다|음|함|중)[\"”’')）]*");
    /** 서술 지문 끝 — 「~한다.」「~선다.」「~있다.」 */
    private static final Pattern NARRATIVE = Pattern.compile(".*(?:[는ㄴ]다|한다|있다|없다|된다|본다|간다|온다|선다|앉는다|든다|난다|진다|켠다|끈다)[.。]?[\"”’']?");
    /** 대사 말투 끝말 — {@link #speechEnd}. */
    private static final List<String> SPEECH_ENDINGS = List.of("♪", "요", "야", "아", "어", "여", "해", "워", "와", "라", "냐", "지", "니", "까", "네",
            "래", "게", "줘", "자", "죠", "군", "구나", "거든", "잖아", "라고", "는데", "는걸", "ㅋ", "ㅎ", "니다", "시오");
    /** 「[페이지] 12」처럼 쪽을 대괄호로 적은 줄. */
    private static final Pattern BRACKET_PAGE = Pattern.compile("\\[[^\\]]{1,10}]\\s*\\d{1,4}\\s*");
    /** 「[막] 1장」「[씬 3]」처럼 장면을 대괄호로 적은 줄. */
    private static final Pattern BRACKET_SCENE = Pattern.compile("\\[\\s*+(?:막|장|씬|장면|scene|act)\\s*+[0-9]*+\\s*+]\\s*+.*", Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
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
            "페이지", "쪽", "막", "장", "씬", "장면", "page", "scene", "act", "주", "참고", "각주", "메모", "노트",
            // 2026-11-21 희곡 43편 재생에서 배역으로 잘못 받은 흔한 말
            "이런", "그런", "저런", "잠시", "갑자기", "물론", "첫째", "둘째", "셋째", "여긴", "거긴", "저긴", "모든", "어떤", "다른", "방금",
            "일단", "먼저", "처음엔", "한동안", "아무튼", "점점", "어둠", "때", "이때", "그동안", "노래", "장소", "배역", "부분", "문득", "자꾸만",
            "원래", "그렇게", "이렇게", "저렇게", "둘이", "둘", "셋", "넷", "한", "두", "세", "첫", "빈", "오전", "오후", "순간", "결국", "드디어",
            "마침내", "천천히", "조용히", "서서히", "계속", "여전히", "혼자", "서로", "무대", "객석", "관객", "침묵", "정적", "음향", "효과음",
            "전환", "끝", "그날", "곧", "모두들", "전원", "조금", "잠깐만", "어디서", "어디에선가", "열심히", "시간이", "한국", "서울", "고향",
            "사람들", "아이들", "우리도", "나도", "제일", "공연", "등장인물", "제목", "그곳", "이곳", "저곳", "온갖"));

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
        Map<String, Integer> hangulPeriod = new LinkedHashMap<>();
        Map<String, Integer> standalone = new LinkedHashMap<>();
        Set<String> headerish = new HashSet<>();
        Map<String, Integer> nearPage = new HashMap<>();
        Map<String, Integer> first = new LinkedHashMap<>();
        Map<String, Integer> labeled = new LinkedHashMap<>();
        Map<String, Integer> tab = new LinkedHashMap<>();
        Map<String, Integer> wide = new LinkedHashMap<>();
        Map<String, Integer> groupHeads = new LinkedHashMap<>();
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
            // 쪽 번호 옆에서 숫자만 바뀌며 되풀이되는 머리글(「○○대학교 26-2 공연」)은 머리 후보로 세지 않는다 — 그 첫 낱말이 배역이 되면
            // 아래 반복 머리글 판정도 「아는 이름으로 시작하는 줄」이라 비껴갔다
            if (i != firstIndex && pageHeader(text, i, repeats)) continue;
            String name = colonName(t);
            if (name != null) colon.merge(name, 1, Integer::sum);
            name = group(BRACKET_HEAD, t);
            if (name != null && nameLike(name)) bracket.merge(name, 1, Integer::sum);
            name = group(PERIOD_HEAD, t);
            if (name != null) period.merge(name, 1, Integer::sum);
            name = group(HANGUL_PERIOD_HEAD, t);
            if (name != null && nameLike(name)) hangulPeriod.merge(name, 1, Integer::sum);
            name = standaloneName(t);
            if (name != null && text.adjacent(i, i + 1) && standaloneName(text.get(i + 1)) == null) {
                standalone.merge(name, 1, Integer::sum);
                // 쪽 번호 옆이나 반복 머리글 자리의 짧은 줄은 이름이 아니라 머리글이다. 쪽 번호 옆은 그 이름 줄의 절반 이상일 때만 —
                // 블록 대본에서 쪽이 바뀌는 자리에 마침 온 이름 줄 하나로 그 이름이 머리글이 되어 블록 판정이 깨졌다(2026-11-21 운영 대본)
                if (pageNear(text, i)) nearPage.merge(name, 1, Integer::sum);
                if (i != firstIndex && digitless(t).equals(firstKey)) headerish.add(name);
                if (i == firstIndex && titleFirst) headerish.add(name);
            }
            name = group(SPACE_HEAD, t);
            boolean spacedLine = spacedPrefixes(t).stream().anyMatch(spacedNames::contains);
            // 문장 중간에서 끊긴 줄 다음 줄의 첫 낱말(PDF 의 「고」「게」)은 이름 후보로 세지 않는다. 화면 폭 기준(앞 줄이 폭까지 찼을 때만)으로
            // 좁히면 놓친 이름은 되찾지만 가짜 이름이 더 들어와 운영 대본 일치가 75.8→75.1% 로 떨어졌다(2026-11-21) — 끝 부호 기준을 둔다.
            boolean cut = i > 0 && text.adjacent(i - 1, i) && !TERMINAL.matcher(text.get(i - 1)).matches();
            if (name != null && nameLike(name) && !spacedLine && !cut) first.merge(name, 1, Integer::sum);
            if (name != null && GROUP_SPEAKERS.contains(name) && !cut) groupHeads.merge(name, 1, Integer::sum);
            Matcher numbered = LABELED_HEAD.matcher(t);
            if (numbered.lookingAt() && !cut && numbered.group(1).length() > 1) labeled.merge(numbered.group(1), 1, Integer::sum);
            name = group(TAB_HEAD, t);
            if (name != null && nameLike(name.strip())) tab.merge(name.strip(), 1, Integer::sum);
            name = wideName(t);
            if (name != null && nameLike(name)) wide.merge(name, 1, Integer::sum);
        }
        nearPage.forEach((name, n) -> { if (n * 2 >= standalone.get(name)) headerish.add(name); });
        String firstLine = firstIndex < 0 ? "" : text.get(firstIndex);
        // 쌍점·대괄호·대문자 머리가 대본의 주된 모양이면 한 번만 말하는 배역도 받는다 — 첫 줄만 빼고(「독백: 문 앞에서」 같은 제목)
        boolean colonFormat = dominant(colon, nonEmpty);
        boolean bracketFormat = dominant(bracket, nonEmpty);
        // 한글 이름 + 마침표: 세 번 넘게 나온 이름 둘 이상이 글 줄의 30% 이상이면 주된 모양이다
        Map<String, Integer> hangulHeads = new LinkedHashMap<>();
        hangulPeriod.forEach((name, n) -> { if (n >= 3 && spaceName(name, n)) hangulHeads.put(name, n); });
        boolean hangulPeriodFormat = hangulHeads.size() >= 2 && dominant(hangulHeads, nonEmpty);
        boolean periodFormat = dominant(period, nonEmpty) || hangulPeriodFormat;
        if (hangulPeriodFormat) hangulPeriod.forEach((name, n) -> { if (n >= 2 && spaceName(name, n)) names.add(name); });
        String firstColon = colonName(firstLine);
        String firstBracket = group(BRACKET_HEAD, firstLine);
        // 세 줄 이하 짧은 글이 전부 「이름: …」이면 첫 줄도 대사다(「독백: 문 앞에서」 제목은 빼고) — 「지수: 안녕⏎민호: 응」 두 줄 대본의 첫 사람이 빠지고 독백이 됐다
        // (2026-11-22 r4 대조)
        int colonTotal = colon.values().stream().mapToInt(Integer::intValue).sum();
        boolean tinyColon = nonEmpty <= 3 && colonTotal == nonEmpty && !colon.containsKey("독백");
        colon.forEach((name, n) -> {
            if (n == 1 && CREDIT.matcher(name).matches()) return;
            if (n >= 2 || castNames.contains(name) || colonFormat && !name.equals(firstColon) && shortName(name)
                    || tinyColon && shortName(name) && nameLike(name)) names.add(name);
        });
        bracket.forEach((name, n) -> {
            if (n >= 2 || castNames.contains(name) || bracketFormat && !name.equals(firstBracket) && shortName(name)) names.add(name);
        });
        period.forEach((name, n) -> { if (n >= 2 || periodFormat) names.add(name); });
        // 탭 머리: 탭 앞 짧은 이름이 주된 모양이면(표에서 옮긴 대본) 탭 앞을 이름으로 받는다
        boolean tabFormat = dominant(tab, nonEmpty);
        // 탭은 강한 구분이라 두 번 이상 나온 탭 앞 이름도 받는다(2026-11-21: 「7번 배심원⇥」을 못 받아 배심원 대사가 경비 대사로 붙었다)
        tab.forEach((name, n) -> { if ((tabFormat || n >= 2 || castNames.contains(name)) && !headerish.contains(name)) names.add(name); });
        // 블록: 서로 다른 이름 둘 이상이 각각 두 번 이상 이름 줄로 나와야 블록 대본이다. 쌍점·대괄호·대문자·탭이 주된 대본은 아니다.
        // 긴 대본은 대사가 길어 이름 줄 비율이 낮다 — 비율이 아니라 횟수로 본다(2026-11-19 재생: 소개에 이름 하나만 잡힌 블록 대본에서
        // 다른 인물 이름 줄이 앞 사람 대사로 이어 붙었다).
        Map<String, Integer> standaloneAll = Map.copyOf(standalone);
        headerish.removeAll(castNames);
        standalone.keySet().removeAll(headerish);
        long repeatedNames = standalone.values().stream().filter(n -> n >= 2).count();
        int blockTotal = standalone.values().stream().mapToInt(Integer::intValue).sum();
        // 띄어쓰기 머리가 이름 줄보다 훨씬 많으면(세 배) 블록이 아니다 — 소개·장면 머리에 이름만 쓴 줄 몇 개로 블록이 되어 띄어쓰기 이름을
        // 아예 보지 않던 자리다(2026-11-21 운영 대본: 블록으로 판정돼 배역 0 인 띄어쓰기 대본 34편)
        int spaceHeads = first.entrySet().stream().filter(e -> e.getValue() >= SPACE_HEAD_MIN && spaceName(e.getKey(), e.getValue()))
                .mapToInt(Map.Entry::getValue).sum();
        boolean blockFormat = !colonFormat && !bracketFormat && !periodFormat && !tabFormat && repeatedNames >= 2 && blockTotal >= 4
                && spaceHeads <= blockTotal * 3;
        standalone.forEach((name, n) -> {
            if (castNames.contains(name) || blockFormat && n >= 2) names.add(name);
        });
        // 대괄호 이름 줄(「[브래든]」 다음 줄에 대사): 서로 다른 이름 둘 이상이 각각 두 번 이상, 모두 넷 이상 나오면 블록 이름이다.
        // 괄호뿐인 줄이라 지문으로 읽혀 대사가 앞 사람 것으로 붙던 자리다(2026-11-21 뮤지컬 대본).
        Map<String, Integer> bracketLines = new LinkedHashMap<>();
        for (int i = 0; i < text.size(); i++) {
            if (cast.contains(i) || !text.adjacent(i, i + 1)) continue;
            String name = bracketLineName(text.get(i));
            if (name != null && bracketLineName(text.get(i + 1)) == null && !PAREN_ONLY.matcher(text.get(i + 1)).matches()) {
                bracketLines.merge(name, 1, Integer::sum);
            }
        }
        Set<String> bracketBlocks = new HashSet<>();
        if (bracketLines.values().stream().filter(n -> n >= 2).count() >= 2 && bracketLines.values().stream().mapToInt(Integer::intValue).sum() >= 4) {
            bracketLines.forEach((name, n) -> { if (n >= 2 || castNames.contains(name)) bracketBlocks.add(name); });
            names.addAll(bracketBlocks);
        }
        // 「이름 + 띄어쓰기」: 다른 모양이 주된 대본이 아니면 자주 줄 앞에 나오는 이름을 받는다 — 둘 이상이거나 소개가 있을 때만.
        // 블록 대본에서 받으면 블록 대사의 첫 낱말(「다음 줄까지 …」의 「다음」)이 배역이 된다.
        if (!colonFormat && !bracketFormat && !periodFormat && !blockFormat && !tabFormat) {
            List<String> candidates = new ArrayList<>();
            for (Map.Entry<String, Integer> e : first.entrySet()) {
                if (!names.contains(e.getKey()) && e.getValue() >= SPACE_HEAD_MIN && e.getValue() * 50 >= nonEmpty
                        && (spaceName(e.getKey(), e.getValue()) || castNames.contains(e.getKey()))) {
                    candidates.add(e.getKey());
                }
            }
            candidates.addAll(spacedNames);
            if (candidates.size() >= 2 || !castNames.isEmpty()) {
                names.addAll(candidates);
                // 주연이 섰으면 두 번 이상 줄 앞에 나온 이름도 받는다(조연). 조사·어미로 끝나는 낱말은 말이라 뺀다.
                first.forEach((name, n) -> { if (n >= 2 && spaceName(name, n)) names.add(name); });
                // 번호·기호가 붙은 이름(「남자1」「기자 1」)도 두 번 넘게 줄 앞에 나오면 받는다
                labeled.forEach((name, n) -> { if (n >= 2 && !CREDIT.matcher(name).matches()) names.add(name); });
                // 띄어쓰기형이 섰으면 두 칸 이상·탭으로 떨어진 머리는 한 번만 나와도 이름이다(조연 「택배」)
                wide.forEach((name, n) -> { if (hangulName(name) && !CREDIT.matcher(name).matches()) names.add(name); });
                // 여럿이 함께 하는 말(「모두 안녕!」)도 두 번 넘게 줄 앞에 나오면 배역이다. 서술(「모두 퇴장한다.」)은 줄 판정에서 지문으로 간다.
                groupHeads.forEach((name, n) -> { if (n >= 2) names.add(name); });
            }
        }

        // 4. 줄마다 판정
        String block = null;
        boolean unknownBlock = false;
        int parenUntil = -1;
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
            if (PAGE.matcher(t).matches() || BRACKET_PAGE.matcher(t).matches() || IGNORABLE.matcher(t).matches()) {
                rows.put(no, row(no, Kind.IGNORE));
                continue;
            }
            // 여러 줄에 걸친 괄호 지문 — 여는 줄부터 닫는 줄까지(「/」로 나눈 노랫말 괄호는 빼고). 빈 줄 없이 네 줄 안에 닫혀야 한다 —
            // 닫는 괄호를 빠뜨린 줄이 뒤를 전부 지문으로 삼키지 않게.
            if (parenUntil >= i) {
                rows.put(no, row(no, Kind.DIRECTION));
                continue;
            }
            int closing = opensParen(t) ? parenClose(text, i) : -1;
            if (closing > i) {
                rows.put(no, row(no, Kind.DIRECTION));
                parenUntil = closing;
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
            String bracketLine = bracketLineName(t);
            if (bracketLine != null && bracketBlocks.contains(bracketLine) && text.adjacent(i, i + 1)) {
                rows.put(no, row(no, Kind.IGNORE));
                block = bracketLine;
                hits[Format.BLOCK.ordinal()]++;
                seenBody = true;
                continue;
            }
            if (PAREN_ONLY.matcher(t).matches()) {
                // 「(가자! / 저 끝까지 / …)」 노랫말은 대사다 — 하이브리드는 모델에 맡긴다
                if (!lyrics(t)) rows.put(no, row(no, Kind.DIRECTION));
                continue;
            }
            if (STAGE.matcher(t).matches() && !names.contains("무대")) {
                rows.put(no, row(no, Kind.DIRECTION));
                block = null;
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
                // 「댄 :」처럼 이름 뒤가 부호뿐인 줄은 다음 줄에 대사를 두는 이름 줄이다
                if (MARKS_ONLY.matcher(body).matches()) {
                    rows.put(no, row(no, Kind.IGNORE));
                    block = text.adjacent(i, i + 1) ? head.name : null;
                    unknownBlock = false;
                    seenBody = true;
                    continue;
                }
                // 「노인 (천천히 일어선다)」처럼 이름 뒤가 괄호뿐이거나, 「현정(유진), …」처럼 괄호 뒤에 쉼표가 오면 그 사람의 행동 지문이다
                if (PAREN_ONLY.matcher(body).matches() || PAREN_COMMA.matcher(body).matches()) {
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
            // 대사 앞의 첫 줄은 제목이다 — 짧고, 이름 머리가 아니고, 대사 말투가 아니고, 다음 줄과 떨어져 있거나 다음 줄이 쪽 번호·작가·소개·장면일 때.
            // 바로 대사로 시작하는 대본의 첫 줄을 제목으로 빼던 자리다(2026-11-21 정답 셋 오류 8지점).
            boolean titleShape = !text.adjacent(i, i + 1) || i + 1 < text.size() && (PAGE.matcher(text.get(i + 1)).matches()
                    || AUTHOR.matcher(text.get(i + 1)).matches() || CAST_HEADER.matcher(text.get(i + 1)).matches() || scene(text.get(i + 1)));
            if (!seenBody && i == firstIndex && t.codePointCount(0, t.length()) <= 40 && !speechEnd(t) && titleShape) {
                rows.put(no, row(no, Kind.TITLE));
                continue;
            }
            // 머리 없는 줄: 바로 앞이 대사이고 빈 줄 없이 이어지면 대사의 이어지는 줄일 수 있다 — 판단하지 않는다
            if (!afterGap && before >= 0 && previousDialogue(rows, lines.get(before).no())) {
                continue;
            }
            // 머리 모양이 분명한 대본에서 따로 떨어진 머리 없는 줄은 지문 말투일 때만 지문이다. 대사 말투(?·!·「~요」)거나 애매하면
            // 모델에 맡긴다 — 빈 줄 뒤에 이어 쓴 대사를 지문으로 단정하던 자리다(2026-11-19 재생: 지문→대사 3만 8천 줄).
            if (!names.isEmpty() && directionLike(withoutTailParen(t))) {
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
        return full(lines, rejectProse, true);
    }

    static Result full(List<NumberedLine> lines, boolean rejectProse, boolean mergeSurnames) {
        Result base = of(lines);
        boolean blockFormat = base.format() == Format.BLOCK;
        Text text = new Text(lines);
        Map<Integer, Row> rows = new LinkedHashMap<>(base.rows());
        castArea(text, lines, rows);
        Set<String> known = new LinkedHashSet<>(base.roster());
        Map<String, Integer> fresh = new HashMap<>();
        Set<String> colonSeen = new HashSet<>();
        for (int i = 0; i < text.size(); i++) {
            if (text.blank(i) || rows.containsKey(lines.get(i).no())) continue;
            String colonHead = colonName(text.get(i));
            if (colonHead == null) colonHead = markName(text.get(i));
            if (colonHead != null) colonSeen.add(colonHead);
            if (i > 0 && text.adjacent(i - 1, i) && !TERMINAL.matcher(text.get(i - 1)).matches()) continue;
            String name = leadingName(text.get(i));
            if (name != null) fresh.merge(name, 1, Integer::sum);
        }
        // 숫자만 쓴 배역(「1 응? 뭐가?」「4 야.」): 서로 다른 숫자 셋 이상이 각각 세 번 이상 줄 앞에 나와야 받는다
        Map<String, Integer> numbers = new LinkedHashMap<>();
        fresh.forEach((name, n) -> { if (name.matches("\\d{1,2}") && n >= 3) numbers.put(name, n); });
        fresh.keySet().removeIf(name -> name.matches("\\d{1,2}"));
        if (numbers.size() >= 3) known.addAll(numbers.keySet());
        fresh.forEach((name, n) -> {
            // 쌍점·대괄호·번호 이름은 두 번, 줄 앞 첫 낱말은 띄어쓰기 이름 기준({@link #spaceName})
            boolean strongHead = !name.matches("\\p{IsHangul}+") || colonSeen.contains(name);
            boolean particled = name.length() >= 2 && known.contains(name.substring(0, name.length() - 1))
                    && "이가은는을를도의와과랑".indexOf(name.charAt(name.length() - 1)) >= 0;
            if (!particled && (strongHead ? n >= 2 : spaceName(name, n))) known.add(name);
        });
        boolean prose = rejectProse && known.isEmpty() && proseLike(text);
        boolean monologue = known.isEmpty() && !prose;
        // 독백 화자: 맨 위 세 줄 안에 이름 줄(첫 줄 제목은 빼고)이나 「이름:」만 있는 줄이 있으면 그 이름
        String monologueName = Monologue.PLACEHOLDER;
        if (monologue) {
            int top = firstContent(text);
            Matcher titled = top < 0 ? null : TITLE_NAME_LINE.matcher(text.get(top));
            if (titled != null && titled.matches() && nameLike(titled.group(1))) {
                monologueName = titled.group(1);
                rows.put(lines.get(top).no(), row(lines.get(top).no(), Kind.TITLE));
            }
        }
        if (monologue && monologueName.equals(Monologue.PLACEHOLDER)) {
            int seen = 0;
            for (int i = 0; i < text.size() && seen < 3; i++) {
                if (text.blank(i)) continue;
                seen++;
                String t = text.get(i);
                String trimmed = t.stripTrailing();
                String alone = trimmed.endsWith(":") || trimmed.endsWith("：") ? trimmed.substring(0, trimmed.length() - 1).stripTrailing() : t;
                String name = seen > 1 ? standaloneName(alone) : null;
                // 제목 바로 밑에 붙고 뒤가 빈 줄인 이름은 작가다(「<담배의 해로움에 대해>⏎체호프⏎⏎」)
                boolean byline = seen == 2 && i == firstContent(text) + 1 && text.adjacent(i - 1, i) && !text.adjacent(i, i + 1);
                if (name != null && !byline && hangulName(name.replace(" ", ""))) {
                    monologueName = name;
                    rows.put(lines.get(i).no(), row(lines.get(i).no(), Kind.IGNORE));
                    break;
                }
            }
        }

        if (monologue && monologueName.equals(Monologue.PLACEHOLDER)) {
            // 첫 본문 줄들의 탭 머리(「뉴힌⇥(콧수염은 …) 친애하는 …」)
            int seen = 0;
            for (int i = 0; i < text.size() && seen < 12; i++) {
                if (text.blank(i)) continue;
                seen++;
                String tabbed = group(TAB_HEAD, text.get(i));
                if (tabbed != null && nameLike(tabbed.strip()) && hangulName(tabbed.strip())) {
                    monologueName = tabbed.strip();
                    break;
                }
            }
        }

        // 첫 대사(하이브리드가 답한 대사) 앞은 제목·소개·곡 목록 자리다 — 여기서 한 번만 나온 이름 같은 줄은 새 배역이 아니다
        int firstSpeech = -1;
        Map<String, Integer> nameLines = new HashMap<>();
        for (int i = 0; i < text.size(); i++) {
            Row r = base.rows().get(lines.get(i).no());
            if (firstSpeech < 0 && r != null && r.kind() == Kind.DIALOGUE) firstSpeech = i;
            String alone = text.blank(i) ? null : standaloneName(markless(text.get(i)));
            if (alone != null) nameLines.merge(alone, 1, Integer::sum);
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
            String bracketName = existing == null || existing.kind() != Kind.DIALOGUE ? bracketNameLine(t, known) : null;
            if (bracketName != null) {
                // 「[민수]」만 있는 줄 — 다음 줄부터 그 사람 대사다(쌍점 대본 안에 섞인 블록 머리)
                rows.put(no, row(no, Kind.IGNORE));
                block = bracketName;
                chain = null;
                continue;
            }
            // 짧은 무대 신호(「사이.」「암전」「지해 천천히 퇴장.」)는 블록·앞 사람 대사로 잇지 않고 지문이다
            // 「화면: …」「자막: …」「음악: …」은 화자 자리에 적은 연출 지시다
            boolean screen = SCREEN_HEAD.matcher(t).lookingAt();
            Head cueHead = screen ? null : head(t, known);
            // 「하늘 등장.」처럼 이름 뒤가 무대 신호뿐이어도 지문이다
            boolean cue = CUE.matcher(t).matches() && (cueHead == null
                    || CUE_ONLY.matcher(t.substring(Math.min(t.length(), cueHead.header.length())).strip()).matches());
            if ((existing == null || existing.kind() == Kind.DIALOGUE && (existing.header().isEmpty() || screen || cueHead != null))
                    && (screen || cue)) {
                existing = row(no, Kind.DIRECTION);
                rows.put(no, existing);
            }
            // 블록 이름 줄 밑의 서술(「카트린, 종이를 다시 넣는다.」)은 그 사람 대사가 아니라 지문이다
            if (existing != null && existing.kind() == Kind.DIALOGUE && existing.header().isEmpty() && toldLine(withoutTailParen(t))) {
                rows.put(no, row(no, Kind.DIRECTION));
                continue;
            }
            if (existing != null) {
                String alone = existing.kind() == Kind.IGNORE ? standaloneName(markless(t)) : null;
                if (alone != null && (known.contains(alone) || nameLines.getOrDefault(alone, 0) >= 2) && text.adjacent(i, i + 1)) {
                    // 하이브리드가 무시로 둔 이름 줄(두 번 넘게 나온 이름) — 그 밑 줄은 이 사람 블록이다
                    block = alone;
                    known.add(alone);
                    chain = null;
                } else if (existing.kind() == Kind.DIALOGUE) {
                    chain = existing.speaker();
                    last = chain;
                    // 머리 있는 대사 줄은 앞 블록을 끝낸다
                    if (!existing.header().isEmpty()) block = null;
                } else if (existing.kind() != Kind.IGNORE) {
                    // 「민수 (창밖을 본다)」「민수 : (한숨)」 — 지문이지만 다음 줄부터 그 사람 대사다
                    String acting = existing.kind() == Kind.DIRECTION ? actionHeadName(t, known) : null;
                    Handover next = Handover.to(acting, blockFormat);
                    chain = next.chain();
                    block = next.block();
                    if (acting != null) last = acting;
                }
                continue;
            }
            Row filled;
            String acting = null;
            // 이름 뒤에 쌍점·닫는 괄호만 붙은 줄(「민수:」「노아)」)도 블록 이름 줄이다
            String nameLine = standaloneName(markless(t));
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
            // 말투는 끝 괄호 지시(「같이 가자! (손을 내민다)」)를 빼고 본다
            String spoken = withoutTailParen(t);
            String first = group(SPACE_HEAD, t);
            boolean credit = first != null && CREDIT.matcher(first).matches() && !known.contains(first) && t.codePointCount(0, t.length()) <= 30;
            if (prose) {
                filled = row(no, Kind.DIRECTION);
            } else if (STAGE.matcher(t).matches() && !known.contains("무대")) {
                filled = row(no, Kind.DIRECTION);
            } else if (credit) {
                // 대본 끝 크레딧(「연출 홍길동」) — 배역이 아니다
                filled = row(no, Kind.IGNORE);
            } else if (PAREN_ONLY.matcher(t).matches()) {
                String singer = chain != null ? chain : last;
                filled = lyrics(t) && singer != null ? new Row(no, Kind.DIALOGUE, singer, "") : row(no, Kind.DIRECTION);
            } else if (!monologue && nameLine != null && i < firstSpeech && nameLines.getOrDefault(nameLine, 0) <= 1 && !known.contains(nameLine)) {
                filled = row(no, Kind.IGNORE);
                block = null;
                chain = null;
            } else if (!monologue && nameLine != null && text.adjacent(i, i + 1) && standaloneName(text.get(i + 1)) == null) {
                // 모르는 이름 줄 — 블록 형식의 새 배역(행동 괄호가 붙으면 그 줄은 지문)
                filled = row(no, actionParen(t) ? Kind.DIRECTION : Kind.IGNORE);
                block = nameLine;
                known.add(nameLine);
                chain = null;
            } else if (head != null) {
                // 이름 머리가 블록보다 먼저다 — 블록 안에 다른 사람 머리 줄이 오면 그 사람 대사다
                String body = t.substring(Math.min(t.length(), head.header.strip().length())).strip();
                if (MARKS_ONLY.matcher(body).matches()) {
                    rows.put(no, row(no, Kind.IGNORE));
                    block = head.name;
                    chain = null;
                    continue;
                }
                // 「현정(유진), 재킷을 건넨다」처럼 이름 괄호 뒤에 쉼표가 오면 그 사람을 주어로 쓴 지문이다
                filled = PAREN_ONLY.matcher(body).matches() || told(body) || PAREN_COMMA.matcher(body).matches() ? row(no, Kind.DIRECTION)
                        : new Row(no, Kind.DIALOGUE, head.name, head.header);
                block = null;
                if (PAREN_ONLY.matcher(body).matches()) acting = head.name;
            } else if (block != null) {
                filled = toldLine(spoken) ? row(no, Kind.DIRECTION) : new Row(no, Kind.DIALOGUE, block, "");
            } else if (!monologue && strong != null) {
                known.add(strong);
                filled = new Row(no, Kind.DIALOGUE, strong, "");
            } else if (monologue) {
                filled = toldLine(spoken) ? row(no, Kind.DIRECTION) : new Row(no, Kind.DIALOGUE, monologueName, "");
            } else if (chain != null) {
                filled = toldLine(spoken) ? row(no, Kind.DIRECTION) : new Row(no, Kind.DIALOGUE, chain, "");
            } else if (directionLike(spoken) || toldLine(spoken) || last == null) {
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
            if (acting != null) {
                Handover next = Handover.to(acting, blockFormat);
                chain = next.chain();
                block = next.block();
                last = acting;
            }
        }
        fullNames(rows, text, lines);
        // 글자 사이를 띄운 이름(「칠    수」「에 밀 리」)은 붙여 쓴다 — 머리는 조립이 띄어쓰기 무시로 다시 찾는다
        rows.replaceAll((no, row) -> row.kind() == Kind.DIALOGUE && LETTER_SPACED.matcher(row.speaker()).matches()
                ? new Row(no, Kind.DIALOGUE, CharacterNames.squash(row.speaker()), row.header()) : row);
        Map<String, String> merged = !mergeSurnames ? Map.of()
                : surnameMerges(rows.values().stream().filter(row -> row.kind() == Kind.DIALOGUE).map(Row::speaker).toList());
        if (!merged.isEmpty()) {
            rows.replaceAll((no, row) -> row.kind() == Kind.DIALOGUE && merged.containsKey(row.speaker())
                    ? new Row(no, Kind.DIALOGUE, merged.get(row.speaker()), row.header()) : row);
        }
        List<String> roster = new ArrayList<>();
        rows.values().stream().sorted(java.util.Comparator.comparingInt(Row::no)).filter(row -> row.kind() == Kind.DIALOGUE)
                .map(Row::speaker).distinct().forEach(roster::add);
        return new Result(rows, roster, base.format(), lines.size());
    }

    /** 꾸밈이 붙은 등장인물 머리줄 — 「[등장인물]」「<등장인물>」「○ 등장인물」「등장인물들」「### 등장인물」. 줄 전체가 머리여야 한다. */
    private static final Pattern CAST_TITLE = Pattern.compile(
            "(?iu)[\\[<〈《【(（■□○●◆◇▶▷#*·•\\-\\s]*+(?:등장\\s*+인물(?:들|\\s*+소개)?+|나오는\\s*+(?:사람들?|이들?|인물들?)|cast|characters)"
                    + "\\s*+[\\]>〉》】)）]?+\\s*+");
    /**
     * 소개 묶음 뒤 본문이 시작하는 머리 — 무대·때·곳 설명(「무대, …」「때: …」), 노래 번호(「M01.」「NO.01」), 「Prologue」「Opening」, 괄호 지문.
     * 여기서 소개가 끝난다.
     */
    private static final Pattern SETTING_HEAD = Pattern.compile(
            "(?iu)[\\[<〈《【(（■□○●◆◇▶▷#*·•\\-\\s]*+(?:(?:무대|때|곳|장소|시간|시대|배경)(?:\\s*+[\\]>〉》】)）:：,，]|\\s*+$)|m\\s*+\\d|no\\.?\\s*+\\d"
                    + "|prologue|epilogue|opening|오프닝|서막).*|[(（].*[)）]\\s*+");

    /**
     * 등장인물 소개 자리를 무시로 둔다(풀규칙). 맨 앞 40줄 안의 등장인물 머리줄부터 첫 장면 줄·머리 있는 대사 줄·무대 설명 머리 앞까지다. 소개는
     * 이름 줄과 설명 문단이 섞여 {@link #castSection}이 첫 설명 문단에서 멈추고, 그 뒤 설명이 지문·대사로 읽히던 자리다. 장면·대사가 끝내 없으면
     * 건드리지 않는다.
     */
    private static void castArea(Text text, List<NumberedLine> lines, Map<Integer, Row> rows) {
        int header = -1;
        for (int i = 0, seen = 0; i < text.size() && seen < 40; i++) {
            if (text.blank(i)) continue;
            seen++;
            if (CAST_TITLE.matcher(text.get(i)).matches()) {
                header = i;
                break;
            }
        }
        if (header < 0) return;
        int end = -1;
        for (int j = header + 1; j < text.size(); j++) {
            if (text.blank(j)) continue;
            Row r = rows.get(lines.get(j).no());
            if (r != null && (r.kind() == Kind.SCENE || r.kind() == Kind.DIALOGUE && !r.header().isEmpty())
                    || SETTING_HEAD.matcher(text.get(j)).matches()) {
                end = j;
                break;
            }
        }
        if (end < 0) return;
        for (int j = header; j < end; j++) {
            int no = lines.get(j).no();
            Row r = rows.get(no);
            if (r == null || r.kind() == Kind.DIRECTION || r.kind() == Kind.DIALOGUE) rows.put(no, row(no, Kind.CAST));
        }
    }

    /** 머리 뒤 둘째 낱말 — 「와이트 히스만 난 …」의 「히스만」. */
    private static final Pattern SECOND_WORD = Pattern.compile("(\\p{IsHangul}{1,4}+)[^\\S\\n]++(?=\\S)");

    /**
     * 띄어 쓴 성·이름(「와이트 히스만」「휴 대커」)을 한 배역으로 잇는다(풀규칙). 띄어쓰기 머리로 받은 첫 낱말 뒤에 같은 낱말이 세 번 이상, 그 이름
     * 머리 줄의 80% 이상에서 오면 그 낱말까지가 이름이다. 둘째 낱말이 조사·어미로 끝나면(「민수 오늘은」) 말이라 잇지 않는다. 첫 낱말만 이름으로 받아 둘째 낱말이 대사 첫머리에 남던 자리다.
     */
    private static void fullNames(Map<Integer, Row> rows, Text text, List<NumberedLine> lines) {
        Map<String, Integer> heads = new HashMap<>();
        Map<String, Map<String, Integer>> seconds = new HashMap<>();
        Map<Integer, Integer> index = new HashMap<>();
        for (int i = 0; i < lines.size(); i++) index.put(lines.get(i).no(), i);
        for (Row row : rows.values()) {
            if (row.kind() != Kind.DIALOGUE || row.header().isEmpty() || row.speaker().indexOf(' ') >= 0) continue;
            String t = text.get(index.get(row.no()));
            if (!t.startsWith(row.speaker()) || t.length() <= row.speaker().length() || !Character.isWhitespace(t.charAt(row.speaker().length()))) continue;
            heads.merge(row.speaker(), 1, Integer::sum);
            Matcher gap = SPACE_AFTER.matcher(t).region(row.speaker().length(), t.length());
            Matcher m = SECOND_WORD.matcher(t);
            if (gap.lookingAt() && m.region(gap.end(), t.length()).lookingAt()) {
                seconds.computeIfAbsent(row.speaker(), key -> new HashMap<>()).merge(m.group(1), 1, Integer::sum);
            }
        }
        Map<String, String> renamed = new HashMap<>();
        seconds.forEach((name, words) -> words.forEach((word, n) -> {
            if (n >= 3 && n * 10 >= heads.get(name) * 8 && hangulName(word) && !speechEnd(word)) renamed.put(name, name + " " + word);
        }));
        if (renamed.isEmpty()) return;
        rows.replaceAll((no, row) -> {
            String full = row.kind() == Kind.DIALOGUE ? renamed.get(row.speaker()) : null;
            if (full == null) return row;
            String t = text.get(index.get(no));
            String header = row.header();
            if (!header.isEmpty() && t.startsWith(full)) {
                Matcher gap = SPACE_AFTER.matcher(t).region(full.length(), t.length());
                header = gap.lookingAt() ? t.substring(0, gap.end()) : full;
            }
            return new Row(no, Kind.DIALOGUE, full, header);
        });
    }

    // ── PDF 줄 잇기 ────────────────────────────────────

    /**
     * PDF 에서 화면 폭에 맞춰 잘린 줄을 잇는다(풀규칙, PDF 원본). PDF 는 그려진 줄 그대로 뽑혀 문장 중간에서 끊기고, 끊긴 줄 첫 글자(「고」「게」)가
     * 배역 이름처럼 보였다(2026-11-21 희곡 재생). 폭은 글 있는 줄 길이의 90번째 값이고, 그 80% 이상으로 꽉 찬 줄이 문장 끝 부호 없이 끝나면 다음 줄을
     * 잇는다 — 다음 줄이 배역 머리·괄호·장면·쪽 번호·「무대 …」로 시작하면 잇지 않는다. 끊긴 자리 끝에 공백이 남아 있으면 띄어 잇고(PDFBox 는
     * 원래 띄어쓰기 자리에서 끊긴 줄 끝에 공백을 남긴다), 없으면 붙여 잇는다(낱말 중간에서 끊김). 이은 줄은 첫 줄 번호를 쓴다.
     */
    public static List<NumberedLine> unwrap(List<NumberedLine> lines) {
        List<Integer> lengths = new ArrayList<>();
        for (NumberedLine line : lines) {
            String c = clean(line.text());
            if (!c.isEmpty()) lengths.add(c.codePointCount(0, c.length()));
        }
        if (lengths.size() < 20) return lines;
        java.util.Collections.sort(lengths);
        int width = lengths.get((int) (lengths.size() * 0.9));
        if (width < 20) return lines;
        return unwrap(lines, width, new HashSet<>(full(lines, true, true).roster()));
    }

    static List<NumberedLine> unwrap(List<NumberedLine> lines, int width, Set<String> names) {
        List<NumberedLine> out = new ArrayList<>();
        StringBuilder text = null;
        int first = -1;
        String lastRaw = null;
        int lastNo = Integer.MIN_VALUE;
        for (NumberedLine line : lines) {
            String c = clean(line.text());
            boolean join = text != null && !c.isEmpty() && line.no() == lastNo + 1 && cutAtWidth(lastRaw, width) && !startsTurn(c, names);
            if (join) {
                String joined = text.toString().stripTrailing();
                text.setLength(0);
                text.append(joined).append(endsWithSpace(lastRaw) ? " " : "").append(c);
            } else {
                if (text != null) out.add(new NumberedLine(first, text.toString()));
                text = new StringBuilder(line.text());
                first = line.no();
            }
            lastRaw = line.text();
            lastNo = line.no();
        }
        if (text != null) out.add(new NumberedLine(first, text.toString()));
        return out;
    }

    /** 폭 끝까지 찬 줄이 문장 끝 부호 없이 끝났나 — 화면 폭에서 잘린 줄. */
    private static boolean cutAtWidth(String raw, int width) {
        String c = clean(raw);
        return c.codePointCount(0, c.length()) * 10 >= width * 8 && !TERMINAL.matcher(c).matches();
    }

    /** 줄 끝(보이지 않는 글자를 빼고)에 공백이 남았나. */
    private static boolean endsWithSpace(String raw) {
        String s = INVISIBLE.matcher(raw).replaceAll("");
        return !s.isEmpty() && Character.isWhitespace(s.charAt(s.length() - 1));
    }

    /** 새 차례로 시작하는 줄인가 — 배역 머리·이름 줄·괄호·장면·쪽 번호·「무대 …」. */
    private static boolean startsTurn(String c, Set<String> names) {
        if (c.startsWith("(") || c.startsWith("（") || c.startsWith("[") || scene(c) || PAGE.matcher(c).matches() || STAGE.matcher(c).matches()) {
            return true;
        }
        String alone = standaloneName(c);
        return head(c, names) != null || alone != null && names.contains(alone);
    }

    /** 무시할 줄 — 꾸밈 선(「⸻」「*****」), 마크다운 메모(「* **메모:** …」), 음악 그림 글자로 시작하는 줄(「🎼 …」). */
    private static final Pattern IGNORABLE = Pattern.compile(
            "[-–—―─━═=*~_·•■□◆◇○●◎⸺⸻]{3,}+|⸻++|[*\\-•][^\\S\\n]*+\\*\\*.*|[\\x{1F3B5}\\x{1F3B6}\\x{1F3BC}].*");
    /** 독백 제목 — 「햄릿 독백」「오필리어의 독백」 / 「[독백] 서진」「독백: 서진」. */
    private static final Pattern TITLE_BEFORE = Pattern.compile("([\\p{IsHangul}A-Za-z]{1,8}?)(?:의)?[^\\S\\n]*+독백");
    private static final Pattern TITLE_AFTER = Pattern.compile("독백[^\\S\\n]*+[\\])】:：\\-–—]*+[^\\S\\n]*+([\\p{IsHangul}A-Za-z]{1,8})[^\\S\\n]*+");

    /** 첫 줄 「작품_이름(설명)」「작품 - 이름(20대)」 — 독백 대본 머리. 이름은 구분 부호 뒤, 괄호 앞. */
    private static final Pattern TITLE_NAME_LINE = Pattern.compile(
            "[^\\n]{1,30}?[_\\-–—·][^\\S\\n]*+([\\p{IsHangul}A-Za-z]{1,8})[^\\S\\n]*+[(（][^)）\\n]{1,20}+[)）][^\\S\\n]*+");
    /** 대괄호 안 이름만 있는 줄 — 「[민수]」. */
    private static final Pattern BRACKET_NAME_LINE = Pattern.compile("\\[[^\\S\\n]*+([^\\]\\n]{1,14}?)[^\\S\\n]*+]");

    /** 이름 바로 뒤 괄호에 쉼표가 이어진 나머지 — 「(유진), 양복 재킷을 …」. */
    private static final Pattern PAREN_COMMA = Pattern.compile("[(（][^()（）]{1,10}+[)）][^\\S\\n]*+[,，].*");
    /** 무대 신호 낱말만 있는 글 — 「등장.」「긴 침묵」. */
    private static final Pattern CUE_ONLY = Pattern.compile("(?:(?:긴|짧은|잠시|다시)[^\\S\\n]++)?+(?:등장|퇴장|입장|암전|사이|정적|침묵)[^\\S\\n]*+[.…]*+");
    /** 연출 지시 머리 — 「화면: …」「[자막]: …」「음악 : …」. */
    private static final Pattern SCREEN_HEAD = Pattern.compile("[\\[(]?+[^\\S\\n]*+(?:화면|자막|음악|음향|효과음|효과)[^\\S\\n]*+[\\])]?+[^\\S\\n]*+[:：]");
    /** 짧은 무대 신호로 끝나는 줄 — 「사이.」「긴 침묵」「암전.」「연수 등장.」. 30자 안의 앞말만 허용한다. */
    private static final Pattern CUE = Pattern.compile("[^\\n]{0,30}?(?:등장|퇴장|입장|암전|사이|정적|침묵)[^\\S\\n]*+[.…]*+");
    /** 확실한 대사 말끝 — 이름에는 오지 않는다. */
    private static final Pattern SURE_SPEECH_END = Pattern.compile(".*(?:요|니다|까|죠|네|래|세요|군요|구나|거든|잖아|는데|라고)[.!?…~]*");
    /** 블록 이름 줄로 받지 않는 조사 끝(「법정에」「무대에는」「허공에다가」). 「하은」「지은」처럼 이름에 흔한 끝은 둔다. */
    private static final Pattern PLACE_PARTICLE = Pattern.compile(".*(?:에|에서|에게|에다가|에는|으로|로는|한테|처럼|의|까지|부터)");

    /** 글자마다 띄운 이름 — 「칠    수」「에 밀 리」. */
    private static final Pattern LETTER_SPACED = Pattern.compile("\\S(?:[^\\S\\n]++\\S)++");
    /** 문장이나 줄이 끝난 모양 — 끝이 마침표·물음표·느낌표·말줄임·물결·닫는 괄호·따옴표. */
    private static final Pattern TERMINAL = Pattern.compile(".*[.?!…~」』”\"')）\\]]");

    /** 흔한 한국 성씨 — 「김민수」의 「김」. 두 글자 성은 {@link #COMPOUND_SURNAMES}. 역할 이름 앞 글자로 흔한 「부」(부반장)는 뺐다. */
    private static final Set<String> SURNAMES = Set.copyOf(List.of(("김 이 박 최 정 강 조 윤 장 임 한 오 서 신 권 황 안 송 류 유 전 홍 고 문 양 손"
            + " 배 백 허 남 심 노 하 곽 성 차 주 우 구 민 진 나 지 엄 채 원 천 방 공 현 함 변 염 여 추 도 소 석 선 설 마 길 연 위 표 명 기 반 왕"
            + " 금 옥 육 인 맹 제 모 탁 국 어 은 편 용 예 경 봉").split(" ")));
    /** 성 뒤에 와도 사람 이름이 아니라 역할인 말 — 「여학생」·「학생」, 「전남편」·「남편」은 다른 사람이거나 묶을 근거가 없다. */
    private static final Set<String> ROLE_WORDS = Set.of("학생", "남편", "아내", "원장", "반장", "대장", "주인", "부인", "사장", "회장", "선생",
            "선생님", "형사", "의사", "기자", "직원", "손님", "경찰", "간호사", "교수", "교사", "군인", "병사", "장교", "소녀", "소년", "여자", "남자",
            "아이", "아저씨", "아줌마", "할머니", "할아버지", "엄마", "아빠", "어머니", "아버지", "언니", "오빠", "누나", "동생", "친구", "사람", "청년",
            "노인", "부장", "과장", "대리", "실장", "팀장", "국장", "비서", "기사", "배우", "감독", "작가", "가수", "점원", "사원", "신입", "주임",
            "이장", "마님", "도령", "공주", "왕자", "대감", "영감", "상궁", "내관", "판사", "검사", "변호사", "목사", "신부", "수녀", "스님", "의원",
            "시장", "소장", "차장", "부대장", "중대장", "소대장");
    private static final Set<String> COMPOUND_SURNAMES = Set.of("남궁", "제갈", "선우", "황보", "독고", "사공", "서문", "동방", "어금", "망절");

    /**
     * 성 + 이름(「김민수」「김 민수」)과 이름만(「민수」「민 수」)으로 갈린 같은 사람을 하나로 묶는다(풀규칙). 이름 2~3글자만 본다. 같은 이름에
     * 성이 둘 이상 붙어 있으면(「김민수」·「이민수」) 누가 누군지 몰라 묶지 않고, 성 뒤가 역할 낱말이면(「여학생」·「학생」) 묶지 않는다.
     * 「민수 엄마」처럼 뒤에 말이 붙은 이름은 성 조합이 아니라 그대로다. 남기는 표기는 조립의 같은 사람 묶기와 같이 대사가 많은 쪽, 같으면 짧은 쪽,
     * 그다음 먼저 나온 쪽이다 — 2026-11-19 운영 대본에서 AI가 하나로 둔 126쌍 중 99쌍이 이름만 쪽을 남겼다.
     *
     * @param speakers 대사 줄마다의 화자(같은 이름이 여러 번 — 대사 수를 센다)
     * @return 바꿀 화자 표기 → 남길 화자 표기
     */
    public static Map<String, String> surnameMerges(List<String> speakers) {
        Map<String, Integer> count = new LinkedHashMap<>();
        speakers.forEach(speaker -> count.merge(speaker, 1, Integer::sum));
        Map<String, List<String>> bySquash = new LinkedHashMap<>();
        for (String speaker : count.keySet()) {
            bySquash.computeIfAbsent(CharacterNames.squash(speaker), key -> new ArrayList<>()).add(speaker);
        }
        Map<String, List<String>> fullsByGiven = new HashMap<>();
        for (String squashed : bySquash.keySet()) {
            for (String surname : List.of(squashed.length() > 2 ? squashed.substring(0, 2) : "", squashed.substring(0, Math.min(1, squashed.length())))) {
                if (surname.isEmpty() || !(SURNAMES.contains(surname) || COMPOUND_SURNAMES.contains(surname))) continue;
                String given = squashed.substring(surname.length());
                if (given.matches("\\p{IsHangul}{2,3}") && !ROLE_WORDS.contains(given) && bySquash.containsKey(given)) {
                    fullsByGiven.computeIfAbsent(given, key -> new ArrayList<>()).add(squashed);
                    break;
                }
            }
        }
        List<String> order = new ArrayList<>(count.keySet());
        Map<String, String> merged = new HashMap<>();
        fullsByGiven.forEach((given, fulls) -> {
            if (fulls.size() != 1) return;
            List<String> group = new ArrayList<>(bySquash.get(fulls.getFirst()));
            group.addAll(bySquash.get(given));
            String kept = java.util.Collections.min(group, java.util.Comparator.comparing((String name) -> -count.get(name))
                    .thenComparing(name -> name.codePointCount(0, name.length())).thenComparing(order::indexOf));
            group.stream().filter(name -> !name.equals(kept)).forEach(name -> merged.put(name, kept));
        });
        return merged;
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
        name = markName(t);
        if (name != null) return name;
        Matcher number = NUMBER_HEAD.matcher(t);
        if (number.lookingAt()) return number.group(1);
        name = group(SPACE_HEAD, t);
        // 줄 앞 첫 낱말은 띄어쓰기 이름 모양일 때만(횟수 기준은 부르는 쪽) — PDF 에서 잘린 줄의 「고」「게」, 흔한 말 「잠시」「그런」이
        // 배역이 됐다(2026-11-21 희곡 재생)
        return name != null && spaceName(name, Integer.MAX_VALUE) ? name : null;
    }

    /**
     * 풀규칙의 서술 판정 — {@link #narrative}에 더해 현재형 서술(받침 ㄴ·「는」 + 다: 「잠근다」「들어온다」「웃는다」)과 「있다·없다」로
     * 끝나는 줄. 대사 말투 끝이면 아니다. 하이브리드({@link #of})는 쓰지 않는다.
     */
    /** 사람을 주어로 세운 줄 머리 — 「민수, …」「민수는 …」「민수가 …」. */
    private static final Pattern SUBJECT_HEAD = Pattern.compile("(\\p{IsHangul}{1,6}?)(?:[,，]|[은는이가][^\\S\\n])");
    /** 줄 안 문장 끝 — 「…튼다.」의 「튼다」. */
    private static final Pattern INNER_END = Pattern.compile("(?<!\\p{IsHangul})(\\p{IsHangul}{0,7}다)[.。](?=[\\s\"”’']|$)");
    private static final Pattern PAREN_PART = Pattern.compile("[(（][^()（）]*+[)）]");

    /**
     * 풀규칙의 지문 판정 — {@link #told}에 더해, 사람을 주어로 세우고(「민수, …」「민수는 …」) 괄호 밖 문장이 서술로 닫히는 줄(「민수, 창문을 연다.
     * 바람이」). 지문 문단이 화면 폭에서 잘려 줄 끝이 문장 중간이면 줄 끝만 보는 {@link #told}가 놓쳐 앞 사람 대사로 붙던 자리다. 대명사(「나는 간다.」)는
     * 주어로 보지 않는다.
     */
    private static boolean toldLine(String t) {
        if (told(t)) return true;
        Matcher subject = SUBJECT_HEAD.matcher(t);
        if (!subject.lookingAt() || NOT_NAMES.contains(subject.group(1)) || NOT_NAMES.contains(t.substring(0, subject.end()).strip())) return false;
        Matcher end = INNER_END.matcher(PAREN_PART.matcher(t).replaceAll(""));
        while (end.find()) {
            if (told(end.group(1))) return true;
        }
        return false;
    }

    private static boolean told(String t) {
        if (narrative(t)) return true;
        if (speechEnd(t)) return false;
        int stop = t.length();
        // 공백은 정규식 \\s 와 같은 ASCII 공백만 — 끝의 공백·마침표·말줄임·따옴표·닫는 괄호를 걷는다
        while (stop > 0 && " \t\n\u000B\f\r.。…\"”’')）".indexOf(t.charAt(stop - 1)) >= 0) stop--;
        String bare = t.substring(0, stop);
        if (bare.length() < 2 || !bare.endsWith("다")) return false;
        char before = bare.charAt(bare.length() - 2);
        boolean finalN = before >= 0xAC00 && before <= 0xD7A3 && (before - 0xAC00) % 28 == 4;
        return finalN || before == '는' || bare.endsWith("있다") || bare.endsWith("없다");
    }

    /**
     * 쌍점 대신 붙임표·쌍반점·닫는 괄호로 나눈 머리 — 「병사- 거기 서라!」「현우; 해인아!」「여)나 갈게」. 이름에 바로 붙어야 하고 뒤에 글이 있어야 한다.
     * 「(웃으며)」처럼 여는 괄호가 앞에 있으면 아니다.
     */
    private static final Pattern MARK_HEAD = Pattern.compile("([^\\s\\-–;；()（）:：\\[\\]]{1,8}+)[\\-–;；)）][^\\S\\n]*+(?=[^\\s\\-–;；)）\\d])");

    private static String markName(String t) {
        String name = group(MARK_HEAD, t);
        return name != null && nameLike(name) ? name : null;
    }

    /** 숫자만 쓴 배역 머리 — 「4 야. 너희들 …」. 뒤에 글자가 와야 한다(「6 장」「1 막」은 장면이라 먼저 걸러진다). */
    private static final Pattern NUMBER_HEAD = Pattern.compile("(\\d{1,2})[^\\S\\n]++(?=[\\p{L}(（])");

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
                for (String name : inline.split("[,，、/·]")) {
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
            String name = colonTidy(m.group(1).strip());
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
        m = HANGUL_PERIOD_HEAD.matcher(t);
        if (m.lookingAt() && names.contains(m.group(1))) {
            return new Head(m.group(1), m.group(), Format.PERIOD);
        }
        m = TAB_HEAD.matcher(t);
        if (m.lookingAt() && names.contains(m.group(1))) {
            return new Head(m.group(1), m.group(1), Format.SPACE);
        }
        m = MARK_HEAD.matcher(t);
        if (m.lookingAt() && names.contains(m.group(1))) {
            return new Head(m.group(1), m.group(), Format.COLON);
        }
        m = LABELED_HEAD.matcher(t);
        if (m.lookingAt() && names.contains(m.group(1))) {
            return new Head(m.group(1), m.group(), Format.SPACE);
        }
        // 띄어 쓴 두 낱말 이름 머리 — 「6번 배심원 뭐가요?」「김 형사 왜?」. 긴 이름부터 본다(2026-11-21 12인의 성난 사람들: 첫 낱말
        // 「6번」만 보던 탓에 배심원 대사가 앞 사람 대사로 붙었다)
        Head wordy = null;
        for (String name : names) {
            if (name.indexOf(' ') < 0 || !t.startsWith(name) || t.length() <= name.length() + 1) continue;
            if (!Character.isWhitespace(t.charAt(name.length()))) continue;
            if (wordy == null || name.length() > wordy.name.length()) {
                Matcher gap = SPACE_AFTER.matcher(t).region(name.length(), t.length());
                wordy = new Head(name, gap.lookingAt() ? t.substring(0, gap.end()) : name + " ", Format.SPACE);
            }
        }
        if (wordy != null) return wordy;
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

    /** 부호뿐인 글 — 「댄 :」의 「:」. */
    private static final Pattern MARKS_ONLY = Pattern.compile("[:：;；\\-–—)）]++");
    /** 이름 뒤 띄어쓰기(뒤에 글이 있을 때). */
    private static final Pattern SPACE_AFTER = Pattern.compile("\\s++(?=\\S)");

    /** 쌍점 머리 앞 글머리표와 이름 뒤 괄호 — 「* 영식(민재):」「- 민수 (웃으며):」의 「*」「(민재)」. */
    private static final Pattern COLON_BULLET = Pattern.compile("[*•·\\-–]\\s*+");
    private static final Pattern COLON_PAREN = Pattern.compile("\\s*+[(（][^()（）]{1,10}+[)）]$");

    /** 쌍점 머리에서 글머리표와 이름 뒤 괄호를 뗀 이름. 떼고 남는 게 없으면 그대로다. */
    private static String colonTidy(String name) {
        Matcher bullet = COLON_BULLET.matcher(name);
        String s = bullet.lookingAt() && bullet.end() < name.length() ? name.substring(bullet.end()) : name;
        Matcher paren = COLON_PAREN.matcher(s);
        if (paren.find() && paren.start() > 0) s = s.substring(0, paren.start());
        return s.strip();
    }

    /** 여럿이 함께 말하는 배역 — 띄어쓰기형 대본에서 줄 앞에 두 번 넘게 나오면 받는다. */
    private static final Set<String> GROUP_SPEAKERS = Set.of("모두", "모두들", "다같이", "다함께", "전원");

    /** 흔한 말이지만 쌍점이 붙으면 배역인 말 — 「나: …」「모두: …」. */
    private static final Set<String> COLON_SPEAKERS = Set.of("나", "너", "저", "우리", "모두", "모두들", "다들", "함께", "다같이", "다 같이",
            "다함께", "아이들", "사람들", "전원", "소리", "목소리", "노래");

    private static String colonName(String t) {
        String name = group(COLON_HEAD, t);
        if (name == null) return null;
        name = colonTidy(name.strip());
        return nameLike(name) || COLON_SPEAKERS.contains(name) ? name : null;
    }

    private static String standaloneName(String t) {
        if (t == null) return null;
        Matcher m = NAME_LINE.matcher(t);
        if (!m.matches()) return null;
        String name = m.group(1).strip();
        // 낱말 둘까지 — 둘째는 번호·기호(「남자 1」「병사 갑」)이거나 호칭·역할(「김 형사」「늙은 여자」), 또는 「7번 배심원」. 「모두 신나게」
        // 「에이코 왜」 같은 말 조각은 이름이 아니다(2026-11-21 희곡 재생).
        String[] parts = name.split("\\s+");
        if (parts.length > 2) return null;
        if (parts.length == 2 && !(parts[1].matches("[0-9A-Za-z]{1,3}|[갑을병정무]") || TITLE_WORDS.contains(parts[1])
                || parts[0].matches("\\d{1,3}번"))) {
            return null;
        }
        return nameLike(name) && !scene(t) && !PLACE_PARTICLE.matcher(name).matches() ? name : null;
    }

    /** 대괄호로만 된 이름 줄 — 「[브래든]」「[ 여자 1 ]」. 안이 이름 줄 모양일 때만 이름이다(「[암전]」「[웃으며]」는 아니다). */
    private static final Pattern BRACKET_LINE = Pattern.compile("[\\[［]\\s*+([^\\[\\]［］]{1,14}+)[\\]］]");

    private static String bracketLineName(String t) {
        Matcher m = BRACKET_LINE.matcher(t);
        if (!m.matches()) return null;
        String name = standaloneName(m.group(1).strip());
        return name != null && !BRACKET_NOT.matcher(name).matches() && !told(name) ? name : null;
    }

    /** 대괄호 이름 줄로 받지 않는 행동 끝말 — 「[웃으며]」「[돌아서서]」「[사이]」. 「~다」는 서술 끝(「[웃는다]」)만 뺀다({@link #told}). */
    private static final Pattern BRACKET_NOT = Pattern.compile(".*(?:며|고|서|면|듯|채|게)|사이|암전|퇴장|등장|노래|음악");

    /** 이름 줄 끝의 쌍점·닫는 괄호를 뗀다 — 「민수:」「노아)」→ 민수·노아. 여는 괄호가 있으면(「민수 (V.O.)」) 그대로다. */
    private static String markless(String t) {
        if (t.length() < 2 || t.indexOf('(') >= 0 || t.indexOf('（') >= 0) return t;
        char end = t.charAt(t.length() - 1);
        return ":：)）".indexOf(end) >= 0 ? t.substring(0, t.length() - 1).stripTrailing() : t;
    }

    /** 시험용: 블록 이름 줄 판정. */
    static String standaloneNameForTest(String t) {
        return standaloneName(t);
    }

    /** 이름으로 볼 수 있는 글 — 짧고, 글자가 있고, 문장 끝 부호가 없고, 흔한 말이 아니다. */
    static boolean nameLike(String name) {
        if (name == null || name.isBlank()) return false;
        int length = name.codePointCount(0, name.length());
        if (length > NAME_MAX) return false;
        if (!name.codePoints().anyMatch(Character::isLetter)) return false;
        if (SENTENCE_END.matcher(name).matches()) return false;
        // 네 글자 넘게 확실한 말끝(「~요」「~니다」「~까」…)으로 끝나면 이름이 아니라 말이다(「말씀해주시겠어요」). 「아주머니」「할아버지」는 이름이다.
        if (length >= 4 && SURE_SPEECH_END.matcher(name).matches()) return false;
        // 한자가 섞인 머리(「第22回定期公演」「김슬기作」)는 제목·지은이 표기다
        if (name.codePoints().anyMatch(c -> Character.UnicodeScript.of(c) == Character.UnicodeScript.HAN)) return false;
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
    /** 줄 앞에 와도 이름이 아닌 꾸밈말(「작은 방」「젊은 여자」의 「작은」). */
    private static final Set<String> ADJECTIVES = Set.of("작은", "많은", "좋은", "같은", "높은", "젊은", "늙은", "남은", "죽은", "붉은", "검은",
            "깊은", "넓은", "얇은", "적은", "낡은", "굵은", "밝은", "맑은", "짧은", "옅은", "싫은", "옳은", "굳은", "그런", "이런", "저런");
    /** 이름에도 흔한 끝 글자 — 이 끝이면 세 번 넘게 나와야 이름으로 받는다(「윤서」「은지」「하나」「수아」). */
    private static final List<String> NAME_OR_WORD_END = List.of("이", "서", "지", "나", "아", "야", "어", "니");
    /** 이름에는 오지 않는 조사·어미 끝. */
    private static final List<String> PARTICLE_END = List.of("는", "를", "을", "에", "요", "다", "도", "만", "고", "며", "면", "데", "게", "께",
            "랑", "와", "과", "로", "의", "처럼");

    /**
     * 띄어쓰기형 머리 낱말을 이름으로 받을까 — 줄 앞에 {@code count} 번 나온 낱말. 한글 7자까지(「싸이먼스팀슨」), 대문자 로마자(「JOHN」), 흔한 말·
     * 꾸밈말·만든 사람 말은 빼고, 한 글자는 다섯 번, 「~은」은 두 글자(「하은」「지은」)만 세 번, 이름에도 흔한 끝(「윤서」「은지」)은 세 번, 조사·어미
     * 끝은 받지 않는다. 2026-11-21 운영 대본: 띄어쓰기형인데 하이브리드가 못 맡은 대본의 놓친 이름 4만 2천 줄 중 2만 5천 줄이 「이·서·지·나·아」
     * 끝 이름이었다.
     */
    private static final Pattern PAIR_NAME = Pattern.compile("(\\p{IsHangul}{1,4}+)/(\\p{IsHangul}{1,4}+)");

    static boolean spaceName(String name, int count) {
        if (name == null || NOT_NAMES.contains(name) || CREDIT.matcher(name).matches() || ADJECTIVES.contains(name)) return false;
        if (name.matches("[A-Z][A-Z'.\\-]{1,15}")) return count >= 3;
        // 두 배우가 나눠 맡는 배역(「해리/헤라」「크리스/케이트」) — 빗금 양쪽이 한글 이름이면 세 번 넘게 나올 때 받는다
        Matcher pair = PAIR_NAME.matcher(name);
        if (pair.matches()) return count >= 3 && !NOT_NAMES.contains(pair.group(1)) && !NOT_NAMES.contains(pair.group(2));
        if (!name.matches("\\p{IsHangul}{1,7}")) return false;
        int length = name.length();
        if (length == 1) return count >= 5;
        // 받침 뒤 「은」「이」는 조사다(「얀은」「문이」「경찰이」). 받침 없는 끝(「지은」「하은」「윤서」)은 이름일 수 있다.
        if (name.endsWith("은")) return length == 2 && !batchim(name, length - 2) && count >= 3;
        if (name.endsWith("이") && length >= 2 && batchim(name, length - 2)) return count >= 8;
        if (name.endsWith("가")) return GA_ROLES.stream().anyMatch(name::endsWith) && count >= 2;
        // 「~다」로 끝나는 이름(「헤다」「사우다」)은 다섯 번 넘게 나와야 받는다. 서술 끝(「잠근다」「있다」「했다」「그렇다」)은 아니다.
        if (name.endsWith("다")) return count >= 5 && !told(name) && "었았했였겠렇이하되".indexOf(name.charAt(length - 2)) < 0;
        if (PARTICLE_END.stream().anyMatch(name::endsWith)) return false;
        if (NAME_OR_WORD_END.stream().anyMatch(name::endsWith)) return count >= 3;
        return count >= 2;
    }

    /** {@code at} 자리 한글 음절에 받침이 있나. */
    private static boolean batchim(String s, int at) {
        char c = s.charAt(at);
        return c >= '\uAC00' && c <= '\uD7A3' && (c - 0xAC00) % 28 != 0;
    }

    /** 「~가」로 끝나는 직업 이름. */
    private static final List<String> GA_ROLES = List.of("작가", "화가", "소설가", "전문가", "사업가", "정치가", "평론가", "음악가", "성악가",
            "건축가", "탐험가", "여행가", "예술가", "혁명가", "작곡가", "연출가", "만화가", "번역가", "수집가", "애호가", "자본가", "법률가");

    private static boolean hangulName(String name) {
        // 조사·어미로 끝나는 낱말(「민수는」「했다」)만 거른다 — 「윤서」「은지」처럼 이름에 흔한 끝 글자는 둔다
        // 「~가」는 조사(「민수가」)지만 직업 이름(「작가」「극작가」「화가」)은 받는다 — 2026-11-21 희곡 재생에서 「극작가」를 놓쳤다
        boolean particleGa = name.endsWith("가") && GA_ROLES.stream().noneMatch(name::endsWith);
        return name.matches("\\p{IsHangul}{1,5}") && !NOT_NAMES.contains(name)
                && !name.endsWith("는") && !name.endsWith("은") && !particleGa && !name.endsWith("를")
                && !name.endsWith("을") && !name.endsWith("에") && !name.endsWith("요") && !name.endsWith("다");
    }

    // ── 도우미 ─────────────────────────────────────────

    /** 지문 말투인가 — 서술 끝(「~다.」「~음」)이고 대사 말투 끝이 아니다. 한글이 없는 줄(영어 대본)은 물음·느낌표가 없으면 지문이다. */
    public static boolean directionLike(String t) {
        if (t.codePoints().noneMatch(c -> Character.UnicodeScript.of(c) == Character.UnicodeScript.HANGUL)) {
            return !t.contains("?") && !t.contains("!");
        }
        // 「~다.」「~국.」처럼 마침표나 서술로 끝나면 지문. 대사 말투로 끝나거나 부호 없이 끝나는 줄(노랫말)은 아니다.
        return !speechEnd(t) && CLOSED.matcher(t).matches();
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

    /** 두 칸 이상 띄우거나 탭으로 떨어진 줄 앞 낱말. */
    private static String wideName(String t) {
        Matcher m = WIDE_HEAD.matcher(t);
        if (!m.lookingAt()) return null;
        String gap = m.group(2);
        return gap.length() >= 2 || gap.indexOf('\t') >= 0 ? m.group(1) : null;
    }

    private static int firstContent(Text text) {
        for (int i = 0; i < text.size(); i++) {
            if (!text.blank(i)) return i;
        }
        return -1;
    }

    /**
     * 「민수 (창밖을 본다)」「민수 : (한숨)」「[민수] (웃는다)」 — 아는 이름 머리 뒤가 괄호 지시 하나뿐인 줄의 이름. 아니면 null. 괄호 길이는
     * 묻지 않는다(블록 이름 줄 판정은 괄호 12자까지라 긴 행동 지시 뒤 대사가 앞 사람 몫이 됐다 — 2026-11-22 r4 대조).
     */
    static String actionHeadName(String t, Set<String> known) {
        String inside = tailParen(t);
        if (inside == null) return null;
        String s = t.stripTrailing();
        int open = s.length() - inside.length() - 2;
        if (open <= 0) return null;
        String head = s.substring(0, open).strip();
        if (head.endsWith(":") || head.endsWith("：")) head = head.substring(0, head.length() - 1).strip();
        if (head.startsWith("[") && head.endsWith("]")) head = head.substring(1, head.length() - 1).strip();
        return known.contains(head) ? head : null;
    }

    /** 「[민수]」「[어린 민수]」만 있는 줄의 아는 이름(괄호 안 끝 이름). 아니면 null. */
    static String bracketNameLine(String t, Set<String> known) {
        Matcher m = BRACKET_NAME_LINE.matcher(t);
        if (!m.matches()) return null;
        String inside = m.group(1).strip();
        if (known.contains(inside)) return inside;
        for (String name : known) {
            if (name.codePointCount(0, name.length()) >= 2 && inside.endsWith(name)) return name;
        }
        return null;
    }

    /** 이름 + 괄호 지시 줄 뒤 이어 받을 사람 — 블록 대본은 블록, 아니면 이어지는 말(지문 말투면 지문). 이름이 없으면 둘 다 끊는다. */
    private record Handover(String block, String chain) {
        static Handover to(String acting, boolean blockFormat) {
            if (acting == null) return new Handover(null, null);
            return blockFormat ? new Handover(acting, null) : new Handover(null, acting);
        }
    }

    /** 「/」로 두 번 넘게 나눈 괄호 — 노랫말. */
    private static boolean lyrics(String t) {
        return t.chars().filter(c -> c == '/').count() >= 2;
    }

    /** 괄호를 열고 닫지 않은 줄(여러 줄 괄호 지문의 시작). 노랫말 괄호는 아니다. */
    private static boolean opensParen(String t) {
        if (!(t.startsWith("(") || t.startsWith("（")) || lyrics(t)) return false;
        long open = t.chars().filter(c -> c == '(' || c == '（').count();
        long close = t.chars().filter(c -> c == ')' || c == '）').count();
        return open > close;
    }

    /** {@code from} 줄에서 연 괄호가 빈 줄 없이 네 줄 안에서 닫히는 줄. 없으면 -1. */
    private static int parenClose(Text text, int from) {
        for (int j = from + 1; j < text.size() && j <= from + 4 && text.adjacent(j - 1, j); j++) {
            String t = text.get(j);
            if (t.indexOf(')') >= 0 || t.indexOf('）') >= 0) return j;
        }
        return -1;
    }

    /** 끝 괄호 지시를 뗀 말 — 「같이 가자! (손을 내민다)」→「같이 가자!」. 괄호뿐이면 그대로. */
    static String withoutTailParen(String t) {
        String inside = tailParen(t);
        if (inside == null) return t;
        String s = t.stripTrailing();
        String head = s.substring(0, s.length() - inside.length() - 2).strip();
        return head.isEmpty() ? t : head;
    }

    /**
     * 독백 대본 제목에서 화자 이름을 꺼낸다 — 「햄릿 독백」「오필리어의 독백」→ 햄릿·오필리어, 「[독백] 서진」「독백: 서진」→ 서진. 없으면 null.
     * 풀규칙에서 이름을 못 찾은 독백이 「화자」로 남던 자리다(정답 셋 7지점은 이름이 제목에만 있었다).
     */
    public static String monologueName(String title) {
        if (title == null) return null;
        String t = clean(title);
        Matcher before = TITLE_BEFORE.matcher(t);
        String name = null;
        if (before.find()) {
            name = before.group(1);
        } else {
            Matcher after = TITLE_AFTER.matcher(t);
            if (after.find() && after.end() == t.length()) name = after.group(1);
        }
        return name != null && nameLike(name) && !name.equals("독백") ? name : null;
    }

    /**
     * 한 줄에 여러 사람 대사를 이어 쓴 원문을 나눈다(풀규칙) — 「에이코 뭐고?  준코 띄엄띄엄 보고 있다. 키요코 …」. 줄 안에서 두 칸 이상 띄운 뒤나
     * 문장 끝 부호 뒤에 아는 배역 이름 + 띄어쓰기가 오면 거기서 자른다. 두 칸 띄운 자리가 대본에 세 번 이상 있을 때만 한다 — 보통 대본의
     * 「몰라. 민수 너는 알아?」를 자르지 않으려는 것이다(그런 줄이 글 줄의 2% 이상일 때만). 나뉜 조각은 이어진 번호를 받는다(빈 줄 자리는 번호를 하나 건너뛴다).
     */
    public static List<NumberedLine> splitTurns(List<NumberedLine> lines, Set<String> names) {
        List<String> sorted = names.stream().filter(n -> !n.isBlank()).sorted((a, b) -> b.length() - a.length()).toList();
        if (sorted.isEmpty()) return lines;
        String alternation = String.join("|", sorted.stream().map(Pattern::quote).toList());
        Pattern wide = Pattern.compile("(?<=\\S)[^\\S\\n]{2,}+(?=(?:" + alternation + ")[\\s(（:：])");
        Pattern boundary = Pattern.compile("(?<=\\S)[^\\S\\n]{2,}+(?=(?:" + alternation + ")[\\s(（:：])|(?<=[.?!…~])[^\\S\\n]++(?=(?:" + alternation + ")[\\s(（:：])");
        int wideLines = 0;
        int content = 0;
        for (NumberedLine line : lines) {
            String c = clean(line.text());
            if (!c.isEmpty()) content++;
            if (wide.matcher(c).find()) wideLines++;
        }
        if (wideLines < 3 || wideLines * 50 < content) return lines;
        List<NumberedLine> out = new ArrayList<>();
        int next = 0;
        int previousNo = Integer.MIN_VALUE;
        for (NumberedLine line : lines) {
            if (previousNo != Integer.MIN_VALUE && line.no() != previousNo + 1) next++;
            previousNo = line.no();
            String[] pieces = boundary.split(clean(line.text()));
            if (pieces.length <= 1) {
                out.add(new NumberedLine(++next, line.text()));
                continue;
            }
            for (String piece : pieces) {
                if (!piece.isBlank()) out.add(new NumberedLine(++next, piece.strip()));
            }
        }
        return out;
    }

    /** 장면 표기 줄인가. */
    private static boolean scene(String t) {
        return SCENE.matcher(t).matches() || BRACKET_SCENE.matcher(t).matches() || SCENE_MORE.matcher(t).matches();
    }

    /** 이름 줄의 괄호가 목소리 표시가 아닌 행동인가 — 「도윤 (창밖을 본다)」. 괄호가 없으면 아니다. */
    private static boolean actionParen(String t) {
        String inside = tailParen(t);
        return inside != null && !inside.isBlank() && !VOICE_MARK.matcher(inside).matches();
    }

    /**
     * 줄 끝 괄호의 안쪽 — 끝이 닫는 괄호(뒤 공백 허용)이고, 그 앞 마지막 닫는 괄호 뒤에서 처음 여는 괄호부터 끝 괄호 앞까지다. 없으면 null.
     * 「도윤 (창밖을 본다)」→「창밖을 본다」. 정규식 「.*?[(（]([^)）]*)[)）]\\s*」와 같고 되짚기가 없다.
     */
    static String tailParen(String t) {
        String s = t.stripTrailing();
        if (s.isEmpty() || ")）".indexOf(s.charAt(s.length() - 1)) < 0) return null;
        int close = s.length() - 1;
        int from = Math.max(s.lastIndexOf(')', close - 1), s.lastIndexOf('）', close - 1)) + 1;
        for (int k = from; k < close; k++) {
            if (s.charAt(k) == '(' || s.charAt(k) == '（') return s.substring(k + 1, close);
        }
        return null;
    }

    /**
     * 대사 말투로 끝나는가 — 끝 따옴표 하나와 끝의 「.!?…~」를 걷은 뒤, 걷은 것에 「?!~」가 있거나 남은 글이 대사 끝말(「~요」「~야」「♪」…)로
     * 끝난다. 정규식 「.*(?:[?!~♪]|요|…)[.!?…~]*["”’']?」와 같고 되짚기가 없다 — 다만 줄 가운데 유니코드 줄 구분(U+2028)이 있어도
     * 판정한다(정규식의 「.」이 그 글자를 넘지 못해 늘 아니라고 했다, 운영 대본 4줄).
     */
    static boolean speechEnd(String t) {
        String s = t;
        if (!s.isEmpty() && "\"”’'".indexOf(s.charAt(s.length() - 1)) >= 0) s = s.substring(0, s.length() - 1);
        int end = s.length();
        while (end > 0 && ".!?…~".indexOf(s.charAt(end - 1)) >= 0) end--;
        for (int k = end; k < s.length(); k++) {
            if ("?!~".indexOf(s.charAt(k)) >= 0) return true;
        }
        String head = s.substring(0, end);
        return SPEECH_ENDINGS.stream().anyMatch(head::endsWith);
    }

    /** 서술 지문 말투인가(이름으로 시작하는 줄의 나머지). */
    private static boolean narrative(String body) {
        return NARRATIVE.matcher(body).matches() && !speechEnd(body);
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

    /** 쪽 번호 바로 옆에서 숫자만 바뀌며 세 번 이상 나오는 줄 — 반복 쪽 머리글. */
    private static boolean pageHeader(Text text, int i, Map<String, Integer> repeats) {
        String t = text.get(i);
        return hasDigit(t) && repeats.getOrDefault(digitless(t), 0) >= 3 && between(t, 4, 60) && pageNear(text, i);
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
        return WIDE_SPACE.matcher(INVISIBLE.matcher(nfc).replaceAll("")).replaceAll(" ").strip();
    }
}
