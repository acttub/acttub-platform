package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import com.acttub.actingapi.feature.reading.domain.SplitResponse.Kind;
import com.acttub.actingapi.feature.reading.domain.SplitResponse.Row;

/**
 * 모델의 줄 판정을 저장 요청의 모양({@link ScriptDraft})으로 조립한다 (SOMA-593 7-2 8·9번).
 *
 * <ul>
 *   <li>대사 글은 원문에서 머리만 뗀 것이다 — 글자를 모델이 쓰지 않는다.</li>
 *   <li>블록 형식(이름 한 줄 뒤 대사 줄들)은 같은 배역의 이어지는 줄에 머리가 없으면 한 대사로 합친다. 이을 때 단어 중간에서
 *       끊긴 자리는 붙인다({@link LineJoin}).</li>
 *   <li>판정이 없는 줄은 지문이다. 다만 지문(판정 없음 포함)이 배역 이름 + 탭·U+3000·공백 세 칸 이상으로 시작하고 뒤가 괄호
 *       지문뿐이 아니면 그 배역의 대사다. 제목·등장인물·무시 줄은 대본 줄에 넣지 않는다. 「- 27 -」만 있는 쪽 번호 줄은 모델이 뭐라
 *       하든 무시 줄이다.</li>
 *   <li>배역 이름: 원문에 없는 이름은 그 줄 머리의 표기로, 머리가 이름이 아니면 원문에 있는 다른 배역 이름으로 바로잡고
 *       ({@link #sourceName}), 배역 목록 표기로 맞춘 뒤({@link CharacterNames#fix}), 같은 사람의 다른 표기를 묶는다({@link #mergeSameSpeakers}).</li>
 *   <li>배역 순서는 등장인물 소개 줄에 나온 순, 거기 없는 배역은 대사 많은 순(같으면 먼저 말한 순)이다.</li>
 *   <li>제목은 요청의 제목, 없으면 모델이 제목이라 한 첫 줄, 그것도 없으면 첫 줄이다(200자까지).</li>
 * </ul>
 */
public final class SplitDraft {

    private static final int TITLE_MAX = 200;
    /**
     * 이름 머리 뒤의 화면 밖 목소리·내레이션 표시 — 「민성(소리)」·「(NA)」, 한글·숫자로 끝나는 이름에 붙은 「김지훈NA」·「엄마E」·「여주VO」·「배우1 NA」(SOMA-663 M7, 재생 065). 머리에
     * 같이 뗀다. 괄호 없는 「소리」는 보지 않는다 — 「민성 소리 지르지 마」는 대사다.
     */
    private static final Pattern VOICE_MARK = Pattern.compile("(?iu)\\((?:n\\.?(?:a\\.?)?|e|v\\.?o\\.?|o\\.?s\\.?|f|off|목?소리만?|음성|전화|내레이션|나레이션)\\)");
    private static final Pattern VOICE_TAIL = Pattern.compile("(?i)(?<=[\\p{IsHangul}\\d])\\s*(?:n\\.?a\\.?|e|v\\.?o\\.?|o\\.?s\\.?)$");
    /** 「자일즈의 음성」·「엄마 목소리」·「윤성구/음성」 꼴의 화면 밖 목소리 머리. */
    private static final Pattern VOICE_OF = Pattern.compile("(.*[^\\s/])\\s*(?:/\\s*|의\\s*)?(?:음성|목소리)");
    /** 이름에 없는 글자 — 이것이 든 머리는 이름을 넘어 대사·괄호 행동까지 먹은 것이다. */
    private static final Pattern NOT_NAME = Pattern.compile("[?!,，…\"“”'‘’「」『』()\\[\\]~]|\\.\\s");
    /** 함께 말하기 화자 — {@link LineReview} 와 같은 모양. */
    private static final Pattern GROUP = Pattern.compile("[,/·•∙・&]|모두|다\\s*같이|둘\\s*다|전원|일동|합창|코러스");
    private static final Pattern GROUP_HEAD = Pattern.compile("모두|다같이|같이|함께|둘다|셋다|전원|일동|합창|코러스");
    private static final Pattern NOTED = Pattern.compile("(.*\\S)\\s*(\\([^()]{1,6}\\))");
    /** 머리 이름으로 보는 최대 글자 수. */
    private static final int HEAD_MAX = 20;
    /** 머리 끝의 센 구분 부호 — 탭·U+3000·쌍점·쌍반점·공백 두 칸 이상. 공백 한 칸은 이름이 대사 낱말을 먹은 머리(「선생 요즘 」)와 가르지 못한다. */
    private static final Pattern STRONG_END = Pattern.compile("(?:[\\t\\u3000:：;]|\\s{2})[\\s\\p{Z}]*$");
    /** 쌍점과 그 뒤 마크다운 굵게 닫힘(「**민우:** 」, 재생 209)·공백까지, 그 뒤에 글자가 더 있는 머리. */
    private static final Pattern PAST_COLON = Pattern.compile("([^:：]*[:：][*_]*+[\\s\\p{Z}]*+)\\S");
    /** 화면 밖 목소리 머리 — 모델이 주인 배역을 고른 줄은 머리로 바꾸지 않는다. */
    private static final Pattern VOICE = Pattern.compile("(?iu)목소리|소리|음성|녹음|전화|V\\.?O\\.?|O\\.S\\.?");
    /** 이름 끝 괄호의 화면 밖 목소리 꼬리표 — 이름에서 떼어 그 대사 앞 지문으로 둔다(SOMA-709). 내레이션(NA)은 다른 배역이라 보지 않는다. */
    private static final Pattern VOICE_TAG = Pattern.compile("(?iu)\\s*(\\(\\s*(?:목?소리만?|음성|전화|v\\.?o\\.?|o\\.?s\\.?|off)\\s*\\))$");
    /** 여럿이 함께 하는 머리의 구분 부호. */
    private static final Pattern MULTIPLE = Pattern.compile("[/,，&·•∙・、]");
    /** PDF·txt 의 쪽 번호 줄. 2026-10-13 105편에서 모델이 1,002줄 중 41줄을 대사·지문이라 해 대사 안에 「- 27 -」이 남았다. */
    private static final Pattern PAGE_NUMBER = Pattern.compile("[-–—]\\s*\\d{1,4}\\s*[-–—]");

    /**
     * 원문 줄 하나가 조립에서 간 자리 — 최종 종류, 모델 판정(없으면 null), 뗀 머리, 본문, 들어간 대본 줄 번호(1부터, 안 들었으면 null).
     * 실험 재생 하네스(SOMA-663)가 정답 지점을 원문 줄 번호로 채점하려고 받는다. 운영은 쓰지 않는다.
     */
    public record Origin(int no, String kind, String modelKind, String modelSpeaker, String header, String body, Integer outputLine) {
    }

    /** 이 스레드의 조립마다 원문 줄 연결을 받을 곳. 재생 하네스만 넣는다 — 비어 있으면(운영) 아무것도 하지 않는다. */
    public static final ThreadLocal<Consumer<List<Origin>>> TRACE = new ThreadLocal<>();

    private SplitDraft() {
    }

    static boolean pageNumber(String text) {
        return PAGE_NUMBER.matcher(ScriptText.visible(text).strip()).matches();
    }

    /** 성별·나이대 없이 — 모두 모름. */
    public static ScriptDraft assemble(String title, String rawText, String source, List<NumberedLine> lines,
            Map<Integer, Row> rows, List<String> roster) {
        return assemble(title, rawText, source, lines, rows, roster, Map.of());
    }

    /**
     * @param roster 배역 목록 호출이 준 이름들. 비어 있으면 이름을 바로잡지 않는다
     * @param traits 모델이 준 배역의 성별·나이대(SOMA-670). 이름 → 값. 배역 이름과 그대로, 띄어쓰기만 달라도, 배역 이름 바로잡기와
     *        같은 규칙으로 맞으면 잇고 아니면 모름이다
     */
    public static ScriptDraft assemble(String title, String rawText, String source, List<NumberedLine> lines,
            Map<Integer, Row> rows, List<String> roster, Map<String, CharacterTraits> traits) {
        return assembleWithSpeakers(title, rawText, source, lines, rows, roster, traits).draft();
    }

    /**
     * 조립한 대본과, 대사가 된 원문 줄 번호 → 조립이 정한 화자 이름(머리 이름 앞세우기·묶기를 거친 뒤).
     *
     * @param heads 대사가 된 원문 줄 번호 → 그 줄에서 뗀 원문 머리, 머리가 없으면 바로 위 블록 형식의 이름 줄. 둘 다 없는 줄은 없다
     */
    public record Assembly(ScriptDraft draft, Map<Integer, String> speakers, Map<Integer, String> heads) {

        /**
         * 두 번째 의견이 바꾼 대사 줄 중 화자가 배역이 아닌 모델 이름인 줄(Jev 화자가 없어 앞뒤 줄 화자로 되살린 줄)을, 조립이 그 모델 이름을
         * 두 줄 이상에서 늘 한 배역으로 바꿨으면 그 배역으로 (SOMA-663 M7). 재생 012 에서 앞 줄 모델 이름 「죄인 구십구 번」이 되살아나 조립
         * 이름 「구십구」와 한 사람이 갈렸다.
         *
         * @param rows 바꾸기 전 줄 판정
         */
        public Map<Integer, Row> assembledNames(Map<Integer, Row> changed, Map<Integer, Row> rows) {
            Map<String, Set<String>> assembledAs = new HashMap<>();
            Map<String, Integer> uses = new HashMap<>();
            speakers.forEach((no, name) -> {
                Row row = rows.get(no);
                if (row != null && row.kind() == Kind.DIALOGUE) {
                    assembledAs.computeIfAbsent(row.speaker(), key -> new HashSet<>()).add(name);
                    uses.merge(row.speaker(), 1, Integer::sum);
                }
            });
            Map<Integer, Row> named = new HashMap<>(changed);
            named.replaceAll((no, row) -> {
                Set<String> as = assembledAs.get(row.speaker());
                return row.kind() == Kind.DIALOGUE && !draft.characterNames().contains(row.speaker()) && as != null && as.size() == 1
                        && uses.get(row.speaker()) >= 2 ? new Row(no, Kind.DIALOGUE, as.iterator().next(), row.header()) : row;
            });
            return named;
        }
    }

    public static Assembly assembleWithSpeakers(String title, String rawText, String source, List<NumberedLine> lines,
            Map<Integer, Row> rows, List<String> roster, Map<String, CharacterTraits> traits) {
        return assembleWithSpeakers(title, rawText, source, lines, rows, roster, traits, null);
    }

    /** 파일명은 제목을 찾지 못했을 때만 쓴다. 요청 제목과 본문의 제목을 덮어쓰지 않는다. */
    public static Assembly assembleWithSpeakers(String title, String rawText, String source, List<NumberedLine> lines,
            Map<Integer, Row> rows, List<String> roster, Map<String, CharacterTraits> traits, String fileName) {
        List<Assembled> assembled = new ArrayList<>();
        List<String> castLines = new ArrayList<>();
        String modelTitle = null;
        LineJoin join = LineJoin.of(lines);
        List<String> known = known(rows, roster);
        String sourceText = CharacterNames.squash(ScriptText.visible(String.join("\n", lines.stream().map(NumberedLine::text).toList())));
        List<String> spoken = known.stream().filter(name -> sourceText.contains(CharacterNames.squash(name))).toList();
        Heads heads = new Heads(lines, rows, known, sourceText);
        Set<String> headers = headers(lines, rows, heads);
        Map<String, Integer> headerUses = headerUses(lines, rows, heads);
        String listed = CharacterNames.squash(String.join("\n", roster)) + "\n" + CharacterNames.squash(String.join("\n", lines.stream()
                .filter(line -> rows.get(line.no()) != null && rows.get(line.no()).kind() == Kind.CAST).map(NumberedLine::text).toList()));
        Map<String, Map<String, Integer>> shortened = new HashMap<>();
        Map<String, Integer> selfHeaded = new HashMap<>();
        Map<String, String> untagged = new HashMap<>();
        record Traced(NumberedLine line, Row model, Kind kind, String header, String body, Assembled into) {
        }
        List<Traced> traced = new ArrayList<>();
        String[] carried = null;
        int width = LineReview.width(lines);
        for (NumberedLine line : lines) {
            Row model = rows.get(line.no());
            Row row = rows.get(line.no());
            Kind kind = pageNumber(line.text()) ? Kind.IGNORE
                    : row == null ? Kind.DIRECTION : row.kind();
            if (kind == Kind.DIRECTION) {
                Row named = speechOf(line, known);
                if (named != null) {
                    row = named;
                    kind = Kind.DIALOGUE;
                }
            }
            // 머리는 대사에서만 뗀다 — 장면 머리의 "S#1." 처럼 대사가 아닌 줄의 앞부분은 그 줄의 일부다.
            String header = kind == Kind.DIALOGUE ? headerOf(line.text(), row, heads) : "";
            // 괄호 행동 뒤에 화자 이름표가 적힌 줄(「(어머니, 소리 지른다) 딸 그만해」)은 행동을 지문으로 떼고 이름표 뒤만 대사다(재생 213·120)
            int[] inner = kind == Kind.DIALOGUE && header.isEmpty() ? innerHead(line.text(), row.speaker()) : null;
            String shown = ScriptText.visible(line.text()).stripLeading();
            if (inner != null) {
                header = shown.substring(inner[0], inner[1]);
            }
            // 제 머리를 단 대사 바로 뒤에서 같은 화자로 판정된 머리 없는 줄이 다른 배역의 이름표로 시작하면 그 배역의 새 대사다 — 앞 대사에
            // 붙이지 않는다(2026-10-27 운영 뮤지컬 대본(SOMA-903): 「지수 네?」 뒤 「구두쇠 내 동전 밟았어요!」 꼴의 줄이 지수 대사 하나가 됐다).
            Traced previous = traced.isEmpty() ? null : traced.getLast();
            if (kind == Kind.DIALOGUE && header.isEmpty() && inner == null && previous != null && previous.kind() == Kind.DIALOGUE
                    && !previous.header().isBlank() && previous.into() != null && previous.into() == (assembled.isEmpty() ? null : assembled.getLast())
                    && previous.model() != null && previous.model().speaker().equals(row.speaker()) && !LineReview.cut(previous.line().text(), width)) {
                String[] other = otherLabel(shown, ScriptText.visible(previous.line().text()).stripLeading(), previous.header(), row.speaker(), known, listed, heads);
                if (other != null) {
                    row = new Row(line.no(), Kind.DIALOGUE, other[0], other[1]);
                    header = other[1];
                }
            }
            String body = inner != null ? shown.substring(inner[1]).strip() : body(line.text(), header);
            Assembled into = null;
            switch (kind) {
                case DIALOGUE -> {
                    if (inner != null) {
                        Assembled action = new Assembled("direction", null, shown.substring(0, inner[0]).strip());
                        assembled.add(action);
                        traced.add(new Traced(line, model, Kind.DIRECTION, "", action.text, action));
                    }
                    if (body.isEmpty()) {
                        traced.add(new Traced(line, model, kind, header, body, null));
                        continue;
                    }
                    String speaker = sourceName(row.speaker(), line.text(), header, sourceText, spoken, lines);
                    String role = headerRole(speaker, line.text(), header, known);
                    // 머리 없이 이어지는 줄은 앞 머리에서 바로잡은 역을 잇는다 — 「빅토르」 머리 뒤 「(빅토르 모드) 아니…」도 모델은 「뭐든지」라 했다.
                    if (header.isEmpty() && carried != null && carried[0].equals(speaker)) {
                        role = carried[1];
                    } else if (!header.isEmpty()) {
                        carried = role.equals(speaker) ? null : new String[] {speaker, role};
                    }
                    speaker = role;
                    speaker = roster.isEmpty() ? speaker : CharacterNames.fix(speaker, roster, headers);
                    speaker = headerName(speaker, line.text(), header, lines, spoken, headerUses, listed, shortened, selfHeaded);
                    // 「강 국장 (소리)」는 「강 국장」의 화면 밖 목소리다 — 꼬리표는 화자 이름이나 원문 머리에서 떼어 대사 앞 지문으로 둔다(SOMA-709)
                    Matcher voiced = VOICE_TAG.matcher(speaker);
                    Matcher headed = VOICE_TAG.matcher(nameOf(header));
                    String tag = null;
                    if (voiced.find() && voiced.start() > 0) {
                        tag = voiced.group(1);
                        untagged.put(speaker, speaker.substring(0, voiced.start()));
                        speaker = speaker.substring(0, voiced.start());
                    } else if (headed.find() && headed.start() > 0) {
                        tag = headed.group(1);
                    }
                    Assembled last = assembled.isEmpty() ? null : assembled.getLast();
                    // 대신 찾은 머리도 머리다 — 모델이 비웠다고 이름으로 시작하는 줄을 앞 대사에 붙이면 두 대사가 하나가 된다.
                    if (last != null && speaker.equals(last.speaker) && header.isEmpty() && Objects.equals(tag, last.tag)) {
                        last.text = last.text + join.glue(last.text, last.lastLine, body) + body;
                    } else {
                        if (tag != null) {
                            assembled.add(new Assembled("direction", null, tag));
                        }
                        last = new Assembled("dialogue", speaker, body);
                        last.tag = tag;
                        assembled.add(last);
                    }
                    last.lastLine = line.text();
                    into = last;
                }
                case DIRECTION, SCENE -> {
                    if (!body.isEmpty()) {
                        into = new Assembled(kind == Kind.SCENE ? "scene" : "direction", null, body);
                        assembled.add(into);
                    }
                }
                case TITLE -> {
                    if (modelTitle == null && !body.isEmpty() && !titlePageNumber(body)) {
                        modelTitle = body;
                    }
                }
                case CAST -> castLines.add(body);
                // 블록 형식의 이름만 있는 줄도 그 이름의 머리다.
                case IGNORE -> selfHeaded.merge(CharacterNames.squash(ScriptText.visible(line.text())), 1, Integer::sum);
            }
            traced.add(new Traced(line, model, kind, header, body, into));
        }
        Map<String, String> merged = new HashMap<>(shortenAll(assembled, shortened, selfHeaded));
        untagged.forEach(merged::putIfAbsent);
        mergeSameSpeakers(assembled, roster).forEach(merged::put);
        merged.replaceAll((name, kept) -> merged.getOrDefault(kept, kept));
        List<String> characters = order(assembled, castLines);
        Map<String, Integer> index = new LinkedHashMap<>();
        for (int position = 0; position < characters.size(); position++) {
            index.put(characters.get(position), position);
        }
        List<ScriptDraft.Line> draftLines = new ArrayList<>();
        for (Assembled line : assembled) {
            draftLines.add(new ScriptDraft.Line(draftLines.size() + 1, line.kind,
                    line.speaker == null ? null : index.get(line.speaker), line.text));
        }
        Consumer<List<Origin>> trace = TRACE.get();
        if (trace != null) {
            Map<Assembled, Integer> ordinal = new IdentityHashMap<>();
            for (int position = 0; position < assembled.size(); position++) {
                ordinal.put(assembled.get(position), position + 1);
            }
            trace.accept(traced.stream().map(t -> new Origin(t.line().no(), t.kind().name().toLowerCase(),
                    t.model() == null ? null : t.model().kind().name().toLowerCase(), t.model() == null ? null : t.model().speaker(),
                    t.header(), t.body(), t.into() == null ? null : ordinal.get(t.into()))).toList());
        }
        Map<Integer, String> speakers = new HashMap<>();
        Map<Integer, String> sourceHeads = new HashMap<>();
        Traced before = null;
        for (Traced t : traced) {
            if (t.into() != null && t.into().speaker != null) {
                speakers.put(t.line().no(), t.into().speaker);
                String block = before == null || before.kind() != Kind.IGNORE ? "" : ScriptText.visible(before.line().text()).strip();
                String head = !t.header().isBlank() ? t.header().strip() : blockName(block) ? block : "";
                if (!head.isEmpty()) {
                    sourceHeads.put(t.line().no(), head);
                }
            }
            before = t;
        }
        return new Assembly(new ScriptDraft(title(title, modelTitle, fileName), rawText, source, characters, draftLines,
                traitsOf(characters, traits, merged)), speakers, sourceHeads);
    }

    /** 줄 맨 앞의 이름표 후보 — 글자·숫자 두~열 자 + 공백·탭·U+3000 + 말. */
    private static final Pattern LABEL = Pattern.compile("([\\p{L}\\p{N}]{2,10})([ \\t\\u3000]+)(?=\\S)");
    /** 앞 줄 머리가 이름 + 공백뿐인가 — 「지수 : 」·「민호 / 」처럼 구분 부호를 쓰는 대본은 부호 없는 「경비 퇴장하면,」이 지문이다. */
    private static final Pattern BARE_HEAD = Pattern.compile("[\\p{L}\\p{N}]+[ \\t\\u3000]+");
    /**
     * 이름 뒤 첫 낱말이 호칭·직함이면 이름표가 아니라 대사 속 이름이다 — 「민수 씨가 오늘…」·「정우 군은…」·「순자 할머니도…」(운영 대본
     * 759편 대조, SOMA-903).
     */
    private static final Pattern TITLE_WORD = Pattern.compile("(?:씨|양|군|님|형|형님|누나|언니|오빠|선배|선생님?|할머니|할아버지|아저씨|아줌마"
            + "|감독님?|사장님?|어머니|아버지|엄마|아빠|대리님?|팀장님?|부장님?|과장님?|선수|기자|작가님?)"
            + "(?:이|가|은|는|을|를|의|도|와|과|랑|이랑|한테|에게|께|께서|요|하고|만|이야|야|아)?[,.!?…~]*");
    /** 이름 뒤 첫 낱말이 조사로 끝나면 이름까지 한 낱말 덩어리다 — 「민호 김씨가 소개하는…」. */
    private static final Pattern PARTICLE_WORD = Pattern.compile("\\p{L}{2,}(?:가|이|는|은|를|을|의|에게|한테|와|과|도)");

    /**
     * 줄이 화자와 다른 배역의 이름표로 시작하면 {배역 이름, 뗄 머리}, 아니면 null (2026-10-27 운영, SOMA-903). 이름표는 이 대본의 배역
     * 이름(배역 목록·모델 화자)과 같거나 등장인물 소개 줄에 낱말로 나온 이름이고, 원문 두 줄 이상이 그 이름 + 공백으로 시작해야 한다 — 대사
     * 첫 낱말(「그래 」)이나 부르는 말 한 번을 이름표로 보지 않는다. 화자의 줄인·변형 이름(「지수」↔「김지수」)과 함께 말하기 머리는 보지 않는다.
     * 나누기 답이 이 줄 화자를 비워 앞 대사 화자로 채워졌거나(fillSpeakers), 목록의 「민호의 친구들[(1)구두쇠, …]」 같은 이름 때문에 이름표를
     * 화자로 쓰지 못한 줄이다. 배역 이름과 띄어쓰기만 다르면 그 표기, 아니면 원문 이름표를 화자로 쓴다.
     *
     * <p>운영 대본 759편에서 이 규칙이 바꿀 자리를 세어 좁혔다(SOMA-903): 앞 줄 머리가 이름 + 공백뿐일 때만(쌍점·빗금 머리 대본 제외), 이름 뒤
     * 띄움이 앞 줄 머리와 같은 모양일 때만(이름 뒤를 여러 칸 띄우는 대본에서 한 칸 띄운 「민호 김.」은 부르는 말), 첫 낱말이 호칭·직함이나 조사로 끝나는 낱말이 아닐 때만,
     * 소개 줄에서는 낱말 경계로만(「모든 학생들」의 「모든」·「누군가의」의 「누군가」는 이름이 아니다).
     */
    private static String[] otherLabel(String shown, String previousText, String previousHeader, String speaker, List<String> known,
            String listed, Heads heads) {
        Matcher label = LABEL.matcher(shown);
        if (!label.lookingAt() || !BARE_HEAD.matcher(previousHeader).matches()) {
            return null;
        }
        String name = label.group(1);
        String gap = label.group(2);
        String previousGap = previousHeader.substring(previousHeader.stripTrailing().length());
        if (gap.equals(" ") != previousGap.equals(" ") || !previousText.startsWith(previousHeader.stripTrailing())) {
            return null;
        }
        String rest = shown.substring(label.end());
        String next = rest.split("[ \\t\\u3000]", 2)[0];
        if (TITLE_WORD.matcher(next).matches() || PARTICLE_WORD.matcher(next).matches()) {
            return null;
        }
        boolean named = heads.known.stream().anyMatch(knownName -> CharacterNames.squash(knownName).equals(name))
                || known.stream().anyMatch(knownName -> CharacterNames.squash(knownName).equals(name))
                || Pattern.compile("(?<![\\p{L}\\p{N}])" + Pattern.quote(name) + "(?![\\p{L}\\p{N}])").matcher(listed).find();
        if (!named || GROUP_HEAD.matcher(name).matches() || relation(name, speaker) != null || typo(name, speaker, heads.known)) {
            return null;
        }
        Pattern started = Pattern.compile(Pattern.quote(name) + "[ \\t\\u3000]+\\S");
        long labelled = heads.lines.stream().filter(line -> started.matcher(ScriptText.visible(line.text()).stripLeading()).lookingAt())
                .limit(2).count();
        if (labelled < 2) {
            return null;
        }
        String cast = known.stream().filter(listedName -> CharacterNames.squash(listedName).equals(name)).findFirst().orElse(name);
        return new String[] {cast, label.group()};
    }

    /** 블록 형식의 이름 줄 — 글자가 있는 짧은 무시 줄이다. 쪽 번호(「- 16 -」)는 글자가 없다. */
    private static boolean blockName(String text) {
        return text.codePointCount(0, text.length()) <= 20 && text.codePoints().anyMatch(Character::isLetter);
    }

    /** 배역의 성별·나이대. 묶인 배역은 남긴 이름에 없으면 묶인 이름의 값을 잇는다. */
    private static List<CharacterTraits> traitsOf(List<String> characters, Map<String, CharacterTraits> traits,
            Map<String, String> merged) {
        List<String> named = new ArrayList<>(traits.keySet());
        List<CharacterTraits> result = new ArrayList<>(characters.size());
        for (String character : characters) {
            CharacterTraits found = named.isEmpty() ? null
                    : Stream.concat(Stream.of(character), merged.keySet().stream().filter(name -> merged.get(name).equals(character)))
                            .map(name -> traits.get(CharacterNames.fix(name, named)))
                            .filter(Objects::nonNull).findFirst().orElse(null);
            result.add(found == null ? CharacterTraits.UNKNOWN : found);
        }
        return result;
    }

    /**
     * 모델이 준 배역 이름이 원문 어디에도(띄어쓰기 무시) 없으면 원문 표기로 바꾼다 (SOMA-663). 머리가 원문 글자이고 이름이면 머리에서
     * 구분 부호를 뗀 것, 아니면({@code - } 머리) 원문에 있는 다른 배역 이름으로 {@link CharacterNames#fix} 한 것이다. 2026-10-20 실험
     * R1에서 머리가 「뜨레쁠레프」·「맥베스 부인」인 줄에 모델이 「треpleф」·「레이디 맥베스」를 썼다. 외국 글자 규칙보다 먼저인 이유:
     * 머리는 원문이 쓴 글자 그대로지만 편집 거리 2는 목록에서 비슷한 다른 사람을 고를 수 있다(「메ko」처럼 남는 글자가 적으면 못 맞춘다).
     * 머리 표기는 원문 두 줄 이상이 그 이름으로 시작할 때만 쓴다 — 줄 바꿈으로 떨어진 대사의 머리는 「(호수를 바라본다)」 같은 지문이다(재생 099).
     */
    private static String sourceName(String speaker, String text, String header, String source, List<String> spoken,
            List<NumberedLine> lines) {
        if (source.contains(CharacterNames.squash(speaker)) || spokenGroup(speaker, spoken)) {
            return speaker;
        }
        String named = fromSource(text, header) ? nameOf(header) : "";
        return named.isEmpty() || startedLines(named, lines) < 2 ? CharacterNames.fix(speaker, spoken) : named;
    }

    /**
     * 그 줄 머리의 이름이 모델 화자와 다른 연습 배역이면 머리 이름이다 (SOMA-663 H5). 2026-10-20 재생에서 모델이 머리 「사모1」에
     * 연기하는 인물 「나봉숙」을, 「(제혁NA)」·「재이 (N)」에 「제혁」·「재이」를, 「빅토르」에 그 역을 맡은 「뭐든지」를 썼다.
     * 머리가 화자의 표기 변형(한쪽이 다른 쪽을 품거나 편집 거리 1 — 「나봉」·「나봉숙」, 「경비」·「아파트 경비」)이고 내레이션·역할
     * 표시가 같으면 화자를 둔다. 머리 이름은 내레이션 표시가 있거나, 화자의 표기 변형에 역할 표시가 붙었거나, 이 대본의 배역(목록·대사에
     * 나온 이름)일 때만 쓴다 — 머리 칸에
     * 대사 조각(「들의」)·부름말(「거트루드, 」)·깨진 글자(「AAPA :」)를 넣은 답이 있다. 여럿이 함께 하는 화자·머리(「노봉/나봉」)는
     * 보지 않는다.
     */
    private static String headerRole(String speaker, String text, String header, List<String> known) {
        String named = fromSource(text, header) ? nameOf(header) : "";
        if (named.isEmpty() || MULTIPLE.matcher(named + speaker).find() || header.strip().endsWith(",")) {
            return speaker;
        }
        String key = CharacterNames.sameSpeakerKey(named);
        String speakerKey = CharacterNames.sameSpeakerKey(speaker);
        // 숫자만 다른 머리(「형사2」 머리에 모델 화자 「형사1」)는 표기 변형이 아니라 원문이 밝힌 다른 사람이다(SOMA-709)
        if (!CharacterNames.sameNumbers(key, speakerKey) && key.replaceAll("\\d", "").equals(speakerKey.replaceAll("\\d", ""))) {
            return named;
        }
        boolean variant = key.contains(speakerKey) || speakerKey.contains(key) || CharacterNames.editDistance(key, speakerKey) <= 1;
        if (key.equals(speakerKey) || variant && CharacterNames.marked(named) == CharacterNames.marked(speaker)) {
            return speaker;
        }
        // 표기 변형인데 머리에만 역할 표시(「민(영혼)」)가 있으면 배역 목록에 없어도 머리다 — 다른 연습 배역이다(SOMA-663 M6, 2026-10-21 개발 021).
        return CharacterNames.narration(named) || known.contains(named) || variant && CharacterNames.marked(named) ? named : speaker;
    }

    /**
     * 여럿이 함께 하는 화자의 이름이 모두 이 대본에 나오는 배역인가(「미나네, 순이네, 동진네」). 모델이 맞힌 참여자를 머리 표기(「셋」·「미,동」)나
     * 첫 이름(「미나네」)으로 줄이지 않는다 (SOMA-663 C2, 2026-10-21 개발 022).
     */
    private static boolean spokenGroup(String speaker, List<String> spoken) {
        List<String> parts = Stream.of(MULTIPLE.split(speaker)).map(CharacterNames::squash).toList();
        return parts.size() > 1 && parts.stream().allMatch(part -> !part.isEmpty()
                && spoken.stream().anyMatch(name -> CharacterNames.squash(name).equals(part)));
    }

    private static long startedLines(String name, List<NumberedLine> lines) {
        String head = CharacterNames.squash(name);
        return lines.stream().filter(line -> CharacterNames.squash(ScriptText.visible(line.text())).startsWith(head)).count();
    }

    /**
     * 원문 머리가 말하는 이름을 모델 이름보다 앞세운다 (SOMA-663 H4).
     * <ul>
     *   <li>머리가 내레이션 표시(「재이 (N)」)인데 모델 이름에 없으면 머리를 쓴다 — 내레이션은 다른 배역이다.</li>
     *   <li>모델 이름이 머리 이름을 품은 더 긴 이름이면 {@code shortened} 에 세기만 하고 바꾸기는 {@link #shortenAll} 이 대본 단위로 한다.</li>
     *   <li>모델이 두 줄 이상에 단 두 글자 이상의 머리(괄호로 시작하는 머리는 빼고, {@link #headerUses})인데 모델이 서로 품지도 않고 두 글자
     *       이상 다른 이름을 쓰면 머리다 — 2026-10-20 개발
     *       묶음에서 앞 400줄 뒤에 처음 나오는 「학생1」·「비서」 줄에 목록의 「앙상블」·「여경」을 썼다. 한 글자 다른 것(「엠버」·「앰버」),
     *       목소리 머리(「녹음 속 목소리」 — 화면 밖 목소리는 주인 배역이다), 글자 종류가 다른 머리(글자 인식이 깨진 「AAPA」)는 모델이 고른
     *       표기를 둔다. 머리 뒤가 공백 한 칸이면 그 이름이 배역 목록이나 등장인물 소개 줄에 있을 때만이다 — 노래 가사 줄 「처음 가져보는
     *       기분이야」에 모델이 머리 「처음 」을 단 대본이 있었다(2026-10-20 개발 020).</li>
     *   <li>머리가 없고 모델 이름이 원문 머리로 쓰이지 않은 「배역 이름 + 낱말」이면(「로라 (객석을 향해) 안녕하세요…」·「돈결 돈결」) 그 배역이다.
     *       띄어 쓰지 않고 대사가 여섯 자 이상 붙은 것(「사회자(퀴즈대회)만원!(함성).」, 2026-10-20 개발 022)도 같다.</li>
     * </ul>
     * 제 이름을 머리로 단 줄 수는 {@code selfHeaded} 에 센다({@link CharacterNames#squash} 모양).
     */
    private static String headerName(String speaker, String text, String header, List<NumberedLine> lines, List<String> spoken,
            Map<String, Integer> headerUses, String listed, Map<String, Map<String, Integer>> shortened, Map<String, Integer> selfHeaded) {
        String named = fromSource(text, header) ? nameOf(header) : "";
        String said = CharacterNames.squash(speaker);
        if (spokenGroup(speaker, spoken)) {
            return speaker;
        }
        if (named.isEmpty()) {
            if (startedLines(speaker, lines) < 2) {
                for (String name : spoken) {
                    if (speaker.startsWith(name + " ") && startedLines(name, lines) >= 2
                            || name.codePointCount(0, name.length()) >= 2 && speaker.startsWith(name)
                            && speaker.codePointCount(name.length(), speaker.length()) >= 6) {
                        return name;
                    }
                }
            }
            return speaker;
        }
        String name = CharacterNames.squash(named);
        if (CharacterNames.sameSpeakerKey(named).equals(CharacterNames.sameSpeakerKey(speaker))) {
            selfHeaded.merge(said, 1, Integer::sum);
            return speaker;
        }
        if (CharacterNames.narration(named) && !CharacterNames.narration(speaker)) {
            return named;
        }
        boolean headed = startedLines(named, lines) >= 2 || startedLines(ScriptText.visible(header).strip(), lines) >= 2;
        if (headed && said.length() > name.length() && said.contains(name)) {
            shortened.computeIfAbsent(speaker, key -> new HashMap<>()).merge(named, 1, Integer::sum);
        } else if (headerUses.getOrDefault(name, 0) >= 2 && name.codePointCount(0, name.length()) >= 2 && !name.contains(said)
                && CharacterNames.editDistance(name, said) > 1 && !VOICE.matcher(named).find() && sameScript(named, speaker)
                && (labelGap(header) || listed.contains(name))) {
            return named;
        }
        return speaker;
    }

    /**
     * 화자의 줄에 달린 더 짧은 머리 이름이 제 이름을 단 줄보다 많으면 그 화자의 모든 줄을 가장 많이 달린 머리 이름으로 옮기고, 옮긴
     * 이름 → 머리 이름을 돌려준다. 블록 형식의 이름만 있는 줄도 제 이름의 머리로 친다. 2026-10-20 개발 묶음에서 배역 목록이 등장인물
     * 소개의 성+이름(「윤해온」·「보리스 아넨코프」)을 주면 모델은 머리가 「해온」·「아넨코프」인 줄 일부에도 목록 이름을 써서 한 사람이
     * 둘로 갈렸고, 머리 「청년」 줄에 「청년 화장실에」처럼 대사 첫 낱말까지 이름에 넣었다. 줄마다 옮기면 원문이 「백지안:」·「지안:」을
     * 함께 쓴 대본에서 모델이 하나로 맞춘 이름이 도로 갈린다. 제 이름을 단 줄이 더 많은 화자(원문이 일부러 나눈 「웹 부인」·「웹」)는 둔다.
     */
    private static Map<String, String> shortenAll(List<Assembled> lines, Map<String, Map<String, Integer>> shortened,
            Map<String, Integer> selfHeaded) {
        Map<String, String> renamed = new HashMap<>();
        shortened.forEach((speaker, names) -> {
            Map.Entry<String, Integer> most = Collections.max(names.entrySet(), Map.Entry.comparingByValue());
            if (most.getValue() > selfHeaded.getOrDefault(CharacterNames.squash(speaker), 0)) {
                renamed.put(speaker, most.getKey());
            }
        });
        for (Assembled line : lines) {
            if (line.speaker != null) {
                line.speaker = renamed.getOrDefault(line.speaker, line.speaker);
            }
        }
        return renamed;
    }

    /** 머리가 이름표 모양으로 끝나는가 — 쌍점, 또는 공백 두 칸 이상·탭·U+3000. */
    private static boolean labelGap(String header) {
        String shown = ScriptText.visible(header);
        String name = shown.stripTrailing();
        String gap = shown.substring(name.length());
        return name.endsWith(":") || name.endsWith("：") || gap.length() >= 2 || gap.contains("\t") || gap.contains("\u3000");
    }

    /** 두 이름이 같은 글자 종류(한글이 있는가)이고 머리에 글자 종류가 섞이지 않았는가. */
    private static boolean sameScript(String header, String speaker) {
        return hangul(header) == hangul(speaker) && !CharacterNames.mixesScripts(header);
    }

    private static boolean hangul(String name) {
        return name.codePoints().anyMatch(point -> Character.UnicodeScript.of(point) == Character.UnicodeScript.HANGUL);
    }

    /**
     * 모델이 대사 줄에 단 머리 이름({@link CharacterNames#squash} 모양)마다 그 머리를 단 줄 수. 「(일어서며) 」처럼 괄호로 시작하는 머리와
     * 「박 선생님, 」처럼 쉼표로 끝나는 머리(부르는 말)는 이름이 아니라 빼고, 한 줄에만 달린 머리(줄 바꿈으로 떨어진 대사의 「었어 」)는 다른 이름 규칙에 쓰지 않으려고 센다.
     */
    private static Map<String, Integer> headerUses(List<NumberedLine> lines, Map<Integer, Row> rows, Heads heads) {
        Map<String, Integer> uses = new HashMap<>();
        for (NumberedLine line : lines) {
            Row row = rows.get(line.no());
            String header = row != null && row.kind() == Kind.DIALOGUE ? headerOf(line.text(), row, heads) : "";
            String shown = ScriptText.visible(header).strip();
            if (fromSource(line.text(), header) && !shown.startsWith("(") && !shown.endsWith(",")) {
                uses.merge(CharacterNames.squash(nameOf(header)), 1, Integer::sum);
            }
        }
        return uses;
    }

    /** 원문에 화자 머리로 쓰인 이름({@link CharacterNames#squash} 모양) — 대사 줄의 머리와 블록 형식의 이름만 있는 줄. */
    private static Set<String> headers(List<NumberedLine> lines, Map<Integer, Row> rows, Heads heads) {
        Set<String> names = new HashSet<>();
        for (NumberedLine line : lines) {
            names.add(CharacterNames.squash(nameOf(line.text())));
            Row row = rows.get(line.no());
            String header = row != null && row.kind() == Kind.DIALOGUE ? headerOf(line.text(), row, heads) : "";
            if (fromSource(line.text(), header)) {
                names.add(CharacterNames.squash(nameOf(header)));
            }
        }
        names.remove("");
        return names;
    }

    private static boolean fromSource(String text, String header) {
        return !header.isBlank() && ScriptText.visible(text).stripLeading().startsWith(ScriptText.visible(header).stripLeading());
    }

    /** 머리에서 구분 부호를 뗀 이름 — {@code 메드베젠코: }→메드베젠코, {@code [지수] }→지수. 글자가 없으면({@code - }) 빈 문자열. */
    /**
     * 원문이 함께 말하기 머리(「모두」)를 줄 안 화자 머리로 이미 쓴 문서에서, 같은 이름·같은 띄어쓰기로 시작하는 머리 없는 대사 줄은 그 함께
     * 말하기 화자의 말이다 — 바꿀 줄(머리는 원문의 그 이름과 띄어쓰기)을 돌려준다 (SOMA-663 M8 N6). 나누기 답이 이런 줄을 앞 화자의 이어지는 말로
     * 보거나 원문에 없는 집합 이름(「무리」)을 붙여 머리가 대사에 남았다(재생 008). 띄어쓰기가 머리와 다르면(「모두⎵⎵⎵⎵⎵⎵⎵나만의 기회!」 문서의
     * 가사 「모두 최신 음악 맞춰 춤을 추죠」, 재생 007), 앞 줄이 줄 너비에서 끊겼으면, 이미 함께 말하기인 화자는 그대로 둔다. 문서가 그 머리를
     * 한 번도 줄 안 화자 머리로 쓰지 않았으면 본문 첫 낱말로 본다.
     *
     * @param heads 조립이 대사 줄에서 뗀 원문 머리(블록 형식이면 위 이름 줄) — {@link Assembly#heads}
     */
    public static Map<Integer, Row> groupHeads(List<NumberedLine> lines, Map<Integer, Row> rows, Map<Integer, String> heads) {
        Map<String, String> written = new LinkedHashMap<>();
        for (NumberedLine line : lines) {
            Row row = rows.get(line.no());
            String name = ScriptText.visible(heads.getOrDefault(line.no(), "")).strip();
            Matcher head = Pattern.compile(Pattern.quote(name) + "[\\s\\p{Z}]+(?=\\S)").matcher(ScriptText.visible(line.text()).stripLeading());
            if (row != null && row.kind() == Kind.DIALOGUE && GROUP_HEAD.matcher(CharacterNames.squash(name)).matches()
                    && CharacterNames.squash(name).equals(CharacterNames.squash(row.speaker())) && head.lookingAt()) {
                written.putIfAbsent(head.group(), row.speaker());
            }
        }
        Map<Integer, Row> changed = new LinkedHashMap<>();
        int width = LineReview.width(lines);
        for (int at = 0; at < lines.size(); at++) {
            NumberedLine line = lines.get(at);
            Row row = rows.get(line.no());
            // 앞 줄이 줄 너비에서 끊겼으면 이 줄은 그 말을 잇는 줄이다 — 「모두 좋아해요」의 「모두」는 말의 일부다
            if (row == null || row.kind() != Kind.DIALOGUE || heads.containsKey(line.no()) || GROUP.matcher(row.speaker()).find()
                    || at > 0 && LineReview.cut(lines.get(at - 1).text(), width)) {
                continue;
            }
            String text = ScriptText.visible(line.text()).stripLeading();
            written.forEach((head, speaker) -> {
                if (!changed.containsKey(line.no()) && text.startsWith(head) && text.length() > head.length()
                        && !Character.isWhitespace(text.charAt(head.length())) && !Character.isSpaceChar(text.charAt(head.length()))) {
                    changed.put(line.no(), new Row(line.no(), Kind.DIALOGUE, speaker, head));
                }
            });
        }
        return changed;
    }

    static String nameOf(String header) {
        String name = ScriptText.visible(header).strip().replaceAll("[\\s:：.,，、\\-—]+$", "");
        if (name.length() > 1 && (name.startsWith("[") && name.endsWith("]") || name.startsWith("(") && name.endsWith(")"))) {
            name = name.substring(1, name.length() - 1).strip();
        }
        return name.codePoints().anyMatch(Character::isLetter) ? name : "";
    }

    /**
     * 한 대본 안에서 {@link CharacterNames#sameSpeakerKey} 가 같은 화자를 하나로 묶고, 묶인 이름 → 남긴 이름을 돌려준다 (SOMA-663).
     * 남기는 표기는 대사가 많은 쪽, 같으면 배역 목록에 있는 쪽, 그다음 짧은 쪽, 그다음 먼저 말한 쪽이다. 새 이름은 짓지 않는다.
     * 2026-10-20 실험 R1에서 한 사람이 「장석구」·「장석구 (소리)」, 「형사 1」·「형사1」처럼 갈렸다. 배역 목록이 없는 짧은 대본에도 묶는다.
     */
    private static Map<String, String> mergeSameSpeakers(List<Assembled> lines, List<String> roster) {
        Map<String, Integer> count = new LinkedHashMap<>();
        for (Assembled line : lines) {
            if (line.speaker != null) {
                count.merge(line.speaker, 1, Integer::sum);
            }
        }
        Map<String, List<String>> groups = new LinkedHashMap<>();
        for (String name : count.keySet()) {
            groups.computeIfAbsent(CharacterNames.sameSpeakerKey(name), key -> new ArrayList<>()).add(name);
        }
        Map<String, String> renamed = new HashMap<>();
        for (List<String> group : groups.values()) {
            String kept = Collections.min(group, Comparator
                    .comparing((String name) -> -count.get(name))
                    .thenComparing(name -> !roster.contains(name))
                    .thenComparing(name -> name.codePointCount(0, name.length())));
            group.stream().filter(name -> !name.equals(kept)).forEach(name -> renamed.put(name, kept));
        }
        for (Assembled line : lines) {
            if (line.speaker != null) {
                line.speaker = renamed.getOrDefault(line.speaker, line.speaker);
            }
        }
        return renamed;
    }

    /**
     * 대사 줄에서 뗄 머리. 원문 줄이 화자 이름(또는 그 줄임·띄어쓰기 변형, 화면 밖 목소리·내레이션 표시가 붙은 것)과 구분 부호로
     * 시작하면 거기까지를 머리로 찾고, 모델이 준 머리는 찾은 것보다 길고 믿을 만할 때만 쓴다(SOMA-663 N1). 모델은 원문 접두사이기만
     * 하면 받아들여져서, 2026-10-21 개발 묶음에서 대사 문장·괄호 행동·여는 따옴표·호명까지 머리로 지우고(029·156·186·062) 반대로
     * 머리를 비워 「윤 누구?」·「해온 집에…」의 이름이 대사에 남았다(041·004). 글자를 짓지 않고 원문에서 떼는 범위만 고른다.
     *
     * <p>구분 부호: {@code :}·{@code ：}·{@code ;}, 말줄임표가 아닌 {@code .}·{@code -}·{@code —}, 괄호로 감싼 이름의 닫는 괄호, 탭·U+3000·공백 두
     * 칸 이상. 공백 한 칸은 두 글자 이상의 화자 이름 그대로일 때 뗀다. 한 글자 이름과 줄인 이름({@code 서윤}↔{@code 한서윤})은 그 화자
     * 대사 줄의 세 줄에 한 줄 이상(두 줄 이상)이 같은 모양으로 시작하거나 모델 머리가 그 이름으로 시작할 때만 — {@code 나 갈래} 같은
     * 대사를 망치지 않게. 들여 쓴 줄은 공백 한 칸이면 떼지 않는다.
     */
    private static String headerOf(String text, Row row, Heads heads) {
        if (row == null) {
            return "";
        }
        String stripped = ScriptText.visible(text).stripLeading();
        String model = ScriptText.visible(row.header()).stripLeading();
        // 쌍점 뒤 글자는 머리가 아니다 — 모델 머리 「은중:.」는 「은중:」까지(SOMA-663 M1, 재생 150)
        Matcher colon = PAST_COLON.matcher(model);
        if (colon.lookingAt()) {
            model = colon.group(1);
        }
        // 들여 쓴 줄은 블록의 이어지는 줄이다 — 「(들여쓰기)리나 맘 모르시죠?」의 이름은 대사의 일부다.
        boolean indented = stripped.length() < ScriptText.visible(text).length();
        String found = nameHead(stripped, row.speaker(), model, indented, heads);
        // 모델이 한 번만 쓴 화자 이름이 줄 글을 먹었으면(「선생 요즘」 — 재생 008) 모델 머리보다 늘리지 않는다. 찾은 머리가 화자 이름 그대로이고
        // 탭·쌍점·두 칸 이상으로 끝나면 줄 글을 먹은 이름이 아니다 — 「모⇥두⇥」를 모델 머리 「모⇥」로 줄여 「두」가 대사에 남았다(SOMA-663 M7, 재생 066)
        boolean exact = Boolean.TRUE.equals(relation(nameOf(found), row.speaker())) && STRONG_END.matcher(found).find();
        boolean longer = model.length() > found.length() || !exact && !model.isEmpty() && !heads.speaks(row.speaker())
                && !CharacterNames.squash(withoutVoice(nameOf(found))).equals(CharacterNames.squash(withoutVoice(nameOf(model))));
        return longer && trusted(model, stripped, row.speaker(), heads) ? model : found;
    }

    private static String nameHead(String stripped, String speaker, String model, boolean indented, Heads heads) {
        if (speaker.isBlank()) {
            return "";
        }
        int start = stripped.startsWith("[") || stripped.startsWith("(") ? 1 : 0;
        for (int end = Math.min(stripped.length(), start + Math.max(HEAD_MAX, speaker.length() + 4)); end > start; end--) {
            if (end < stripped.length() && !space(stripped.charAt(end)) && ":：;.-—)]".indexOf(stripped.charAt(end)) < 0) {
                continue;
            }
            String name = stripped.substring(start, end);
            // 쌍점으로 끝나는 후보는 이름이 아니다 — 이름 비교가 끝 쌍점을 지워(h4) 「은중:.배리」의 「은중:」을 이름으로 보면 「.」까지 머리가 된다(통합 150)
            if (":：;".indexOf(name.charAt(name.length() - 1)) >= 0) {
                continue;
            }
            Boolean same = relation(name, speaker);
            // 화자 이름의 한 글자 오타인 이 대본의 배역 표기(「클로디어스」↔「클로디우스」)도 원문 머리다 — 모델 머리로만 받았다(SOMA-663 M7, 재생 049)
            if (same == null && typo(name, speaker, heads.known)) {
                same = false;
            }
            if (same == null) {
                continue;
            }
            int at = end;
            // 괄호 짝이 틀리거나(「[주인)」) 여는 괄호만 있는 머리(「[일본군 기 이소가…」)도 원문 머리다(재생 201·173)
            // 줄 뒤에서 닫히는 괄호 속 이름은 괄호 행동이다 — 「(빅토르 모드) 아니, …」(재생 046)
            if (start == 1 && at < stripped.length() && ")]".indexOf(stripped.charAt(at)) >= 0) {
                at++;
            } else if (start == 1 && !(same && at < stripped.length() && space(stripped.charAt(at))
                    && stripped.indexOf(stripped.charAt(0) == '[' ? ']' : ')', at) < 0)) {
                continue;
            }
            int gapEnd = at;
            while (gapEnd < stripped.length() && space(stripped.charAt(gapEnd))) {
                gapEnd++;
            }
            if (gapEnd >= stripped.length()) {
                // 이름(과 목소리 표시)뿐인 줄 — 블록 형식의 이름 줄을 대사 글로 남기지 않는다(재생 048 「강 국장 (소리)」). 모델이 줄 글 전체를
                // 화자로 쓴 한 번뿐인 줄(재생 156 「엥?」)은 글을 지우지 않는다.
                return heads.speaks(speaker) ? stripped : "";
            }
            char separator = stripped.charAt(gapEnd);
            boolean ellipsis = gapEnd + 1 < stripped.length() && ".…".indexOf(stripped.charAt(gapEnd + 1)) >= 0;
            // 여는 괄호 없이 닫는 괄호만 남은 머리(「JIMMY]」)도 머리다 — PDF 추출이 앞 괄호를 떨어뜨린다(재생 178)
            boolean closes = start == 0 && at == gapEnd && ")]".indexOf(separator) >= 0;
            boolean longName = name.codePointCount(0, name.length()) >= 2;
            boolean usual = model.startsWith(name) || heads.usual(name, speaker);
            // 한 글자 뒤 마침표는 대개 대사다 — 「네. 루이스 할머니가…」(재생 051)
            if ("：:;".indexOf(separator) >= 0 || ".-—".indexOf(separator) >= 0 && !ellipsis && (longName || usual) || closes) {
                return stripped.substring(0, gapEnd + 1);
            }
            String gap = stripped.substring(at, gapEnd);
            if (start == 1) {
                return stripped.substring(0, gapEnd);
            }
            if (gap.isEmpty()) {
                continue;
            }
            boolean wide = gap.length() >= 2 || !gap.equals(" ");
            if (wide ? same || longName || usual : !indented && (same && longName || usual)) {
                return stripped.substring(0, gapEnd);
            }
        }
        return "";
    }

    /**
     * 머리 후보 이름과 화자: 같은 이름(띄어쓰기만 다름)이면 true, 줄인·변형 이름이면 false, 아니면 null. 이름 뒤의 화면 밖
     * 목소리·내레이션 표시(「민성(소리)」·「경진 (소리만)」·「김지훈NA」)와 이름에 붙은 짧은 괄호 설명(「지우(너)」)은 빼고 견준다 — 띄어
     * 쓴 괄호는 행동 지문이다(「처녀 (겁을 집어먹고)」).
     */
    private static Boolean relation(String name, String speaker) {
        // 함께 말하기 이름의 구분 부호(「바트, 켈리」↔「바트/켈리」)는 하나로 본다(재생 183)
        String head = CharacterNames.squash(name).replaceAll("[,/·•∙・&]", ",");
        String squashed = CharacterNames.squash(speaker).replaceAll("(?:^[\\[(])|(?:[\\])]$)", "").replaceAll("[,/·•∙・&]", ",");
        if (head.codePoints().noneMatch(Character::isLetter) || squashed.isEmpty()) {
            return null;
        }
        if (head.equals(squashed)) {
            return true;
        }
        String bare = withoutVoice(name);
        if (!bare.equals(name)) {
            return relation(bare, speaker);
        }
        if (NOT_NAME.matcher(name).find()) {
            return null;
        }
        // 함께 말하기 화자의 「둘다」·「같이」 머리(재생 003·039)
        boolean together = GROUP.matcher(speaker).find() && GROUP_HEAD.matcher(head).matches();
        // 한 글자 줄임은 이름 앞·끝에서만 — 「여 제네뵈브」의 「네」는 대사 「네.」다(재생 051). 두 글자부터는 가운데도(「죄인 이십 번」의 「이십」)
        boolean part = squashed.codePointCount(0, squashed.length()) <= HEAD_MAX / 2 && (head.codePointCount(0, head.length()) >= 2
                ? squashed.contains(head) : squashed.startsWith(head) || squashed.endsWith(head));
        return together || part || CharacterNames.sameSpeakerKey(name).equals(CharacterNames.sameSpeakerKey(speaker)) ? false : null;
    }

    /** 머리 후보가 화자 이름과 한 글자만 다른 이 대본의 배역 이름인가 — 세 글자 이상, 띄어쓰기 없는 이름, 내레이션 표시가 같을 때만. */
    private static boolean typo(String name, String speaker, Set<String> known) {
        String head = CharacterNames.squash(name);
        String squashed = CharacterNames.squash(speaker);
        return !name.strip().contains(" ") && known.contains(head) && head.codePointCount(0, head.length()) >= 3
                && squashed.codePointCount(0, squashed.length()) >= 3 && CharacterNames.narration(name) == CharacterNames.narration(speaker)
                && CharacterNames.editDistance(head, squashed) == 1;
    }

    /** 이름 뒤의 목소리·내레이션 표시와 붙은 짧은 괄호 설명을 뗀 이름. 없으면 그대로. */
    private static String withoutVoice(String name) {
        Matcher noted = NOTED.matcher(name);
        if (noted.matches() && (VOICE_MARK.matcher(noted.group(2)).matches() || noted.end(1) == noted.start(2))) {
            return noted.group(1);
        }
        Matcher voice = VOICE_OF.matcher(name);
        if (voice.matches()) {
            return voice.group(1);
        }
        Matcher tail = VOICE_TAIL.matcher(name);
        return tail.find() && tail.start() > 0 ? name.substring(0, tail.start()) : name;
    }

    private static boolean space(char c) {
        return Character.isWhitespace(c) || Character.isSpaceChar(c);
    }

    /**
     * 모델 머리를 믿는가: 구분 부호뿐인 머리({@code - }), 화자와 이어지는 이름, 이 대본의 다른 배역 이름, 모델 화자가 원문에 없을 때
     * 원문 두 줄 이상이 그 글자로 시작하는 머리. 머리 뒤가 말줄임표의 나머지면({@code 한여름  .}+{@code ..나도}) 믿지 않는다.
     */
    private static boolean trusted(String model, String stripped, String speaker, Heads heads) {
        String trimmed = model.replaceAll("(?:^[\\s\\p{Z}]+)|(?:[\\s\\p{Z}]+$)", "");
        // 마크다운 굵게(「**민우:** 」)는 머리의 일부다(재생 209)
        String core = trimmed.replaceAll("(?:^[*_]+)|(?:[\\s\\p{Z}:：;.\\-—–*_&]+$)", "");
        if (core.isEmpty()) {
            return trimmed.matches("[-–—:：;]+");
        }
        if (core.matches("[^(\\[]*[)\\]]")) {
            core = core.substring(0, core.length() - 1);
        }
        if (trimmed.endsWith(".") && model.length() < stripped.length() && ".…".indexOf(stripped.charAt(model.length())) >= 0) {
            return false;
        }
        boolean wrapped = core.length() > 1 && (core.startsWith("[") && core.endsWith("]") || core.startsWith("(") && core.endsWith(")"));
        String inner = wrapped ? core.substring(1, core.length() - 1).strip() : core;
        if (relation(inner, speaker) != null) {
            return true;
        }
        // 화자 표기와 달라도 이 대본의 배역을 가리키는 대괄호 머리(「[졸리아] 」↔쥴리아, 「[JIM/SAND] 」↔JIMMY/SAND)는 원문 머리다 — 떼는
        // 범위는 화자 이름과 따로 정한다. 화자를 표준 이름으로 맞춘 답이 머리를 잃어 머리가 대사에 남았다(SOMA-663 M1, 재생 178·201)
        if (wrapped && core.startsWith("[") && !NOT_NAME.matcher(inner).find()
                && Stream.of(inner.split("[\\s,/·•∙・&]+")).allMatch(part -> namesCast(part, heads.known))) {
            return true;
        }
        // 탭·두 칸 이상 띄운 짧은 머리는 쉼표가 있어도 이름이다 — 함께 말하기 줄임 「미,영⇥」(재생 022)
        String gap = model.substring(model.indexOf(trimmed) + trimmed.length());
        boolean wide = gap.length() >= 2 || gap.matches(".*[\\t\\u3000\\u00a0].*");
        if (wide && !wrapped && inner.codePointCount(0, inner.length()) <= 10 && !NOT_NAME.matcher(inner.replace(",", "")).find()) {
            return true;
        }
        String bare = withoutVoice(inner);
        String[] names = bare.split("[\\s,/·•∙・&]+");
        if (NOT_NAME.matcher(bare.replace(",", "")).find() || names.length > 6 || bare.codePoints().noneMatch(Character::isLetter)) {
            return false;
        }
        // 쌍점으로 끝나는 짧은 이름 머리(「AA : 」·「에 2 리 : 」 — 추출이 깨진 이름), 목소리 배역 머리(「녹음 속 목소리」)
        if (!wrapped && names.length <= 4 && (trimmed.endsWith(":") || trimmed.endsWith("：") || !bare.equals(inner))) {
            return true;
        }
        // 이 대본의 배역 이름, 또는 배역 이름만 늘어놓은 함께 말하기·순서 머리(「지한 / 유연 / 지영」 — 재생 034·156)
        if (heads.known.contains(CharacterNames.squash(bare)) || names.length >= 2 && Stream.of(names).allMatch(heads.known::contains)
                || wrapped && VOICE_MARK.matcher("(" + CharacterNames.squash(inner) + ")").matches()) {
            return true;
        }
        if (NOT_NAME.matcher(bare).find() || bare.split("\\s+").length > 3) {
            return false;
        }
        // 화자 이름의 한 글자 오타(「이반」↔「이빈」, 「배만」↔「배달」·「감독3」↔「감독1」)도 원문 머리다(재생 025·027·065)
        if (!wrapped && !bare.contains(" ") && bare.codePointCount(0, bare.length()) >= 2
                && CharacterNames.editDistance(CharacterNames.squash(bare), CharacterNames.squash(speaker)) == 1) {
            return true;
        }
        return !wrapped && !heads.source.contains(CharacterNames.squash(speaker)) && startedLines(core, heads.lines) >= 2;
    }

    /** 머리 속 이름 하나가 이 대본의 배역인가 — 같은 이름, 두 글자 이상의 앞부분 줄임, 세 글자 이상에서 한 글자 오타. */
    private static boolean namesCast(String part, Set<String> known) {
        String name = CharacterNames.squash(part);
        int length = name.codePointCount(0, name.length());
        return known.stream().anyMatch(cast -> cast.equals(name) || length >= 2 && cast.startsWith(name)
                || length >= 3 && CharacterNames.editDistance(name, cast) == 1);
    }

    /** 머리를 고를 때 보는 대본 전체 — 줄, 지금 판정, 배역 이름({@link CharacterNames#squash} 모양), 원문 글자. */
    private static final class Heads {
        final List<NumberedLine> lines;
        final Map<Integer, Row> rows;
        final Set<String> known;
        final String source;
        private final Map<String, Boolean> usual = new HashMap<>();

        Heads(List<NumberedLine> lines, Map<Integer, Row> rows, List<String> known, String source) {
            this.lines = lines;
            this.rows = rows;
            this.known = new HashSet<>(known.stream().map(CharacterNames::squash).toList());
            this.source = source;
        }

        /** 이 화자의 대사 줄이 두 줄 이상인가. */
        boolean speaks(String speaker) {
            return rows.values().stream().filter(row -> row.kind() == Kind.DIALOGUE && row.speaker().equals(speaker)).limit(2).count() >= 2;
        }

        /** 이 화자 대사 줄 중 두 줄 이상, 세 줄에 한 줄 이상이 「이름 + 공백 한 칸 + 글자」로 시작하는가. */
        boolean usual(String name, String speaker) {
            return usual.computeIfAbsent(name + "\n" + speaker, key -> {
                int total = 0;
                int headed = 0;
                for (NumberedLine line : lines) {
                    Row row = rows.get(line.no());
                    if (row == null || row.kind() != Kind.DIALOGUE || !row.speaker().equals(speaker)) {
                        continue;
                    }
                    total++;
                    String text = ScriptText.visible(line.text()).stripLeading();
                    int after = name.length() + 1;
                    if (text.startsWith(name + " ") && text.length() > after && !Character.isWhitespace(text.charAt(after))) {
                        headed++;
                    }
                }
                return headed >= 2 && headed * 3 >= total;
            });
        }
    }

    /** 이 대본의 배역 이름 — 모델이 대사에 쓴 이름과 배역 목록. 긴 이름부터 맞춰 보도록 길이 순이다. */
    private static List<String> known(Map<Integer, Row> rows, List<String> roster) {
        List<String> names = new ArrayList<>(roster);
        for (Row row : rows.values()) {
            if (row.kind() == Kind.DIALOGUE && !row.speaker().isBlank() && !names.contains(row.speaker())) {
                names.add(row.speaker());
            }
        }
        names.sort(Comparator.comparingInt(String::length).reversed());
        return names;
    }

    /**
     * 지문이라 판정된 줄이 「배역 이름 + 탭·U+3000·공백 세 칸 이상 + 대사」 모양이면 그 배역의 대사 판정, 아니면 null (SOMA-663).
     * 2026-10-13 105편에서 모델이 {@code 베니⇥그래.}, {@code 할머니⇥⇥(무너진다.) 안돼!!!} 같은 줄을 지문이라 해 대사가 빠졌다 —
     * 앞의 괄호 지문을 보고 줄 전체를 지문으로 본 경우가 많았다. 이름 뒤가 괄호 지문뿐이면({@code 유령⇥[무대 밑에서]}, 괄호가 다음
     * 줄로 이어지는 줄 포함) 지문으로 둔다. 공백 두 칸은 {@code 푸트남  부인이 침대로 간다.} 같은 지문이 있어 보지 않는다.
     */
    private static Row speechOf(NumberedLine line, List<String> known) {
        String stripped = ScriptText.visible(line.text()).strip();
        for (String name : known) {
            if (!stripped.startsWith(name)) {
                continue;
            }
            int end = name.length();
            while (end < stripped.length() && " \t\u3000".indexOf(stripped.charAt(end)) >= 0) {
                end++;
            }
            String gap = stripped.substring(name.length(), end);
            boolean wide = gap.contains("\t") || gap.contains("\u3000") || gap.length() >= 3;
            if (!wide || end == stripped.length() || onlyBracketed(stripped.substring(end))) {
                return null;
            }
            return new Row(line.no(), Kind.DIALOGUE, name, stripped.substring(0, end));
        }
        return null;
    }

    /**
     * 줄 앞의 괄호 행동(앞에 다른 이름 머리가 있어도 된다) 뒤에 공백·말줄임표만 두고 화자 이름 + 공백·쌍점 + 말이 오면 {이름표 시작, 말 시작}
     * (보이는 글자, 앞 공백 뺀 위치). 아니면 null. 여럿이 함께 하는 화자는 보지 않는다.
     */
    private static int[] innerHead(String text, String speaker) {
        String shown = ScriptText.visible(text).stripLeading();
        int open = shown.indexOf('(');
        int close = shown.indexOf(')');
        if (speaker.isBlank() || open < 0 || close < open || MULTIPLE.matcher(speaker).find()) {
            return null;
        }
        int at = close + 1;
        while (at < shown.length() && (space(shown.charAt(at)) || ".…".indexOf(shown.charAt(at)) >= 0)) {
            at++;
        }
        int end = at + speaker.length();
        if (!shown.startsWith(speaker, at) || end >= shown.length() || !space(shown.charAt(end)) && ":：".indexOf(shown.charAt(end)) < 0) {
            return null;
        }
        while (end < shown.length() && (space(shown.charAt(end)) || ":：".indexOf(shown.charAt(end)) >= 0)) {
            end++;
        }
        return end < shown.length() ? new int[] {at, end} : null;
    }

    private static boolean onlyBracketed(String rest) {
        char open = rest.charAt(0);
        if (open != '(' && open != '[') {
            return false;
        }
        int close = rest.indexOf(open == '(' ? ')' : ']');
        return close < 0 || close == rest.length() - 1;
    }

    /** 머리를 뗀 본문. 운영 대본 여섯에 있던 줄 앞 U+200B 같은 보이지 않는 글자도 뗀다. */
    private static String body(String text, String header) {
        String stripped = ScriptText.visible(text).stripLeading();
        if (!header.isEmpty() && stripped.startsWith(ScriptText.visible(header).stripLeading())) {
            stripped = stripped.substring(ScriptText.visible(header).stripLeading().length());
        }
        return stripped.strip();
    }

    /** 등장인물 소개 줄에 처음 나타나는 순 → 나머지는 대사 많은 순, 같으면 먼저 말한 순. */
    private static List<String> order(List<Assembled> lines, List<String> castLines) {
        Map<String, int[]> seen = new LinkedHashMap<>();
        for (Assembled line : lines) {
            if (line.speaker != null) {
                seen.computeIfAbsent(line.speaker, name -> new int[] {seen.size(), 0})[1]++;
            }
        }
        Map<String, Integer> castPosition = new LinkedHashMap<>();
        for (int lineIndex = 0; lineIndex < castLines.size(); lineIndex++) {
            String squashed = CharacterNames.squash(castLines.get(lineIndex));
            for (String name : seen.keySet()) {
                int column = squashed.indexOf(CharacterNames.squash(name));
                if (column >= 0) {
                    castPosition.putIfAbsent(name, lineIndex * 10_000 + column);
                }
            }
        }
        List<String> names = new ArrayList<>(seen.keySet());
        names.sort(Comparator
                .comparing((String name) -> castPosition.getOrDefault(name, Integer.MAX_VALUE))
                .thenComparing(name -> -seen.get(name)[1])
                .thenComparing(name -> seen.get(name)[0]));
        return names;
    }

    /** 요청 제목 → 모델이 찾은 제목 → 확장자를 뺀 파일명 → 제목 없는 대본. 대사는 제목 후보가 아니다. */
    private static String title(String requested, String modelTitle, String fileName) {
        String title = requested != null && !requested.isBlank() ? requested.strip()
                : modelTitle != null && !modelTitle.isBlank() && !titlePageNumber(modelTitle) ? modelTitle.strip()
                : fileTitle(fileName);
        return title.codePointCount(0, title.length()) <= TITLE_MAX
                ? title : title.substring(0, title.offsetByCodePoints(0, TITLE_MAX));
    }

    private static boolean titlePageNumber(String text) {
        return pageNumber(text) || text.strip().matches("(?iu)(?:\\d+\\s*(?:쪽|페이지)|(?:쪽|페이지|page)\\s*\\d+)");
    }

    private static String fileTitle(String fileName) {
        if (fileName == null || fileName.isBlank()) return "제목 없는 대본";
        String name = fileName.substring(Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\')) + 1).strip();
        int dot = name.lastIndexOf('.');
        if (dot >= 0) name = name.substring(0, dot).strip();
        return name.isEmpty() ? "제목 없는 대본" : name;
    }

    private static final class Assembled {
        final String kind;
        String speaker;
        String text;
        /** 이 대사에 마지막으로 이은 원문 줄 — 다음 줄을 붙일지 띄울지 볼 때 끝 공백이 필요하다. */
        String lastLine;
        /** 대사 앞 지문으로 뗀 화면 밖 목소리 꼬리표. 꼬리표가 다른 줄은 잇지 않는다. */
        String tag;

        Assembled(String kind, String speaker, String text) {
            this.kind = kind;
            this.speaker = speaker;
            this.text = text;
        }
    }
}
