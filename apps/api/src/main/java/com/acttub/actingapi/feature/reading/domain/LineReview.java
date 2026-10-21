package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import com.acttub.actingapi.feature.reading.domain.SplitResponse.Kind;
import com.acttub.actingapi.feature.reading.domain.SplitResponse.Row;

/**
 * 나누기 답 뒤의 두 번째 의견(SOMA-663 실험 J1). 줄마다 판단 모델(Jev)에게 줄 종류와 화자를 묻고, 확신도가 문턱 이상일 때만
 * 나누기 답을 바꾼다. 묻는 글은 판단할 줄과 앞 8·뒤 4줄의 창이고, 화자 보기는 첫 조립이 낸 배역 목록과 그 창의 화자 머리다 — 운영
 * 경로가 가진 정보만 쓴다.
 *
 * <p>머리 없는 대사 줄 중 위쪽 가장 가까운 화자 머리가 나누기 답과 다르거나 괄호 안에 배역이 나오는 줄, 함께 말하기 머리 줄에는 창 뒤에 문맥
 * 근거(그 화자 머리, 장면에서 말한 배역, 괄호 안 이름의 뜻)와 장면 배역을 앞세운 보기·참여자 집합 보기를 보낸다(SOMA-663 C2).
 *
 * <p>묻는 줄: 나누기 답이 대사·지문(답 없음 포함)인 줄과, 첫 대사와 끝 대사 사이에 끼인 무시·제목·등장인물 줄(SOMA-663 N2). 쪽 번호
 * 줄과 이름만 있는 대사 줄(블록 형식의 이름 줄)은 묻지 않는다 — 앞은 조립이 무시 줄로 정하고, 뒤를 지문으로 바꾸면 이름이 대본 줄에
 * 남는다. 끼인 줄 중 이름 줄(다음 줄이 머리 없는 대사이거나 글이 배역 이름뿐)과 여러 번 나오는 머리말·꼬리말도 묻지 않는다. 끝 대사 뒤의
 * 짧은 제외 줄(「- 막 -」 같은 끝 표시)도 묻는다(SOMA-663 K2).
 * {@link Mode#SUSPECT} 는 그중 {@link Question#reasons} 가 있는 줄만 묻는다.
 */
public final class LineReview {

    public static final String KIND_QUESTION = "kind";
    public static final String SPEAKER_QUESTION = "speaker";
    public static final String NONE = "none";
    public static final String KIND_INSTRUCTIONS =
            "▶ 표시가 붙은 「판단할 줄」이 대본에서 어떤 종류의 줄인지 고르세요. 앞뒤 줄은 판단을 돕는 문맥입니다.";
    /**
     * 문서 맨 앞·끝 줄에 같은 요청으로 더 묻는 질문 — 대본 앞뒤에 붙은 안내 글을 지문·대사로 남기는 오답(재생 175·177·180)을 줄인다.
     * 종류 질문은 다른 줄과 같은 글자로 두고 따로 묻는다: 종류 지시문에 섞으면 「사이.」 같은 끝 지문까지 답이 흔들렸다(재생 008·178).
     */
    public static final String EDGE_QUESTION = "edge";
    public static final List<Choice> EDGES = List.of(
            new Choice("script", "대본 내용", "연기할 대본의 대사·지문·장면 표제. 막·장의 끝 표시도 대본 내용이다."),
            new Choice("guide", "안내 글", "대본 앞뒤에 붙은 작성자·AI 의 안내와 설명, 연기·읽기 방법 안내, 대본과 상관없는 글."),
            new Choice("info", "작품 정보", "작품 제목·작가·장르·러닝타임, 배역과 배우 정보 줄."));
    private static final Map<String, Kind> EDGE_OF = Map.of("guide", Kind.IGNORE, "info", Kind.TITLE);
    /** 장면 사이에 끼인 제외 줄에 더 묻는 질문 — 각주·해설이 지문으로 되살아나지 않게 한다(재생 076). */
    public static final String NOTE_QUESTION = "note";
    public static final String NOTE_INSTRUCTIONS = "▶ 표시가 붙은 「판단할 줄」이 연기할 대본의 내용인지, 대본에 덧붙은 글인지 고르세요.";
    public static final List<Choice> NOTES = List.of(
            new Choice("script", "대본 내용", "연기할 대본의 대사·지문·장면 표제."),
            new Choice("note", "덧붙은 글", "대본 줄에 붙은 각주·해설·주석, 연출·제작 메모, 대본과 상관없는 글."));
    /**
     * 줄 앞 괄호 행동 뒤에 글이 이어지는 지문 줄에 더 묻는 질문 — 「(전화가 울린다) 또 오네.」의 말을 살린다(재생 007·012·053·082). 「서술」만
     * 두면 Jev 가 소리로 읽는 내레이션 「(NA.) …」도 서술로 골랐다(재생 002) — 말은 관객이 듣는 글, 서술은 소리 내지 않는 무대 설명이다.
     */
    public static final String TALK_QUESTION = "talk";
    public static final List<Choice> TALKS = List.of(
            new Choice("speech", "말", "배역이 소리 내어 하는 대사. 부르는 말·감탄·대답도 말이다. 내레이션(NA)·화면 밖 목소리(VO)·독백·기계나 방송의 음성처럼 관객이 소리로 듣는 글도 말이다."),
            new Choice("narration", "무대 서술", "소리 내어 읽지 않고 인물의 행동·상황·무대를 설명하는 글, 효과음·조명·음향 설명."));
    private static final int TALK_CHARS = 80;
    /**
     * 앞 줄이 대사가 아닌 머리 없는 대사 줄에 더 묻는 질문 — 종이·문자·화면에 적힌 글을 대사로 남기는 오답(재생 186 「너 때문에 다 피곤해.」)을
     * 줄인다. 글이라는 답을 내리기 문턱만큼 확신할 때만 지문으로 바꾼다.
     */
    public static final String MEDIUM_QUESTION = "medium";
    public static final String MEDIUM_INSTRUCTIONS = "▶ 줄의 글은 관객이 소리로 듣는 실제 발화인가? 내레이션/NA/화면 밖 음성도 발화다. "
            + "종이/문자/문서에 적혀 보이기만 하는 글은 소리로 읽는다는 근거가 없으면 발화가 아니다. 인물 행동과 무대 설명도 발화가 아니다.";
    public static final List<Choice> MEDIUMS = List.of(
            new Choice("voice", "실제 발화", "인물 대사, 내레이션, 화면 밖 음성처럼 소리로 하는 말"),
            new Choice("writing", "화면이나 종이의 글", "종이·문자·문서·화면에 적혀 보일 뿐 읽는 소리 근거가 없는 글"),
            new Choice("action", "행동/상황", "인물 행동이나 상황·장소·무대 설명"),
            new Choice("unsure", "판단 보류", "원문에서 구별할 근거가 부족하다"));
    /** 사람 수 없이 함께 말한다는 표지 — 줄 앞 괄호 「(같이)」나 머리 「함께 :」(재생 020). 「(함께 걸으며)」 같은 행동은 아니다. */
    private static final Pattern TOGETHER = Pattern.compile("^\\s*\\(\\s*(같이|함께)\\s*\\)");
    private static final Pattern TOGETHER_TAG = Pattern.compile("같이|함께");
    /** 줄 맨 앞 낱말 + 괄호 행동 — 「여주VO (나지막하게) …」의 「여주VO」(재생 050). */
    private static final Pattern OWN_HEAD = Pattern.compile("^(\\s*([\\p{L}\\p{N}]{1,8})\\s+)\\(");
    public static final String SPEAKER_INSTRUCTIONS = "▶ 표시가 붙은 「판단할 줄」이 대사라면, 그 대사를 말하는 배역을 고르세요. "
            + "줄 머리의 이름 표기가 띄어져 있거나 조금 달라도 같은 사람이면 그 배역입니다. "
            + "대사가 아니거나 보기에 맞는 배역이 없으면 none 을 고르세요.";
    /** 보기 값 → 종류. 값·설명은 R3 실험({@code decision/questions.json})과 같은 글자다. */
    public static final List<Choice> KINDS = List.of(
            new Choice("dialogue", "대사", "배역이 말하는 줄. 「이름 대사」「이름: 대사」 꼴이거나, 이름만 있는 줄 다음에 오는 말. 괄호 행동이 섞여 있어도 말이 있으면 대사다."),
            new Choice("direction", "지문", "행동·상황·무대 설명. 괄호로만 된 줄, 「~한다」 꼴의 서술, 효과음 설명."),
            new Choice("scene", "장면", "장면 번호·장소·시간을 밝히는 표제. 예: 「S#3. 거실. 밤」, 「1막 2장」."),
            new Choice("title", "제목", "작품 제목이나 부제, 작가 이름 줄."),
            new Choice("cast", "등장인물", "등장인물 소개 목록의 줄(이름과 설명)."),
            new Choice("ignore", "무시", "쪽 번호, 머리말·꼬리말, 메모, 대본과 상관없는 글."));
    private static final Map<String, Kind> KIND_OF = Map.of("dialogue", Kind.DIALOGUE, "direction", Kind.DIRECTION,
            "scene", Kind.SCENE, "title", Kind.TITLE, "cast", Kind.CAST, "ignore", Kind.IGNORE);
    private static final int BEFORE = 8;
    private static final int AFTER = 4;
    private static final int MAX_CHARS = 160;
    private static final int MAX_SPEAKERS = 8;
    private static final int MAX_HEADS = 3;
    /** 문서 위치를 알려 주는 맨 앞·끝 줄 수. */
    private static final int EDGE = 10;
    /** 여러 번 나와도 머리말·꼬리말로 보지 않는 짧은 글(단어 중간에서 끊긴 대사 토막 「먼」, 재생 031). */
    private static final int REPEAT_MIN_CHARS = 4;
    /** 이름 뒤가 괄호 행동뿐인 줄 — 말이 없다. */
    private static final Pattern ACTION = Pattern.compile("(\\([^()]*\\)\\s*)+");
    private static final Pattern PAREN = Pattern.compile("\\([^()]*\\)");
    /** 줄 앞 괄호(또는 앞 줄에서 열린 괄호의 닫힘) 뒤의 글. */
    private static final Pattern LEADING_ACTION = Pattern.compile("^\\s*\\([^()]*\\)\\s*(?<rest>[^(\\s].*)$");
    /** 줄 앞 괄호 화자 표시(「(NA.) 」) — 괄호 안이 배역 이름인지는 따로 본다. */
    private static final Pattern MARK_HEAD = Pattern.compile("^(\\s*\\(([^()]{1,12})\\)\\s*)");
    private static final Pattern CARRIED_ACTION = Pattern.compile("^[^()]*\\)\\s*(?<rest>[^(\\s].*)$");
    private static final Pattern NAME_MARKS = Pattern.compile("[\\[\\]:：]");
    /** 제외 줄(무시·제목·등장인물)을 되살릴 때 글자가 하나는 있어야 한다 — 구분선·숫자·문장부호뿐인 줄은 묻지 않는다(재생 185·186·101). */
    private static final Pattern LETTER = Pattern.compile("\\p{L}");
    /**
     * 구분선 — 줄표·선 문자·등호·별표·물결만으로 된 줄(「⸻」·「━━━」·「* * *」, 공백 무시). 두 글자까지는 긴 선 문자가 있거나 문서에 같은 줄이 또
     * 있어야 한다 — 한 번 나온 「-」·「~」는 말줄임일 수 있다. 줄 모양만 보고 첫 종류 답의 수에 기대지 않는다(재생 185: 같은 「⸻」 다섯 줄이 판마다
     * 무시·지문으로 갈렸다).
     */
    private static final Pattern SEPARATOR = Pattern.compile("[-‐‑‒–—―=*~_\\u2500-\\u257F\\u2E3A\\u2E3B]+");
    private static final Pattern RULE_LINE = Pattern.compile("[\\u2500-\\u257F\\u2E3A\\u2E3B]");
    /** 따옴표로 감싼 인용 발화 줄(「“나 완전 괜찮은데?”」). */
    private static final Pattern QUOTE = Pattern.compile("[“\"「『].*\\p{L}.*[”\"」』][.!?…]*");
    /** 끝 대사 뒤에서 묻는 제외 줄의 최대 글자 수 — 「- 막 -」·「끝.」 같은 끝 표시만 묻고, 뒤에 붙은 해설 문단은 묻지 않는다(재생 076). */
    private static final int TAIL_CHARS = 12;
    /** 앞뒤를 줄표·물결로 꾸민 끝 표시(「- 막 -」·「= 끝 =」). 꾸밈 없는 「암전.」은 지문이다. */
    private static final Pattern END_MARK = Pattern.compile("[-‐‑‒–—―=~*]+\\s*[^-‐‑‒–—―=~*\\s][^-‐‑‒–—―=~*]*?\\s*[-‐‑‒–—―=~*]+");
    /** 문장이 끝난 줄 끝 — 마침·물음·느낌표, 말줄임, 닫는 따옴표·괄호, 줄표(끊긴 말), 물결·음표. */
    private static final Pattern ENDED = Pattern.compile("[.!?…。」』”\"'’)\\]\\-—~♪]$");
    /** 함께 말하기 화자(「아메드, 하딜」·「모두」). 보기는 한 사람씩이라 Jev 가 한 명으로 줄인다(재생 047·003·008). */
    private static final Pattern GROUP = Pattern.compile("[,/·•∙・&]|모두|다\\s*같이|둘\\s*다|전원|일동|합창|코러스");
    /** 블록 근거(SOMA-663 C2): 화자 머리를 찾아 올라가는 줄 수와, 장면 배역을 모으는 앞뒤 줄 수(장면 표제를 넘지 않는다). */
    private static final int BLOCK_LINES = 40;
    private static final int SCENE_LINES = 150;
    /** 사람 수로 적은 함께 말하기 머리(「셋」·「둘다」·「세 여자」) — 그 장면의 몇 사람인지 집합 보기로 묻는다(재생 022). */
    private static final Pattern COUNTED = Pattern.compile("(둘|셋|넷|다섯)\\s*(?:다|사람|명)?|(두|세|네|다섯)\\s*(?:사람|명|여자|남자)");
    /** 이름표 모양의 머리 끝 — 쌍점·닫는 대괄호, 탭·U+3000·공백 두 칸 이상. */
    private static final Pattern LABEL_END = Pattern.compile("[:：\\]]|\\t|\\u3000|\\s{2,}");
    private static final Map<String, Integer> COUNTS = Map.of("둘", 2, "두", 2, "셋", 3, "세", 3, "넷", 4, "네", 4, "다섯", 5);
    /** 이름표처럼 보이는 짧은 줄 — 글자만 1~8자(「All」·「앙상블」). 배역 목록에 없는 화자 표시일 수 있다. */
    private static final Pattern TAG_LINE = Pattern.compile("[\\p{L}\\s]{1,8}");
    private static final Pattern NAME_SPLIT = Pattern.compile("[,，/·•∙・&+、]");
    /** 집합 보기를 만들 가까운 장면 배역 수와 집합 보기 수. */
    private static final int SET_PEOPLE = 5;
    private static final int MAX_SETS = 6;

    private LineReview() {
    }

    public enum Mode { ALL, SUSPECT }

    /**
     * @param kindThreshold 종류를 바꾸는 확신도 하한(대사인 줄을 다른 종류로 내리는 것은 빼고)
     * @param dropThreshold 대사인 줄을 다른 종류로 내리는 확신도 하한 — Jev 의 종류 오답은 대부분 이어지는 대사를 지문으로 보는 쪽이다
     * @param speakerThreshold 화자를 바꾸는 확신도 하한
     * @param edgeThreshold 문서 맨 앞·끝 지문 줄을 안내 글·작품 정보로 빼는 확신도 하한(대사 줄은 내리기 문턱)
     * @param speechThreshold 괄호 행동 뒤 글을 말로 보고 지문 줄을 대사로 바꾸는 확신도 하한
     * @param blockThreshold Jev 화자가 위쪽 가장 가까운 화자 머리({@link Question#head})와 같을 때 화자를 바꾸는 확신도 하한
     * @param parallel 동시 질문 수
     */
    public record Settings(Mode mode, double kindThreshold, double dropThreshold, double speakerThreshold, double edgeThreshold,
            double speechThreshold, double blockThreshold, int parallel) {
    }

    /** 같은 요청에 더 묻는 질문 하나. */
    public record Extra(String key, String instructions, List<Choice> choices) {
    }

    public record Choice(String value, String label, String description) {
    }

    /**
     * 줄 하나의 질문.
     *
     * @param reasons 의심 사유 — {@code dropped}(4단계 답에서 빠졌거나 버려짐), {@code unanswered}(끝까지 답 없음),
     *        {@code nohead}(머리 없는 대사), {@code rule}(줄 머리의 배역 이름과 답이 어긋남), {@code excluded}(장면 사이에 끼인
     *        무시·제목·등장인물 줄), {@code action}(이름 뒤가 괄호 행동뿐인 대사), {@code edge}(문서 맨 앞·끝 줄),
     *        {@code talk}(줄 앞 괄호 행동 뒤에 글이 있는 지문·머리 없는 대사), {@code nospeech}(괄호·화자 이름 밖에 글자가 없는 지문),
     *        {@code tail}(끝 대사 뒤의 짧은 제외 줄), {@code carry}(대사 블록에 이어지는 등장인물 줄),
     *        {@code decor}(구분선 모양의 지문 — 무시 줄로 바꾼다), {@code quote}(인용 발화 모양의 제목·등장인물 줄),
     *        {@code front}(첫 대사 앞 문서 머리의 등장인물 줄), {@code mark}(줄 앞 괄호가 배역 이름뿐인 화자 표시 「(NA.) 」인 {@code talk} 줄)
     * @param current 지금 답. 없으면 {@code null}(지문이 된다)
     * @param extras 같은 요청에 더 묻는 질문({@link #EDGE_QUESTION}·{@link #NOTE_QUESTION}·{@link #TALK_QUESTION}·{@link #MEDIUM_QUESTION})
     * @param talk {@code talk}·{@code carry} 줄을 대사로 바꿀 때의 원문 머리와 앞뒤 블록 화자(없으면 빈 글). 아니면 {@code null}
     * @param head 머리 없는 줄 위로 가장 가까운 화자 머리의 배역(문맥 근거를 보낸 줄만). 없으면 {@code null}
     * @param watched 줄의 괄호 안에 나온 배역 — 바라보거나 말을 거는 대상(「(지해, 연수 보며)」)
     * @param own 머리 없는 대사 줄 맨 앞의, 배역 목록에 없는 원문 화자 표기(뒤 공백 포함, 「여주VO 」). 화자 보기로 주고, Jev 가 고르면 이 표기가
     *        머리다. 없으면 {@code null}
     */
    public record Question(int no, Set<String> reasons, String state, List<Choice> speakers, Row current, List<Extra> extras, Row talk,
            String head, Set<String> watched, String own) {
        public Question(int no, Set<String> reasons, String state, List<Choice> speakers, Row current, List<Extra> extras, Row talk,
                String head, Set<String> watched) {
            this(no, reasons, state, speakers, current, extras, talk, head, watched, null);
        }
    }

    public record Answer(String choice, double confidence) {
    }

    /** 질문들의 답. 모델이 답하지 않은 질문은 {@code null}, 더 물은 질문의 답은 {@code extras}(키 → 답)에 있다. */
    public record Decision(Answer kind, Answer speaker, Map<String, Answer> extras) {
        public Decision(Answer kind, Answer speaker) {
            this(kind, speaker, Map.of());
        }

        public Answer extra(String key) {
            return extras.get(key);
        }
    }

    /**
     * @param dropped 4단계(첫 나누기) 답에 없던 줄 번호
     * @param characters 첫 조립의 배역 이름
     */
    public static List<Question> questions(List<NumberedLine> lines, Map<Integer, Row> rows, Set<Integer> dropped,
            List<String> characters, Mode mode) {
        List<Question> out = new ArrayList<>();
        int first = -1;
        int last = -1;
        Map<String, Integer> seen = new LinkedHashMap<>();
        int width = width(lines);
        for (int at = 0; at < lines.size(); at++) {
            Row row = rows.get(lines.get(at).no());
            if (row != null && row.kind() == Kind.DIALOGUE) {
                first = first < 0 ? at : first;
                last = at;
            }
            seen.merge(ScriptText.visible(lines.get(at).text()).strip(), 1, Integer::sum);
        }
        for (int at = 0; at < lines.size(); at++) {
            NumberedLine line = lines.get(at);
            Row row = rows.get(line.no());
            Kind kind = row == null ? Kind.DIRECTION : row.kind();
            boolean action = action(line, row);
            boolean excluded = kind == Kind.IGNORE || kind == Kind.TITLE || kind == Kind.CAST;
            Row next = at + 1 < lines.size() ? rows.get(lines.get(at + 1).no()) : null;
            String visible = ScriptText.visible(line.text()).strip();
            // 첫 답이 지문으로 둔 꾸민 끝 표시도 끝 표시 후보다 — 첫 답이 무시로 두면 장면, 지문으로 두면 지문이 됐다(재생 022·053 「- 막 -」, SOMA-663 M8)
            boolean tail = (excluded || kind == Kind.DIRECTION && END_MARK.matcher(visible).matches() && LETTER.matcher(visible).find())
                    && last >= 0 && at > last && at >= lines.size() - EDGE && visible.codePointCount(0, visible.length()) <= TAIL_CHARS;
            // 첫 대사 앞 문서 머리의 등장인물 줄도 묻는다 — 상황 설명을 등장인물 줄로 뺄 수 있다(재생 220). 제목 줄은 묻지 않는다 — 작품 제목·기획의도가
            // 지문으로 되살아났다(재생 034·052·203)
            boolean front = kind == Kind.CAST && at < first && at < EDGE;
            boolean asked = excluded
                    ? (first < at && at < last || tail || front)
                            && LETTER.matcher(line.text()).find() && !nameLine(line, next, characters) && !repeated(line, seen)
                    : (kind == Kind.DIALOGUE || kind == Kind.DIRECTION) && (action || !nameOnly(line, row));
            if (!asked || SplitDraft.pageNumber(line.text())) {
                continue;
            }
            Set<String> reasons = reasons(line, row, dropped, characters);
            if (excluded) {
                reasons.add("excluded");
            }
            if (tail) {
                reasons.add("tail");
            }
            if (front) {
                reasons.add("front");
            }
            // 등장인물 줄이 대사 블록 바로 뒤에 이어지면 그 대사가 이어지는 줄일 수 있다(재생 009 카트린의 독백)
            Row carry = kind == Kind.CAST ? carry(lines, rows, at) : null;
            if (carry != null) {
                reasons.add("carry");
            }
            String squeezed = visible.replaceAll("\\s", "");
            if (kind == Kind.DIRECTION && SEPARATOR.matcher(squeezed).matches()
                    && (squeezed.length() >= 3 || RULE_LINE.matcher(squeezed).find() || seen.get(visible) > 1)) {
                reasons.add("decor");
            }
            // 제목·등장인물 줄이 인용 발화면 대사로 되살릴 근거가 된다(재생 215 예고 속 인용 대화)
            if ((kind == Kind.TITLE || kind == Kind.CAST) && QUOTE.matcher(visible).matches()) {
                reasons.add("quote");
            }
            if (action) {
                reasons.add("action");
            }
            boolean edge = at < EDGE || at >= lines.size() - EDGE;
            if (edge) {
                reasons.add("edge");
            }
            // 머리 없는 대사 줄도 묻는다 — Jev 가 괄호 행동만 보고 대사를 지문으로 내린다(재생 021·053·061)
            Row talk = kind == Kind.DIRECTION || kind == Kind.DIALOGUE && row.header().isBlank() ? talk(lines, rows, at, characters) : null;
            if (talk != null) {
                reasons.add("talk");
            }
            // 머리가 괄호로 시작하면 괄호 화자 표시로 화자를 정한 줄이다(「이름 (행동)」의 머리는 괄호 앞까지다)
            if (talk != null && talk.header().stripLeading().startsWith("(")) {
                reasons.add("mark");
            }
            if (kind == Kind.DIRECTION && !LETTER.matcher(spoken(line.text(), characters)).find()) {
                reasons.add("nospeech");
            }
            if (mode == Mode.SUSPECT && reasons.stream().allMatch(reason -> reason.equals("edge") || reason.equals("nospeech"))) {
                continue;
            }
            List<NumberedLine> window = lines.subList(Math.max(0, at - BEFORE), Math.min(lines.size(), at + AFTER + 1));
            List<Extra> extras = new ArrayList<>();
            if (edge) {
                extras.add(new Extra(EDGE_QUESTION, "▶ 표시가 붙은 「판단할 줄」은 문서 전체 %d줄 중 %s %d번째 줄입니다. 이 줄이 연기할 대본의 내용인지, 대본 앞뒤에 붙은 글인지 고르세요."
                        .formatted(lines.size(), at < EDGE ? "앞에서" : "끝에서", at < EDGE ? at + 1 : lines.size() - at), EDGES));
            } else if (excluded) {
                extras.add(new Extra(NOTE_QUESTION, NOTE_INSTRUCTIONS, NOTES));
            }
            if (talk != null) {
                extras.add(new Extra(TALK_QUESTION, "▶ 표시가 붙은 「판단할 줄」에서 괄호 밖의 글 「%s」이 배역이 소리 내어 하는 말인지, 행동·상황을 적은 서술인지 고르세요."
                        .formatted(clip(PAREN.matcher(talkRest(line.text())).replaceAll(" ").replaceAll("\\s+", " ").strip(), TALK_CHARS)), TALKS));
            }
            // 줄 머리에 배역 이름이 있거나 앞 줄이 대사·화자 이름 줄이면 묻지 않는다 — 「해온 한서린.」은 해온의 말이고(재생 004), 「[은서]」 아래 문자
            // 메시지는 은서의 대사다(재생 215)
            Row previous = at > 0 ? rows.get(lines.get(at - 1).no()) : null;
            if (reasons.contains("nohead") && ownHead(line, row, characters) == null && (previous == null || previous.kind() != Kind.DIALOGUE)
                    && (at == 0 || ownHead(lines.get(at - 1), previous, characters) == null
                            && !TAG_LINE.matcher(NAME_MARKS.matcher(ScriptText.visible(lines.get(at - 1).text())).replaceAll("").strip()).matches())) {
                extras.add(new Extra(MEDIUM_QUESTION, MEDIUM_INSTRUCTIONS, MEDIUMS));
            }
            // 문맥 근거(SOMA-663 C2): 머리 없는 대사 줄이 나누기 답과 다른 화자 머리 아래 있거나 괄호 안에 배역이 나오면 위쪽 화자 머리·장면 배역을,
            // 함께 말하기 머리면 장면 참여자 집합 보기를 함께 보낸다. 그 밖의 줄은 요청이 전과 같다(캐시·회귀 범위를 좁힌다). 제외 줄에 보내면 지문
            // 판정이 흔들렸다(재생 031 「여린이 <솔로곡>」)
            boolean headless = kind == Kind.DIALOGUE && ownHead(line, row, characters) == null;
            Head head = headless ? head(lines, rows, at, characters) : null;
            Set<String> watched = headless ? watched(line.text(), characters) : Set.of();
            int counted = kind == Kind.DIALOGUE ? counted(line.text()) : 0;
            String joined = kind == Kind.DIALOGUE ? joined(line.text(), characters) : null;
            String own = reasons.contains("nohead") ? unlisted(line.text(), characters) : null;
            String together = kind == Kind.DIALOGUE && counted == 0 ? together(line.text()) : null;
            boolean context = head != null && !sameKey(head.speaker(), row.speaker()) || !watched.isEmpty() || counted > 0 || joined != null
                    || together != null || own != null;
            // 위 화자 머리 줄이 바로 앞 줄이고 문서의 줄 너비만큼 차서 문장 끝 부호 없이 끊겼으면 이 줄이 그 말을 잇는다(재생 055 「…저 사람은 」⏎「나한테
            // 와서…」). 너비를 보지 않으면 끝 부호 없는 노래 가사 줄마다 걸렸다(재생 007)
            String headText = head == null ? "" : ScriptText.visible(head.line().text()).strip();
            boolean unfinished = context && head != null && head.line() == lines.get(at - 1) && cut(headText, width);
            if (unfinished) {
                reasons.add("unfinished");
            }
            if (!context) {
                out.add(new Question(line.no(), reasons, state(line, window), speakers(window, rows, characters, null, null, Set.of(), List.of()), row,
                        List.copyOf(extras), talk != null ? talk : carry, null, Set.of()));
                continue;
            }
            Map<String, Integer> scene = scene(lines, rows, at, characters);
            List<String> sets = new ArrayList<>(counted > 0 ? sets(scene, counted, characters) : List.of());
            if (joined != null) {
                sets.add(joined);
            }
            // 사람 수가 없으면 위로 이어진 대사 블록에서 머리로 밝힌 배역 집합과 가까운 장면 배역 두 사람 집합을 보기로 준다 — 고르는 것은 Jev 다
            List<String> block = together != null ? block(lines, rows, at, characters) : List.of();
            if (together != null) {
                if (block.size() > 1) {
                    sets.add(String.join(", ", block));
                }
                sets.addAll(sets(scene, 2, characters).stream().limit(MAX_SETS - 1).toList());
            }
            if (own != null) {
                sets.add(own.strip());
            }
            String above = head == null ? null : head.speaker();
            out.add(new Question(line.no(), reasons, state(line, window) + context(head, unfinished, scene.keySet(), watched, line.text(), counted, joined)
                    + (together == null ? "" : "\n- 줄의 「" + together + "」 표지는 둘 이상이 함께 말한다는 표시일 수 있습니다."
                            + (block.size() > 1 ? " 위로 이어진 대사 블록에서 머리로 밝힌 배역: " + String.join(", ", block) + "." : "")
                            + " 같이/함께 말하는 줄이면 쉼표로 이은 보기 중 함께 말하는 참여자 모두를 포함한 보기를 고르세요.")
                    + (own == null ? "" : "\n- 줄 맨 앞 「" + own.strip() + "」은 원문이 이 줄에 적은 화자 표기일 수 있습니다."),
                    speakers(window, rows, characters, above, label(row.speaker(), characters), scene.keySet(), sets), row, List.copyOf(extras),
                    talk != null ? talk : carry, above, watched, own));
        }
        return out;
    }

    /** 확신한 답으로 바꾼 판정. 바꿀 것이 없으면 {@code null}. */
    public static Row apply(Question question, Decision decision, Settings settings) {
        Row current = question.current();
        Kind was = current == null ? Kind.DIRECTION : current.kind();
        Kind chosen = decision.kind() == null ? was : KIND_OF.getOrDefault(decision.kind().choice(), was);
        boolean excluded = was == Kind.IGNORE || was == Kind.TITLE || was == Kind.CAST;
        if (question.reasons().contains("decor")) {
            return new Row(question.no(), Kind.IGNORE, "", "");
        }
        String named = decision.speaker() == null || NONE.equals(decision.speaker().choice()) ? null : question.speakers().stream()
                .filter(choice -> choice.value().equals(decision.speaker().choice())).map(Choice::label).findFirst().orElse(null);
        // Jev 화자가 위쪽 가장 가까운 화자 머리와 같다 — 머리 없이 이어지는 줄의 근거가 둘이다(재생 009·048·053·077)
        // 위 머리 줄이 줄 너비에서 끊긴 바로 앞 줄이면(unfinished) 근거가 하나 더 있어 대사로 바꾸기 문턱을 쓴다(재생 055)
        boolean headed = named != null && question.head() != null && sameKey(named, question.head())
                && decision.speaker().confidence() >= (question.reasons().contains("unfinished") ? settings.kindThreshold() : settings.blockThreshold());
        // 제외 줄은 확신할 때만 되살리고, 제외 종류끼리는 바꾸지 않으며, 제목·등장인물 줄은 대사로 만들지 않는다(재생 038·156·181 노래 제목).
        // 대사 블록에 이어지는 등장인물 줄만은 블록이 근거라 대사로 되살리고 종류 문턱을 쓴다(재생 009). 줄 머리의 배역 이름이나 인용 발화라는 근거가
        // 있고 Jev 가 화자를 화자 문턱만큼 확신하면 제목·등장인물 줄도 대사로 되살린다 — 첫 종류 답이 판마다 갈린다(재생 215 제목·지문)
        boolean carry = question.reasons().contains("carry");
        boolean voiced = (question.reasons().contains("rule") || question.reasons().contains("quote")) && named != null
                && decision.speaker().confidence() >= settings.speakerThreshold();
        if (excluded && (chosen == Kind.IGNORE || chosen == Kind.TITLE || chosen == Kind.CAST
                || chosen == Kind.DIALOGUE && was != Kind.IGNORE && !carry && !voiced)) {
            chosen = was;
        }
        double threshold = carry && chosen == Kind.DIALOGUE ? settings.kindThreshold()
                : was == Kind.DIALOGUE && chosen != Kind.DIALOGUE || excluded ? settings.dropThreshold() : settings.kindThreshold();
        Kind kind = decision.kind() != null && decision.kind().confidence() >= threshold ? chosen : was;
        // 대사를 내리는 종류 답이 같은 요청의 말 판단(괄호 뒤 글은 말·실제 발화)과 어긋나면 내리지 않는다 — Jev 가 괄호 행동이나 서술 어미만 보고
        // 말을 지문으로 내렸다(재생 007 「(전화가 울린다) 또 오네.」, 054 증언 「…따라나섰습니다.」)
        Answer talk = decision.extra(TALK_QUESTION);
        Answer medium = decision.extra(MEDIUM_QUESTION);
        if (was == Kind.DIALOGUE && kind != Kind.DIALOGUE && (talk != null && "speech".equals(talk.choice())
                || medium != null && "voice".equals(medium.choice()))) {
            kind = was;
        }
        // 끝 대사 뒤의 짧은 제외 줄이 대본 내용이면 끝 표시다 — 막·장 머리처럼 장면 줄로 둔다(재생 022 「- 막 -」)
        Answer edge = decision.extra(EDGE_QUESTION);
        if (question.reasons().contains("tail")) {
            return edge != null && "script".equals(edge.choice()) && edge.confidence() >= settings.edgeThreshold()
                    ? new Row(question.no(), Kind.SCENE, "", "") : null;
        }
        // 각주·해설·메모라는 답, 문서 앞뒤의 안내 글·작품 정보라고 확신한 답이면 제외 줄을 되살리지 않는다(재생 076). 문서 머리의 등장인물 줄은 상황
        // 설명(지문)으로만 되살린다 — 「때」·「곳」 같은 배경 항목 이름이 장면 줄이 됐다(재생 127)
        Answer note = decision.extra(NOTE_QUESTION);
        if (excluded && (note != null && !"script".equals(note.choice())
                || edge != null && EDGE_OF.containsKey(edge.choice()) && edge.confidence() >= settings.edgeThreshold()
                || question.reasons().contains("front") && kind != Kind.DIRECTION)) {
            kind = was;
        }
        // 괄호·화자 이름 밖에 글자가 없는 지문은 말이 없다 — 대사로 바꾸려면 내리기 문턱만큼 확신해야 한다(재생 070·145)
        if (kind == Kind.DIALOGUE && was == Kind.DIRECTION && question.reasons().contains("nospeech")
                && decision.kind().confidence() < settings.dropThreshold()) {
            kind = was;
        }
        // 줄 앞 괄호 행동 뒤의 글이 말이라고 확신하면 대사다 — 지문은 대사로 바꾸고 대사는 내리지 않는다(재생 012·021·053)
        // 괄호 화자 표시(「(NA.) 」) 뒤 글은 원문이 화자를 밝혔으니 말이라는 답에 대사로 바꾸기 문턱을 쓴다(재생 002)
        if (question.talk() != null && talk != null && "speech".equals(talk.choice())
                && talk.confidence() >= (question.reasons().contains("mark") ? settings.kindThreshold() : settings.speechThreshold())) {
            kind = Kind.DIALOGUE;
        }
        // 문서 맨 앞·끝의 안내 글·작품 정보는 대본 줄에서 뺀다 — 대사 줄을 빼는 일은 내리기 문턱을 쓴다
        if (edge != null && EDGE_OF.containsKey(edge.choice()) && !excluded
                && edge.confidence() >= (was == Kind.DIALOGUE ? settings.dropThreshold() : settings.edgeThreshold())) {
            kind = EDGE_OF.get(edge.choice());
        }
        // 이름 뒤가 괄호 행동뿐인 줄은 말이 없다 — Jev 가 대사라고 내리기 문턱만큼 확신할 때만 대사로 둔다(재생 008·173·174)
        if (kind == Kind.DIALOGUE && decision.kind() != null && question.reasons().contains("action")
                && !(chosen == Kind.DIALOGUE && decision.kind().confidence() >= settings.dropThreshold())) {
            kind = Kind.DIRECTION;
        }
        // 종이·문자·화면에 적힌 글이라고 내리기 문턱만큼 확신하면 말이 아니다(재생 186)
        if (kind == Kind.DIALOGUE && medium != null && "writing".equals(medium.choice()) && medium.confidence() >= settings.dropThreshold()) {
            kind = Kind.DIRECTION;
        }
        if (kind != Kind.DIALOGUE) {
            return kind == was ? null : new Row(question.no(), kind, "", "");
        }
        String speaker;
        if (was == Kind.DIALOGUE) {
            // 함께 말하기 화자와 띄어쓰기만 다른 같은 이름은 바꾸지 않는다 — 바꾸면 화자가 줄거나 같은 사람이 갈린다(재생 101·053)
            // 머리 없는 줄의 함께 말하기 화자는 위 화자 머리가 다른 한 사람이고 Jev 가 블록 문턱만큼 그 머리라고 하면 바꾼다 — 「여자 alaikum salaam.」
            // 다음 줄 「알레이쿰 살람」을 「모두」로 잠갔다(재생 047)
            boolean group = GROUP.matcher(current.speaker()).find()
                    && !(headed && current.header().isBlank() && !sameKey(current.speaker(), question.head()));
            boolean keep = group || named != null
                    && CharacterNames.squash(named).equals(CharacterNames.squash(current.speaker()));
            // 괄호 안의 바라보는·부르는 대상을 화자로 고른 답은 나누기 답이 위 화자 머리와 같으면 받지 않는다(재생 020 「(지해, 연수 보며)」)
            keep = keep || named != null && question.watched().contains(named) && question.head() != null && sameKey(current.speaker(), question.head());
            speaker = named != null && !keep && (headed || decision.speaker().confidence() >= settings.speakerThreshold()) ? named : current.speaker();
        } else {
            // 지문을 대사로 바꿀 때는 화자가 있어야 한다 — 종류를 확신했으니 화자 문턱은 보지 않는다. Jev 가 none 이면 줄 머리·앞뒤 블록 화자
            speaker = named != null || question.talk() == null || question.talk().speaker().isBlank() ? named : question.talk().speaker();
        }
        if (speaker == null || was == Kind.DIALOGUE && speaker.equals(current.speaker())) {
            return null;
        }
        // 바꾼 화자는 옛 화자의 이름 머리를 잇지 않는다 — 조립이 그 머리 이름으로 화자를 되돌렸다(재생 126 「아비게일  윌리엄즈가……」의 엘리자베스)
        String header = question.own() != null && speaker.equals(question.own().strip()) ? question.own()
                : was == Kind.DIALOGUE ? (sameKey(SplitDraft.nameOf(current.header()), current.speaker())
                        && !sameKey(SplitDraft.nameOf(current.header()), speaker) ? "" : current.header())
                : question.talk() == null ? "" : question.talk().header();
        return new Row(question.no(), Kind.DIALOGUE, speaker, header);
    }

    /**
     * 줄마다 답을 적용한 뒤, 머리 없는 대사 줄의 Jev 화자 답을 한 발화 범위의 이웃 줄과 함께 본다 — 줄 하나로는 문턱에 못 미친 답의 둘째 근거다
     * (SOMA-663 M8 N7). 더 바꿀 줄을 돌려준다.
     * <ul>
     *   <li>앞 줄이 줄 너비에서 끊겨 이 줄이 그 말을 잇고, 나누기 답이 두 줄을 같은 화자로 봤는데 Jev 가 앞 줄 화자를 바꿨으면, 이 줄도 Jev 가 같은
     *       화자를 골랐을 때 종류 문턱으로 바꾼다 — 한 말이 줄 너비에서 끊긴 조각마다 확신이 오르내려 마지막 조각만 옛 화자로 남았다(재생 049).
     *       그 화자가 두 줄 모두의 위쪽 가장 가까운 화자 머리일 때만 잇는다.
     *   <li>앞뒤 줄이 모두 같은 배역의 이름 머리로 시작하고 앞 줄 말이 끝났으면, 그 사이의 머리 없는 줄은 그 배역이 이어 말한 줄이 아니라 다른 사람의
     *       차례다 — Jev 가 다른 배역을 고르면 종류 문턱으로 바꾼다(재생 064 「⇥무슨.」).
     * </ul>
     * 장면·지문을 넘어 이월하지 않고, 문서 전체의 최근 화자나 확신 평균으로 바꾸지 않는다.
     *
     * @param changed 줄마다 적용한 결과(번호 → 바꾼 줄)
     */
    public static Map<Integer, Row> neighbors(List<NumberedLine> lines, List<Question> questions, Map<Integer, Decision> decisions,
            Map<Integer, Row> changed, List<String> characters, Settings settings) {
        Map<Integer, Question> asked = new LinkedHashMap<>();
        questions.forEach(question -> asked.put(question.no(), question));
        Map<Integer, Row> more = new LinkedHashMap<>();
        int width = width(lines);
        for (int at = 1; at < lines.size(); at++) {
            NumberedLine line = lines.get(at);
            Question question = asked.get(line.no());
            Decision decision = decisions.get(line.no());
            Row current = question == null ? null : question.current();
            if (current == null || current.kind() != Kind.DIALOGUE || !current.header().isBlank() || changed.containsKey(line.no())
                    || decision == null || decision.speaker() == null || decision.speaker().confidence() < settings.kindThreshold()) {
                continue;
            }
            String named = question.speakers().stream().filter(choice -> choice.value().equals(decision.speaker().choice()))
                    .map(Choice::label).findFirst().orElse(null);
            if (named == null || NONE.equals(decision.speaker().choice()) || sameKey(named, current.speaker())) {
                continue;
            }
            NumberedLine above = lines.get(at - 1);
            Question before = asked.get(above.no());
            Row carried = more.containsKey(above.no()) ? more.get(above.no()) : changed.get(above.no());
            // 두 줄 모두 위쪽 가장 가까운 화자 머리로 돌아가는 답만 잇는다 — Jev 가 괄호 속 청자(「(정배) 너는」)나 다른 사람으로 바꾼 오답을 잇지 않는다
            boolean chained = before != null && before.current() != null && before.current().kind() == Kind.DIALOGUE
                    && before.current().speaker().equals(current.speaker()) && carried != null && carried.kind() == Kind.DIALOGUE
                    && carried.speaker().equals(named) && cut(above.text(), width) && question.head() != null && sameKey(named, question.head())
                    && before.head() != null && sameKey(named, before.head());
            NumberedLine prior = written(lines, at, -1);
            NumberedLine next = written(lines, at, 1);
            String priorHead = prior == null ? null : headName(prior.text(), characters);
            String nextHead = next == null ? null : headName(next.text(), characters);
            // 앞뒤 머리는 같은 이름이어야 한다 — 「웹 부 인」과 「웹」은 다른 사람이다(재생 064)
            boolean between = headName(line.text(), characters) == null && priorHead != null && nextHead != null
                    && CharacterNames.sameSpeakerKey(priorHead).equals(CharacterNames.sameSpeakerKey(current.speaker()))
                    && CharacterNames.sameSpeakerKey(nextHead).equals(CharacterNames.sameSpeakerKey(current.speaker())) && !cut(prior.text(), width);
            if (chained || between) {
                more.put(line.no(), new Row(line.no(), Kind.DIALOGUE, named, ""));
            }
        }
        return more;
    }

    /** {@code at} 줄에서 {@code step} 방향으로 가장 가까운 글자 있는 줄. 없으면 {@code null}. */
    private static NumberedLine written(List<NumberedLine> lines, int at, int step) {
        for (int k = at + step; k >= 0 && k < lines.size(); k += step) {
            if (!ScriptText.visible(lines.get(k).text()).isBlank()) {
                return lines.get(k);
            }
        }
        return null;
    }

    /**
     * 줄 앞 괄호 행동 뒤에 글이 이어지는 지문 줄이면 대사로 바꿀 때의 줄(머리·화자). 꼴은 셋이다: 「(행동) 글」, 「이름 (행동) 글」(이름은 배역),
     * 앞 줄에서 열린 괄호가 닫힌 뒤의 글. 머리는 원문 그대로의 이름 부분이고, 화자는 그 이름 → 앞 줄 대사의 화자 → 다음 줄 머리 없는 대사의
     * 화자 순이다(없으면 빈 글).
     */
    private static Row talk(List<NumberedLine> lines, Map<Integer, Row> rows, int at, List<String> characters) {
        NumberedLine line = lines.get(at);
        String raw = line.text();
        String text = ScriptText.visible(raw).strip();
        String header = "";
        String speaker = "";
        java.util.regex.Matcher mark = MARK_HEAD.matcher(raw);
        String marked = mark.find() ? listedName(mark.group(2), characters) : null;
        if (at > 0 && unclosed(lines.get(at - 1).text()) && CARRIED_ACTION.matcher(text).matches()) {
            // 앞 줄에서 열린 괄호가 이 줄에서 닫힌다
        } else if (marked != null) {
            // 괄호 안이 배역 이름뿐이면 화자 표시다 — 「(NA.) 메모리어의 폭발적인 인기에도…」(재생 002)
            if (!LETTER.matcher(raw.substring(mark.end())).find()) {
                return null;
            }
            return new Row(line.no(), Kind.DIALOGUE, marked, mark.group(1));
        } else if (!text.startsWith("(")) {
            int open = raw.indexOf('(');
            String name = open < 0 ? "" : CharacterNames.squash(NAME_MARKS.matcher(ScriptText.visible(raw.substring(0, open))).replaceAll(""));
            speaker = name.isEmpty() ? null : characters.stream().filter(c -> CharacterNames.squash(c).equals(name)).findFirst().orElse(null);
            if (speaker == null) {
                return null;
            }
            header = raw.substring(0, open);
            text = ScriptText.visible(raw.substring(open)).strip();
        }
        if (!(header.isEmpty() && !text.startsWith("(") ? CARRIED_ACTION : LEADING_ACTION).matcher(text).matches()
                || !LETTER.matcher(PAREN.matcher(talkRest(text)).replaceAll(" ")).find()) {
            return null;
        }
        if (speaker.isEmpty()) {
            Row before = at > 0 ? rows.get(lines.get(at - 1).no()) : null;
            Row after = at + 1 < lines.size() ? rows.get(lines.get(at + 1).no()) : null;
            speaker = before != null && before.kind() == Kind.DIALOGUE ? before.speaker()
                    : after != null && after.kind() == Kind.DIALOGUE && after.header().isBlank() ? after.speaker() : "";
        }
        return new Row(line.no(), Kind.DIALOGUE, speaker, header);
    }

    /** 쌍점·마침표·대괄호를 빼면 배역 목록의 이름과 같은 글의 배역 목록 표기. 없으면 {@code null}. */
    private static String listedName(String text, List<String> characters) {
        String name = CharacterNames.squash(text.replaceAll("[.:：\\[\\]]", ""));
        return name.isEmpty() ? null : characters.stream().filter(c -> CharacterNames.squash(c).equals(name)).findFirst().orElse(null);
    }

    /** 앞 줄들(등장인물 줄은 건너뜀)이 화자 있는 대사로 이어지면 그 화자로 대사로 바꿀 때의 줄(머리 없음). 아니면 {@code null}. */
    private static Row carry(List<NumberedLine> lines, Map<Integer, Row> rows, int at) {
        for (int back = at - 1; back >= 0; back--) {
            Row row = rows.get(lines.get(back).no());
            if (row == null || row.kind() != Kind.CAST) {
                return row != null && row.kind() == Kind.DIALOGUE && !row.speaker().isBlank()
                        ? new Row(lines.get(at).no(), Kind.DIALOGUE, row.speaker(), "") : null;
            }
        }
        return null;
    }

    /** 첫 괄호 행동(또는 앞 줄에서 넘어온 괄호의 닫힘)과 끝의 닫히지 않은 괄호를 뺀 글. */
    private static String talkRest(String text) {
        String visible = ScriptText.visible(text).strip();
        int close = visible.indexOf(')');
        String rest = close >= 0 ? visible.substring(close + 1) : visible;
        int open = rest.lastIndexOf('(');
        return open >= 0 && rest.indexOf(')', open) < 0 ? rest.substring(0, open) : rest;
    }

    private static boolean unclosed(String text) {
        return text.lastIndexOf('(') > text.lastIndexOf(')');
    }

    /** 괄호 안과 줄 머리의 배역 이름을 뺀 글(띄어쓰기 없이) — 소리 내어 할 말이 있는지 본다(「원달 ( ) , , , .」, 재생 070). */
    private static String spoken(String text, List<String> characters) {
        String rest = CharacterNames.squash(NAME_MARKS.matcher(PAREN.matcher(ScriptText.visible(text)).replaceAll(" ")).replaceAll(""));
        String head = characters.stream().map(CharacterNames::squash).filter(name -> !name.isEmpty() && rest.startsWith(name))
                .max(java.util.Comparator.comparingInt(String::length)).orElse("");
        return rest.substring(head.length());
    }

    private static boolean nameOnly(NumberedLine line, Row row) {
        if (row == null || row.kind() != Kind.DIALOGUE || row.header().isBlank()) {
            return false;
        }
        String text = ScriptText.visible(line.text()).stripLeading();
        String header = ScriptText.visible(row.header()).stripLeading();
        return text.startsWith(header) && text.substring(header.length()).isBlank();
    }

    /** 대사 줄이 「이름 (행동)」뿐인가. 이름 자리는 그 줄의 화자와 띄어쓰기·대괄호·쌍점만 다를 수 있다. */
    private static boolean action(NumberedLine line, Row row) {
        if (row == null || row.kind() != Kind.DIALOGUE) {
            return false;
        }
        String text = ScriptText.visible(line.text()).strip();
        int open = text.indexOf('(');
        return open > 0 && ACTION.matcher(text.substring(open)).matches()
                && CharacterNames.squash(NAME_MARKS.matcher(text.substring(0, open)).replaceAll("")).equals(CharacterNames.squash(row.speaker()));
    }

    /** 블록 형식의 이름 줄 — 다음 줄이 머리 없는 대사이거나, 글이 배역 이름(함께 말하기면 이름들)뿐이다. */
    private static boolean nameLine(NumberedLine line, Row next, List<String> characters) {
        if (next != null && next.kind() == Kind.DIALOGUE && next.header().isBlank()) {
            return true;
        }
        Set<String> names = new LinkedHashSet<>(characters.stream().map(CharacterNames::squash).toList());
        String text = NAME_MARKS.matcher(ScriptText.visible(line.text())).replaceAll(" ").replaceAll("\\([^()]*\\)", " ");
        List<String> parts = List.of(text.split("[,/·•∙・&+]")).stream().map(CharacterNames::squash).filter(part -> !part.isEmpty()).toList();
        return !parts.isEmpty() && names.containsAll(parts);
    }

    private static boolean repeated(NumberedLine line, Map<String, Integer> seen) {
        String text = ScriptText.visible(line.text()).strip();
        return seen.getOrDefault(text, 0) > 1 && text.codePointCount(0, text.length()) >= REPEAT_MIN_CHARS;
    }

    private static Set<String> reasons(NumberedLine line, Row row, Set<Integer> dropped, List<String> characters) {
        Set<String> reasons = new LinkedHashSet<>();
        if (dropped.contains(line.no())) {
            reasons.add("dropped");
        }
        if (row == null) {
            reasons.add("unanswered");
        } else if (row.kind() == Kind.DIALOGUE && row.header().isBlank()
                && !CharacterNames.squash(ScriptText.visible(line.text())).startsWith(CharacterNames.squash(row.speaker()))) {
            reasons.add("nohead");
        }
        String head = headName(line.text(), characters);
        if (head != null && (row == null || row.kind() != Kind.DIALOGUE
                || !CharacterNames.sameSpeakerKey(row.speaker()).equals(CharacterNames.sameSpeakerKey(head)))) {
            reasons.add("rule");
        }
        return reasons;
    }

    /** 줄이 배역 이름 + 구분(쌍점·탭·두 칸 이상 공백·괄호 닫기)으로 시작하면 그 이름. 긴 이름 먼저 본다. */
    private static String headName(String text, List<String> characters) {
        String stripped = ScriptText.visible(text).strip();
        String best = null;
        for (String name : characters) {
            int start = stripped.startsWith("[") || stripped.startsWith("(") ? 1 : 0;
            if (name.isBlank() || !stripped.startsWith(name, start) || best != null && best.length() >= name.length()) {
                continue;
            }
            String rest = stripped.substring(start + name.length());
            if (rest.matches("(?s)(\\s*[:：\\]\\)]|\\t|\\u3000|\\s{2,}).*\\S.*")) {
                best = name;
            }
        }
        return best;
    }

    private record Head(NumberedLine line, String speaker) {
    }

    /**
     * 줄이 스스로 밝힌 화자 — 배역 이름(여럿이면 「이화, 요한」)만 있는 줄(블록 형식의 이름 줄), 배역 이름 + 구분으로 시작하는 줄, 대사 화자 이름
     * (모델 이름이나 배역 목록 표기)으로 시작하거나 괄호 밖 글자가 있는 머리를 단 대사 줄. 이름은 배역 목록 표기다. 없으면 {@code null}.
     */
    private static String ownHead(NumberedLine line, Row row, List<String> characters) {
        String text = ScriptText.visible(line.text()).strip();
        String bare = NAME_MARKS.matcher(PAREN.matcher(text).replaceAll(" ")).replaceAll("").strip();
        String listed = characters.stream().filter(name -> !bare.isBlank() && CharacterNames.squash(name).equals(CharacterNames.squash(bare)))
                .findFirst().orElse(null);
        String named = listed != null ? listed : group(bare, characters);
        if (named != null || row == null || row.kind() != Kind.DIALOGUE) {
            return named;
        }
        String said = headName(line.text(), characters);
        if (said != null || counted(line.text()) > 0) {
            return said != null ? said : tag(line.text());
        }
        String listedName = label(row.speaker(), characters);
        String squashed = CharacterNames.squash(text);
        boolean headed = !row.speaker().isBlank() && (squashed.startsWith(CharacterNames.squash(row.speaker()))
                || squashed.startsWith(CharacterNames.squash(listedName)))
                || LETTER.matcher(PAREN.matcher(ScriptText.visible(row.header())).replaceAll("")).find();
        return headed ? listedName : null;
    }

    /**
     * 판단할 줄 위로 가장 가까운 화자 머리. 장면 표제와 이름표 같은 짧은 줄(원문의 화자 표시 「All」)을 넘지 않고 {@link #BLOCK_LINES} 줄까지 본다.
     * 그 사이 머리 없는 대사 줄은 나누기 답이 머리 화자이거나 판단할 줄의 화자여야 하고, 판단할 줄의 화자가 있으면 머리 화자도 있어야 한다 — 나누기
     * 답이 머리 뒤에서 머리 화자로 이어 가다 머리 없이 바뀐 줄만 근거로 삼는다(재생 007 노래 가사·070 다른 화자 사이).
     */
    private static Head head(List<NumberedLine> lines, Map<Integer, Row> rows, int at, List<String> characters) {
        String current = label(rows.get(lines.get(at).no()).speaker(), characters);
        Set<String> between = new LinkedHashSet<>();
        for (int k = at - 1; k >= Math.max(0, at - BLOCK_LINES); k--) {
            Row row = rows.get(lines.get(k).no());
            if (row != null && row.kind() == Kind.SCENE) {
                return null;
            }
            String speaker = ownHead(lines.get(k), row, characters);
            if (speaker != null) {
                boolean drifted = between.stream().anyMatch(name -> sameKey(name, current));
                boolean continued = between.stream().anyMatch(name -> sameKey(name, speaker));
                return between.stream().allMatch(name -> sameKey(name, speaker) || sameKey(name, current)) && (!drifted || continued)
                        ? new Head(lines.get(k), speaker) : null;
            }
            if (row != null && row.kind() == Kind.DIALOGUE) {
                between.add(label(row.speaker(), characters));
            } else if (TAG_LINE.matcher(ScriptText.visible(lines.get(k).text()).strip()).matches()) {
                return null;
            }
        }
        return null;
    }

    /** 장면(앞뒤 장면 표제 사이, 각 {@link #SCENE_LINES} 줄까지)에서 스스로 화자를 밝힌 배역 → 판단할 줄과 가장 가까운 거리. */
    private static Map<String, Integer> scene(List<NumberedLine> lines, Map<Integer, Row> rows, int at, List<String> characters) {
        Map<String, Integer> near = new LinkedHashMap<>();
        for (int step = -1; step <= 1; step += 2) {
            for (int k = at + step; k >= 0 && k < lines.size() && Math.abs(k - at) <= SCENE_LINES; k += step) {
                Row row = rows.get(lines.get(k).no());
                if (row != null && row.kind() == Kind.SCENE) {
                    break;
                }
                String speaker = ownHead(lines.get(k), row, characters);
                if (speaker != null) {
                    near.merge(speaker, Math.abs(k - at), Math::min);
                }
            }
        }
        return near;
    }

    /** 괄호 안(「(지해, 연수 보며)」)에 나온 배역. 괄호가 이름뿐이면(「(지해)」) 화자 표시라 뺀다. */
    private static Set<String> watched(String text, List<String> characters) {
        Set<String> names = new LinkedHashSet<>();
        java.util.regex.Matcher paren = PAREN.matcher(ScriptText.visible(text));
        while (paren.find()) {
            String inside = CharacterNames.squash(paren.group().substring(1, paren.group().length() - 1));
            if (characters.stream().noneMatch(name -> CharacterNames.squash(name).equals(inside))) {
                characters.stream().filter(name -> CharacterNames.squash(name).length() >= 2 && inside.contains(CharacterNames.squash(name)))
                        .forEach(names::add);
            }
        }
        return names;
    }

    /** 줄 머리(이름표 모양)가 사람 수로 적은 함께 말하기 머리(「셋」·「둘다」·「세 여자」)면 그 수, 아니면 0. 「네 알겠어요」의 「네」는 머리가 아니다. */
    private static int counted(String text) {
        java.util.regex.Matcher counted = COUNTED.matcher(tag(text));
        return counted.matches() ? COUNTS.get(counted.group(1) != null ? counted.group(1) : counted.group(2)) : 0;
    }

    /**
     * 판단할 줄 위로 대사(사이의 무시 줄 포함)가 이어지는 블록에서 스스로 화자를 밝힌 한 사람 배역 — 배역 목록 순서. 장면 표제·지문에서 멈추고
     * {@link #BLOCK_LINES} 줄까지 본다.
     */
    private static List<String> block(List<NumberedLine> lines, Map<Integer, Row> rows, int at, List<String> characters) {
        Set<String> found = new LinkedHashSet<>();
        for (int k = at - 1; k >= Math.max(0, at - BLOCK_LINES); k--) {
            Row row = rows.get(lines.get(k).no());
            if (row == null || row.kind() != Kind.DIALOGUE && row.kind() != Kind.IGNORE) {
                break;
            }
            String speaker = ownHead(lines.get(k), row, characters);
            if (speaker != null && !GROUP.matcher(speaker).find() && characters.contains(speaker)) {
                found.add(speaker);
            }
        }
        return characters.stream().filter(found::contains).toList();
    }

    /** 줄 맨 앞 낱말이 괄호 행동 앞의 이름표 모양이고 배역 목록에 없으면 그 머리(뒤 공백 포함). 아니면 {@code null}. */
    private static String unlisted(String text, List<String> characters) {
        java.util.regex.Matcher found = OWN_HEAD.matcher(text);
        if (!found.find()) {
            return null;
        }
        String name = found.group(2);
        boolean listed = characters.stream().anyMatch(c -> CharacterNames.squash(c).equals(CharacterNames.squash(name))
                || CharacterNames.sameSpeakerKey(c).equals(CharacterNames.sameSpeakerKey(name)));
        return listed ? null : found.group(1);
    }

    /** 줄 앞 괄호(「(같이)」)나 이름표 모양 머리(「함께 :」)가 사람 수 없는 함께 말하기 표지면 그 표지, 아니면 {@code null}. */
    private static String together(String text) {
        java.util.regex.Matcher paren = TOGETHER.matcher(ScriptText.visible(text));
        if (paren.find()) {
            return paren.group().strip();
        }
        return TOGETHER_TAG.matcher(tag(text)).matches() ? tag(text) : null;
    }

    /** 이름표 모양으로 끝나는 줄 머리(「셋        」→「셋」, 「[셋]」→「셋」). 없으면 빈 글. */
    private static String tag(String text) {
        String visible = ScriptText.visible(text).strip();
        visible = visible.startsWith("[") ? visible.substring(1) : visible;
        java.util.regex.Matcher end = LABEL_END.matcher(visible);
        return end.find() ? visible.substring(0, end.start()).strip() : "";
    }

    /** 줄 첫 낱말이 배역 이름 여럿을 이은 머리(「돈결,승욱」)면 그 집합(「돈결, 승욱」), 아니면 {@code null}. */
    private static String joined(String text, List<String> characters) {
        return group(firstWord(text), characters);
    }

    /** 글 전체가 배역 이름 여럿을 이은 것(「이화, 요한」)이면 그 집합(배역 목록 표기를 「, 」로 이음), 아니면 {@code null}. */
    private static String group(String text, List<String> characters) {
        List<String> parts = List.of(NAME_SPLIT.split(text)).stream().map(CharacterNames::squash).filter(part -> !part.isEmpty()).toList();
        List<String> names = parts.stream().map(part -> characters.stream().filter(name -> CharacterNames.squash(name).equals(part)).findFirst()
                .orElse(null)).toList();
        return parts.size() > 1 && !names.contains(null) ? String.join(", ", names) : null;
    }

    private static String firstWord(String text) {
        return NAME_MARKS.matcher(ScriptText.visible(text).strip()).replaceAll(" ").strip().split("\\s", 2)[0];
    }

    /** 장면에서 가까운 한 사람 배역 {@link #SET_PEOPLE}명으로 만든 {@code size}명 집합, 가까운 사람들 먼저 {@link #MAX_SETS}개. */
    private static List<String> sets(Map<String, Integer> scene, int size, List<String> characters) {
        List<String> people = scene.entrySet().stream().filter(entry -> !GROUP.matcher(entry.getKey()).find() && counted(entry.getKey()) == 0)
                .sorted(Map.Entry.comparingByValue()).map(Map.Entry::getKey).limit(SET_PEOPLE).toList();
        List<List<String>> sets = new ArrayList<>();
        combine(people, size, 0, new ArrayList<>(), sets);
        return sets.stream().limit(MAX_SETS).map(set -> String.join(", ", set.stream()
                .sorted(java.util.Comparator.comparingInt(characters::indexOf)).toList())).toList();
    }

    /** 앞 사람(가까운 사람)을 먼저 넣는 조합 순서. */
    private static void combine(List<String> people, int size, int from, List<String> chosen, List<List<String>> out) {
        if (chosen.size() == size) {
            out.add(List.copyOf(chosen));
            return;
        }
        for (int k = from; k < people.size(); k++) {
            chosen.add(people.get(k));
            combine(people, size, k + 1, chosen, out);
            chosen.removeLast();
        }
    }

    /** 문맥 근거 — 기존 창 뒤에 붙인다. */
    private static String context(Head head, boolean unfinished, Set<String> scene, Set<String> watched, String text, int counted, String joined) {
        StringBuilder out = new StringBuilder("\n\n문맥 근거:");
        if (head != null) {
            out.append("\n- 위로 가장 가까운 화자 머리: L").append(head.line().no()).append(": ").append(clip(head.line().text(), 60))
                    .append(" → ").append(head.speaker()).append(". 그 줄부터 ▶ 줄까지 다른 화자 이름으로 시작하는 줄이 없습니다.");
        }
        if (unfinished) {
            out.append("\n- 그 머리 줄은 ▶ 줄 바로 앞 줄이고, 문서의 줄 너비만큼 차서 문장 끝 부호 없이 끊겼습니다(「").append(tail(head.line().text()))
                    .append("」). ▶ 줄이 그 끊긴 말을 이어 끝맺는 줄인지 보세요.");
        }
        if (!scene.isEmpty()) {
            out.append("\n- 이 장면에서 말한 배역: ").append(String.join(", ", scene));
        }
        if (!watched.isEmpty()) {
            out.append("\n- 괄호 안의 이름(").append(String.join(", ", watched))
                    .append(")은 말하는 사람이 바라보거나 말을 거는 대상일 수 있습니다. 말하는 사람과 구분하세요.");
        }
        if (counted > 0) {
            out.append("\n- 줄 머리 「").append(tag(text)).append("」은 함께 말하는 ").append(counted)
                    .append("명입니다. 쉼표로 이은 보기 중 이 장면에서 함께 말하는 사람들을 고르세요.");
        }
        if (joined != null) {
            out.append("\n- 줄 머리 「").append(firstWord(text)).append("」은 ").append(joined).append("이 함께 말한다는 표시일 수 있습니다.");
        }
        return out.toString();
    }

    /**
     * 모델 이름(「강은서」)을 배역 목록 표기(「은서」)로 — 같은 사람 키, 그다음 한쪽이 다른 쪽을 품는 이름. 함께 말하는 화자(「미나네, 순이네」)는
     * 품는 이름으로 줄이지 않는다. 없으면 그대로.
     */
    private static String label(String speaker, List<String> characters) {
        String key = CharacterNames.sameSpeakerKey(speaker);
        String squashed = CharacterNames.squash(speaker);
        boolean group = NAME_SPLIT.matcher(speaker).find();
        return characters.stream().filter(name -> CharacterNames.sameSpeakerKey(name).equals(key)).findFirst()
                .or(() -> characters.stream().filter(name -> !group && !NAME_SPLIT.matcher(name).find() && !CharacterNames.squash(name).isEmpty()
                        && (squashed.contains(CharacterNames.squash(name)) || CharacterNames.squash(name).contains(squashed))).findFirst())
                .orElse(speaker);
    }

    private static boolean sameKey(String a, String b) {
        return label(a, List.of(b)).equals(b);
    }

    /** 같은 사람들의 집합인가(순서·구분 부호 무시). */
    private static boolean sameSet(String a, String b) {
        Set<String> left = new java.util.TreeSet<>(Stream.of(NAME_SPLIT.split(a)).map(CharacterNames::squash).toList());
        Set<String> right = new java.util.TreeSet<>(Stream.of(NAME_SPLIT.split(b)).map(CharacterNames::squash).toList());
        return left.size() > 1 && left.equals(right);
    }

    private static String state(NumberedLine line, List<NumberedLine> window) {
        StringBuilder out = new StringBuilder("판단할 줄:\nL").append(line.no()).append(": ").append(clip(line.text()))
                .append("\n\n앞뒤 줄(▶가 판단할 줄):");
        for (NumberedLine other : window) {
            out.append('\n').append(other.no() == line.no() ? "▶ " : "  ").append('L').append(other.no()).append(": ").append(clip(other.text()));
        }
        return out.toString();
    }

    private static String clip(String text) {
        return clip(text, MAX_CHARS);
    }

    /** 줄이 문서의 줄 너비만큼 차서 문장 끝 부호 없이 끊겼는가 — 다음 줄이 그 말을 잇는다. */
    static boolean cut(String text, int width) {
        String visible = ScriptText.visible(text).strip();
        return !ENDED.matcher(visible).find() && visible.codePointCount(0, visible.length()) * 10 >= width * 9;
    }

    /** 문서의 줄 너비 — 빈 줄을 뺀 줄 글자 수의 90번째 백분위. 이만큼 찬 줄은 PDF·문서 폭에서 끊긴 줄일 수 있다. */
    static int width(List<NumberedLine> lines) {
        int[] lengths = lines.stream().map(line -> ScriptText.visible(line.text()).strip())
                .mapToInt(text -> text.codePointCount(0, text.length())).sorted().toArray();
        return lengths.length == 0 ? 0 : lengths[lengths.length * 9 / 10];
    }

    /** 줄 끝 12자(앞을 줄였으면 「…」로 시작). */
    private static String tail(String text) {
        String stripped = ScriptText.visible(text).strip();
        int count = stripped.codePointCount(0, stripped.length());
        return count <= 12 ? stripped : "…" + stripped.substring(stripped.offsetByCodePoints(0, count - 12));
    }

    private static String clip(String text, int max) {
        String stripped = text.strip();
        return stripped.codePointCount(0, stripped.length()) <= max ? stripped : stripped.substring(0, stripped.offsetByCodePoints(0, max)) + "…";
    }

    /**
     * 배역 보기 8명까지 — 창에 이름이 보이는 배역과 위쪽 화자 머리({@code above})·나누기 답 화자({@code current}), 그다음 장면에서 말한 배역
     * ({@code scene}, 드문 실제 화자가 잘리지 않게), 그다음 나머지 배역(각각 배역 목록 순서). 그 뒤에 배역 목록에 없는 {@code above}, 창의 화자 머리
     * 3개까지, 함께 말하는 집합 보기({@code sets}), 끝에 none.
     */
    private static List<Choice> speakers(List<NumberedLine> window, Map<Integer, Row> rows, List<String> characters, String above, String current,
            Set<String> scene, List<String> sets) {
        String text = CharacterNames.squash(ScriptText.visible(String.join("\n", window.stream().map(NumberedLine::text).toList())));
        List<String> names = new ArrayList<>(characters.stream()
                .filter(name -> text.contains(CharacterNames.squash(name)) || name.equals(above) || name.equals(current)).toList());
        characters.stream().filter(name -> !names.contains(name) && scene.contains(name)).forEach(names::add);
        characters.stream().filter(name -> !names.contains(name)).forEach(names::add);
        List<String> options = new ArrayList<>(names.subList(0, Math.min(MAX_SPEAKERS, names.size())));
        if (above != null && !characters.contains(above)) {
            options.add(above);
        }
        Set<String> keys = new LinkedHashSet<>(characters.stream().map(CharacterNames::sameSpeakerKey).toList());
        Map<String, String> heads = new LinkedHashMap<>();
        for (NumberedLine line : window) {
            Row row = rows.get(line.no());
            if (row != null && row.kind() == Kind.DIALOGUE && !row.header().isBlank()) {
                String head = ScriptText.visible(row.header()).strip().replaceAll("^[\\[(]|[\\s:：.,，、\\-—\\])]+$", "").strip();
                // 배역 이름의 일부·확장(「복례」↔「박복례」)이나 괄호가 남은 머리를 보기로 주면 같은 사람이 갈린다(재생 169·171·055)
                String squashed = CharacterNames.squash(head);
                boolean known = keys.contains(CharacterNames.sameSpeakerKey(head)) || characters.stream().map(CharacterNames::squash)
                        .anyMatch(name -> name.contains(squashed) || squashed.contains(name));
                if (head.codePoints().anyMatch(Character::isLetter) && !known && !head.matches(".*[()\\[\\]].*")) {
                    heads.putIfAbsent(CharacterNames.sameSpeakerKey(head), head);
                }
            }
        }
        heads.values().stream().filter(name -> !options.contains(name)).limit(MAX_HEADS).forEach(options::add);
        sets.stream().filter(set -> options.stream().noneMatch(option -> sameSet(option, set))).forEach(options::add);
        List<Choice> choices = new ArrayList<>();
        for (int k = 0; k < options.size(); k++) {
            choices.add(new Choice("c%02d".formatted(k + 1), options.get(k), options.get(k)));
        }
        choices.add(new Choice(NONE, NONE, "대사가 아니거나 보기에 맞는 배역이 없음"));
        return choices;
    }
}
