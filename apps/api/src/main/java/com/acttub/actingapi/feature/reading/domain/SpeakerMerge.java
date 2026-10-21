package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 조립이 끝난 대본의 배역 후보를 원문 전체의 쓰임으로 기존 역할에 대응시킨다 (SOMA-663 H4 → R2).
 *
 * <ul>
 *   <li>후보: 규칙으로 묶이지 않은 「같은 사람일 수 있는」 쌍(띄어쓰기 없앤 한 이름이 다른 이름에 들어 있거나 편집 거리 1)에서 대사가 적은 쪽,
 *       그리고 대사가 {@link #RARE} 개 이하인 이름이다. 숫자·A~E 한 글자만 다른 쌍과 함께 말하기 이름은 쌍으로 보지 않는다. 1만 자당
 *       {@link #PER_10K} 개(최소 그만큼)까지, 쌍 후보·대사 적은 후보 먼저다.</li>
 *   <li>보기 역할: 짝 이름, 후보가 붙은 원문 줄이 시작하는 배역 이름, 그 줄 앞뒤 대사의 배역이다. 다른 후보는 보기에 넣지 않는다(짝이
 *       모두 후보면 짝은 남긴다). 배역 정책상 다른 배역(한쪽에만 내레이션 꼬리, 숫자만 다름, 한쪽에만 가족·나이 낱말)도 보기에 넣지 않는다.
 *       2026-10-20 개발 묶음에서 이런 쌍이 Jev 확신 0.7 이상 잘못 합침의 전부였다.</li>
 *   <li>묻는 것: 후보가 기존 역할(같은 인물의 다른 표기·화면 밖 목소리, 또는 이름 자리 글이 그 역할의 말)인지, 독립 배역인지, 배역이
 *       아닌지(지문·메모·쪽 번호·문장부호), 판단 보류인지. 두 이름의 비슷함만 묻던 H4 는 맞은 답이 적었다(A4 「ROSTER」).</li>
 *   <li>근거에 후보가 쓰인 장면의 말하는 배역을 넣고, 보기 순서를 바꿔 두 번 물어 확률을 평균한다(R2b). 2026-10-21 개발 묶음에서 장면 근거가
 *       「운전자 2」→「운전자기」 같은 다른 번호 사람 합침을 막았고, 이름이 줄 글 전체인 후보는 지문으로 돌린다.</li>
 *   <li>적용: 확신이 문턱 이상이면 기존 역할로 합치거나(남는 이름은 그 역할) 그 줄을 지문으로 바꾸고 배역을 지운다. 방향이 있는 대응이라
 *       「쥴리아」·「슐리아」·「졸리아」처럼 서로 다 짝이 아닌 묶음도 한 역할로 모인다.</li>
 * </ul>
 */
public final class SpeakerMerge {

    public static final String QUESTION = "role";
    public static final String OWN = "own";
    public static final String NONE = "none";
    public static final String UNSURE = "unsure";
    private static final String ROLE = "r";
    /** 대사가 이 수 이하인 이름은 짝이 없어도 묻는다 — 한 번 나온 오타·문장·문장부호 이름이 여기 든다. */
    static final int RARE = 2;
    static final int PER_10K = 8;
    static final int MAX_ROLES = 6;
    private static final Pattern PARENTHESIS = Pattern.compile("[(（]([^()（）]+)[)）]");

    private static final Pattern NARRATION = Pattern.compile("(?iu)(?:\\(\\s*(?:NA|N\\.A\\.|N)\\s*\\)|NA|N\\.A\\.|내레이션|나레이션)\\s*$");
    private static final Pattern KIN = Pattern.compile("부인|엄마|아빠|아내|남편|딸|아들|언니|오빠|누나|형|동생|어린|젊은|늙은|할머니|할아버지|어머니|아버지|꼬마|모$|부$");
    private static final Pattern SMALL_DIFFERENCE = Pattern.compile("[0-9A-Ea-e]");
    private static final int START_LINES = 15;
    private static final int SCENE_MAX = 150;
    private static final int SCENE_WINDOW = 40;
    private static final int SCENE_SPEAKERS = 10;

    private SpeakerMerge() {
    }

    /**
     * 묻는 후보 하나. {@code roles} 는 보기 역할(값 {@code r0}…), {@code state} 는 판단 모델에 보내는 글이다.
     *
     * @param wholeLine 이름이 그 이름이 붙은 단 한 원문 줄의 글 전체다 — 모델이 줄 글을 화자 칸에 옮겨 썼다(156 「엥 그런게 있네」). 이름이 아니므로
     *        기존 역할로 합치지 않으면 지문으로 바꾼다
     * @param actors 후보 줄의 원문 머리 괄호 안에 이름이 적힌 보기 역할(「민수(태수)」의 「태수」) — 그 역할이 연기하는 다른 역일 수 있다
     */
    public record Candidate(String name, List<String> roles, String state, boolean wholeLine, List<String> actors) {
        public Candidate(String name, List<String> roles, String state) {
            this(name, roles, state, false, List.of());
        }

        public String instructions() {
            return "대본 전체의 배역 목록을 검증한다. 나누기 결과의 배역 후보 「" + name + "」가 가리키는 역할을 고른다. 원문이 명시한 배우 이름은 극중 "
                    + "배역과 구분한다. 표기 오타·화면 밖 목소리는 같은 역할로 합치고 내레이션·다른 극중 역할은 별도 배역으로 둔다.";
        }

        /** @param reversed 보기 역할을 거꾸로 늘어놓는다 — 값({@code r0}…)은 그대로라 두 답을 바로 견줄 수 있다 */
        public List<LineReview.Choice> choices(boolean reversed) {
            List<LineReview.Choice> choices = new ArrayList<>();
            for (int i = 0; i < roles.size(); i++) {
                int k = reversed ? roles.size() - 1 - i : i;
                String role = roles.get(k);
                choices.add(new LineReview.Choice(ROLE + k, role, "후보는 「" + role + "」와 같은 역할이다 — 오타·띄어쓰기·글자 깨짐·배우 이름 덧붙임·화면 밖 "
                        + "목소리 표기이거나, 이름 자리 글이 실제로는 「" + role + "」의 말이다."));
            }
            // 배우 근거가 있는 후보에만 덧붙인다 — 모든 후보의 보기 글을 바꾼 안은 표기 변형 합침 확신을 흔들었다(SOMA-663 M6).
            String acted = actors.stream().map(actor -> " 후보 머리 괄호 안의 「" + actor + "」가 극 안에서 연기하는 역도 독립 배역이다.")
                    .collect(Collectors.joining());
            choices.add(new LineReview.Choice(OWN, "독립 배역",
                    "후보는 따로 둔 역할이다. 내레이션·어린 시절·가족(부인·엄마)·번호가 다른 사람·한 배우가 맡은 다른 역도 독립 배역이다." + acted));
            choices.add(new LineReview.Choice(NONE, "배역 아님", "후보는 이름이 아닌 문장·메모·쪽 번호·문장부호·조사이고, 보기 역할 누구의 말도 아니다."));
            choices.add(new LineReview.Choice(UNSURE, "판단 보류", "주어진 원문 근거로 알 수 없다."));
            return choices;
        }
    }

    /**
     * @param speakers 대사가 된 원문 줄 번호 → 조립이 정한 화자 이름({@link SplitDraft.Assembly#speakers})
     * @param heads 대사가 된 원문 줄 번호 → 그 줄의 원문 머리({@link SplitDraft.Assembly#heads})
     */
    public static List<Candidate> candidates(ScriptDraft draft, List<NumberedLine> lines, Map<Integer, String> speakers,
            Map<Integer, String> heads, Set<Integer> scenes) {
        Map<String, Integer> count = new HashMap<>();
        for (ScriptDraft.Line line : draft.lines()) {
            if (line.characterIndex() != null) {
                count.merge(draft.characterNames().get(line.characterIndex()), 1, Integer::sum);
            }
        }
        Set<String> all = new HashSet<>(draft.characterNames());
        // 띄어 쓴 다른 배역 이름들뿐인 이름(「주혁 승욱 정배」)은 함께 말하기다 — 한 사람에 합치면 말한 사람이 준다.
        List<String> names = draft.characterNames().stream().filter(name -> !ScriptRules.isGroupName(name) && count.containsKey(name)
                && !(name.strip().contains(" ") && all.containsAll(List.of(name.strip().split("\\s+"))))).toList();
        Map<String, List<String>> partners = new LinkedHashMap<>();
        for (int i = 0; i < names.size(); i++) {
            for (int j = i + 1; j < names.size(); j++) {
                String a = names.get(i);
                String b = names.get(j);
                if (candidate(a, b) && !keptApart(a, b)) {
                    boolean aMinor = count.get(a) < count.get(b) || count.get(a).equals(count.get(b)) && a.length() > b.length();
                    partners.computeIfAbsent(aMinor ? a : b, name -> new ArrayList<>()).add(aMinor ? b : a);
                }
            }
        }
        Set<String> asked = new LinkedHashSet<>();
        partners.keySet().stream().sorted(Comparator.comparing(count::get)).forEach(asked::add);
        names.stream().filter(name -> count.get(name) <= RARE).sorted(Comparator.comparing(count::get)).forEach(asked::add);
        int chars = lines.stream().mapToInt(line -> line.text().length()).sum();
        int limit = Math.max(PER_10K, PER_10K * chars / 10_000);
        TreeMap<Integer, String> bySource = new TreeMap<>(speakers);
        List<String> chosen = asked.stream().limit(limit).toList();
        List<Candidate> candidates = new ArrayList<>();
        for (String name : chosen) {
            List<Integer> used = bySource.entrySet().stream().filter(entry -> entry.getValue().equals(name)).map(Map.Entry::getKey).toList();
            Set<String> roles = new LinkedHashSet<>(partners.getOrDefault(name, List.of()));
            // 원문 줄이 다른 배역 이름으로 시작하면 그 배역이 먼저다 — 「테클라 싫증이 났어!」가 「Т_FINAL」에 붙었다(076).
            for (int no : used) {
                String head = key(lines.stream().filter(line -> line.no() == no).findFirst().map(NumberedLine::text).orElse(""));
                names.stream().filter(other -> !other.equals(name) && head.startsWith(key(other))).forEach(roles::add);
            }
            for (int no : used) {
                neighbour(bySource.headMap(no, false).descendingMap(), name, names).ifPresent(roles::add);
                neighbour(bySource.tailMap(no, false), name, names).ifPresent(roles::add);
            }
            // 다른 후보는 보기에 넣지 않는다 — 「류비 마리아」의 보기에 「한별 마리아」가, 「줄리아」의 보기에 「슐리아」가 있으면 확률이 「마리아」·「쥴리아」와
            // 갈린다(2026-10-21 개발 묶음). 짝이 모두 후보면(「엑스타라2」·「엑스트라2」 둘 다 대사 하나) 짝은 남긴다.
            List<String> paired = partners.getOrDefault(name, List.of());
            boolean keepPaired = paired.stream().allMatch(chosen::contains);
            roles.removeIf(role -> !names.contains(role) || chosen.contains(role) && !(keepPaired && paired.contains(role)) || keptApart(name, role));
            List<String> options = roles.stream().limit(MAX_ROLES).toList();
            boolean wholeLine = used.size() == 1 && lines.stream().filter(line -> line.no() == used.getFirst()).findFirst()
                    .map(line -> CharacterNames.squash(line.text()).equals(CharacterNames.squash(name))).orElse(false);
            Map<String, String> actors = new LinkedHashMap<>();
            for (String role : options) {
                used.stream().map(no -> heads.getOrDefault(no, "")).filter(head -> actor(head, role)).findFirst().ifPresent(head -> actors.put(role, head));
            }
            candidates.add(new Candidate(name, options, state(name, options, count, used, lines, bySource, actors, new TreeSet<>(scenes)), wholeLine,
                    List.copyOf(actors.keySet())));
        }
        return candidates;
    }

    private static Optional<String> neighbour(Map<Integer, String> side, String name, List<String> names) {
        return side.values().stream().filter(other -> !other.equals(name) && names.contains(other)).findFirst();
    }

    static boolean candidate(String a, String b) {
        String sa = key(a);
        String sb = key(b);
        if (sa.equals(sb)) {
            return false;
        }
        if (sa.contains(sb) || sb.contains(sa)) {
            return true;
        }
        if (Math.min(sa.codePointCount(0, sa.length()), sb.codePointCount(0, sb.length())) < 2 || CharacterNames.editDistance(sa, sb) != 1) {
            return false;
        }
        Set<Integer> difference = new HashSet<>();
        sa.codePoints().forEach(difference::add);
        Set<Integer> other = new HashSet<>();
        sb.codePoints().forEach(other::add);
        Set<Integer> both = new HashSet<>(difference);
        both.retainAll(other);
        difference.addAll(other);
        difference.removeAll(both);
        return !difference.stream().allMatch(point -> SMALL_DIFFERENCE.matcher(Character.toString(point)).matches());
    }

    /** 배역 정책상 다른 배역 — 보기에 넣지 않는다. */
    static boolean keptApart(String a, String b) {
        if (NARRATION.matcher(a).find() != NARRATION.matcher(b).find()) {
            return true;
        }
        if (key(a).replaceAll("\\d", "").equals(key(b).replaceAll("\\d", ""))) {
            return true;
        }
        return !kin(key(a)).equals(kin(key(b)));
    }

    private static Set<String> kin(String name) {
        Set<String> words = new HashSet<>();
        Matcher found = KIN.matcher(name);
        while (found.find()) {
            words.add(found.group());
        }
        return words;
    }

    private static String key(String name) {
        return name.replaceAll("[\\s:：]+", "").toLowerCase();
    }

    /**
     * 후보 이름·대사 수·원문 머리 줄 수, 대본 첫 {@link #START_LINES} 줄(등장인물 소개·일러두기), 후보가 붙은 원문 줄 셋(처음·가운데·끝)과 앞
     * 세 줄·뒤 두 줄, 보기 역할마다 대사 수·원문 머리 줄 수와 첫 쓰임·후보에 가장 가까운 쓰임. 원문 줄 앞 [이름] 은 지금 그 줄이 붙은 배역이고, 후보
     * 자신의 줄에는 달지 않는다. 후보 줄의 실제 머리 괄호 안 이름이 보기 역할이면({@code actors}: 역할 → 머리) 그렇다고 적는다(배우와 극중 역할) — 「민수(태수)」
     * 줄의 민수가 배우 태수로 합쳐졌다(SOMA-663 M6). 실제 머리 표기·줄 수, 머리에서 찾은 보기, 「보기에 없는 사람의 말」 보기를 더한 안은 표기
     * 변형 합침 확신을 문턱 언저리에서 흔들어 개발 세 판 오류 대본이 줄지 않았다(2026-10-21, 「친구 1」·「친구기」 .71 → .58).
     */
    static String state(String name, List<String> roles, Map<String, Integer> count, List<Integer> used, List<NumberedLine> lines,
            TreeMap<Integer, String> bySource, Map<String, String> actors, TreeSet<Integer> scenes) {
        List<String> raw = lines.stream().map(NumberedLine::text).toList();
        Map<Integer, Integer> at = new HashMap<>();
        for (int k = 0; k < lines.size(); k++) {
            at.put(lines.get(k).no(), k);
        }
        StringBuilder out = new StringBuilder("배역 후보 「").append(name).append("」: 대사 ").append(count.get(name)).append("개, 원문에서 이 이름으로 시작하는 줄 ")
                .append(heads(name, raw)).append("개. 줄 앞 [이름] 은 지금 그 줄이 붙은 배역이다.\n");
        actors.forEach((role, head) -> out.append("후보 머리 「").append(head).append("」의 괄호 안 「").append(role).append("」는 보기 역할 이름이다.\n"));
        out.append("\n대본 시작:\n");
        Set<Integer> picks = new LinkedHashSet<>();
        if (!used.isEmpty()) {
            picks.add(used.getFirst());
            picks.add(used.get(used.size() / 2));
            picks.add(used.getLast());
        }
        Set<Integer> shown = new HashSet<>();
        for (int k = 0; k < Math.min(START_LINES, lines.size()); k++) {
            out.append(picks.contains(lines.get(k).no()) ? "▶ " : "").append(labeled(lines.get(k), bySource, 90, name)).append('\n');
            shown.add(k);
        }
        out.append("\n후보가 붙은 곳(▶):\n");
        for (int no : picks) {
            Integer k = at.get(no);
            if (k == null) {
                continue;
            }
            for (int j = Math.max(0, k - 3); j <= Math.min(raw.size() - 1, k + 2); j++) {
                if (shown.add(j)) {
                    out.append(j == k ? "▶ " : "").append(labeled(lines.get(j), bySource, 90, name)).append('\n');
                }
            }
        }
        Set<String> sceneLines = new LinkedHashSet<>();
        for (int no : picks) {
            sceneLines.add(scene(no, lines, bySource, scenes));
        }
        if (!sceneLines.isEmpty()) {
            out.append("\n후보가 쓰인 장면과 그 장면에서 말하는 배역(대사 줄 수):\n");
            sceneLines.forEach(line -> out.append("- ").append(line).append('\n'));
        }
        int near = used.isEmpty() ? 0 : used.getFirst();
        for (String role : roles) {
            List<Integer> own = bySource.entrySet().stream().filter(entry -> entry.getValue().equals(role)).map(Map.Entry::getKey).toList();
            out.append("\n보기 「").append(role).append("」: 대사 ").append(count.getOrDefault(role, 0)).append("개, 원문 머리 ").append(heads(role, raw))
                    .append("개\n");
            if (own.isEmpty()) {
                continue;
            }
            int closest = own.stream().min(Comparator.comparing(no -> Math.abs(no - near))).orElseThrow();
            for (int no : new LinkedHashSet<>(List.of(own.getFirst(), closest))) {
                Integer k = at.get(no);
                if (k != null) {
                    out.append(labeled(lines.get(k), bySource, 80, name)).append('\n');
                }
            }
        }
        return out.toString().stripTrailing();
    }

    /**
     * 원문 줄 {@code no} 가 든 장면 — 장면 머리 줄 사이다. 장면 머리가 없거나 장면이 {@link #SCENE_MAX} 줄보다 길면 앞뒤 {@link #SCENE_WINDOW}
     * 줄이다. 그 안에서 말하는 배역을 대사 줄이 많은 순으로 {@link #SCENE_SPEAKERS} 개까지 단다.
     */
    private static String scene(int no, List<NumberedLine> lines, TreeMap<Integer, String> bySource, TreeSet<Integer> scenes) {
        int first = lines.getFirst().no();
        int last = lines.getLast().no();
        Integer head = scenes.floor(no);
        Integer next = scenes.higher(no);
        int start = head == null ? first : head;
        int end = next == null ? last : next - 1;
        String title = head == null ? "" : lines.stream().filter(line -> line.no() == head).findFirst().map(line -> " 「" + cut(line.text().strip(), 40) + "」")
                .orElse("");
        if (end - start + 1 > SCENE_MAX) {
            start = Math.max(first, no - SCENE_WINDOW);
            end = Math.min(last, no + SCENE_WINDOW);
            title = "";
        }
        Map<String, Integer> said = new HashMap<>();
        bySource.subMap(start, true, end, true).values().forEach(speaker -> said.merge(speaker, 1, Integer::sum));
        String speakers = said.entrySet().stream().sorted(Map.Entry.<String, Integer>comparingByValue().reversed()).limit(SCENE_SPEAKERS)
                .map(entry -> entry.getKey() + " " + entry.getValue()).collect(Collectors.joining(", "));
        return "L" + start + "~L" + end + title + ": " + speakers;
    }

    /** 후보 자신의 줄에는 [이름] 을 달지 않는다 — 지금 붙은 이름이 독립 배역의 근거처럼 읽혔다(156 메모가 붙은 「…선생」, SOMA-663 X1). */
    private static String labeled(NumberedLine line, Map<Integer, String> bySource, int max, String candidate) {
        String speaker = bySource.get(line.no());
        speaker = candidate.equals(speaker) ? null : speaker;
        return "L" + line.no() + ": " + (speaker == null ? "" : "[" + speaker + "] ") + cut(line.text().strip(), max);
    }

    private static long heads(String name, List<String> raw) {
        return raw.stream().filter(line -> key(line).startsWith(key(name))).count();
    }

    /** 머리의 괄호 안이 그 역할 이름인가(「민수(태수)」·「햄릿 (돈결)」). */
    static boolean actor(String head, String role) {
        Matcher inner = PARENTHESIS.matcher(head);
        while (inner.find()) {
            if (key(inner.group(1)).equals(key(role)) && !key(head).startsWith(key(role))) {
                return true;
            }
        }
        return false;
    }

    private static String cut(String text, int max) {
        int points = text.codePointCount(0, text.length());
        return points <= max ? text : text.substring(0, text.offsetByCodePoints(0, max));
    }

    /**
     * 보기 순서를 바꿔 두 번 물은 답의 보기별 확률 평균에서 가장 높은 보기와 그 확률. 하나라도 못 받았으면 {@code null} 이다. 두 답이 같을 때만
     * 쓰는 안은 2026-10-21 개발 묶음에서 평균보다 오류 대본이 많았다(41 대 38).
     */
    public static LineReview.Answer mean(Map<String, Double> first, Map<String, Double> second) {
        if (first == null || second == null) {
            return null;
        }
        Map<String, Double> mean = new LinkedHashMap<>();
        first.forEach((choice, p) -> mean.merge(choice, p / 2, Double::sum));
        second.forEach((choice, p) -> mean.merge(choice, p / 2, Double::sum));
        return mean.entrySet().stream().max(Map.Entry.comparingByValue()).map(best -> new LineReview.Answer(best.getKey(), best.getValue()))
                .orElse(null);
    }

    /**
     * 확신이 {@code threshold} 이상인 답을 적용한 대본: 기존 역할이면 그 역할로 합치고, 배역 아님이면 그 대사를 지문으로 바꾸고 배역을 지운다.
     * 바꿀 것이 없으면 그대로 돌려준다.
     *
     * @param answers 후보 → 답. 답을 못 받은 후보는 값이 {@code null} 이다
     */
    public static ScriptDraft apply(ScriptDraft draft, Map<Candidate, LineReview.Answer> answers, double threshold) {
        Map<String, String> target = new HashMap<>();
        Set<String> dropped = new HashSet<>();
        answers.forEach((candidate, answer) -> {
            boolean confident = answer != null && answer.confidence() >= threshold;
            if (candidate.wholeLine() && !(confident && answer.choice().matches(ROLE + "\\d+"))) {
                dropped.add(candidate.name());
                return;
            }
            if (!confident) {
                return;
            }
            if (answer.choice().equals(NONE)) {
                dropped.add(candidate.name());
            } else if (answer.choice().matches(ROLE + "\\d+")) {
                int k = Integer.parseInt(answer.choice().substring(ROLE.length()));
                if (k < candidate.roles().size()) {
                    target.put(candidate.name(), candidate.roles().get(k));
                }
            }
        });
        Map<String, String> parent = new HashMap<>();
        for (String name : target.keySet()) {
            String root = root(target, name);
            // 서로 가리키는 후보(돌고 도는 대응)와 배역 아님이 된 역할로 가는 대응은 버린다.
            if (root != null && !dropped.contains(root)) {
                parent.put(name, root);
            }
        }
        if (parent.isEmpty() && dropped.isEmpty()) {
            return draft;
        }
        List<String> names = new ArrayList<>();
        Map<String, CharacterTraits> traits = new LinkedHashMap<>();
        // 남긴 이름의 성별·나이대가 모름이면 합쳐진 이름의 것을 잇는다.
        for (int k = 0; k < draft.characterNames().size(); k++) {
            String own = draft.characterNames().get(k);
            String kept = parent.getOrDefault(own, own);
            if (dropped.contains(kept)) {
                continue;
            }
            if (!names.contains(kept)) {
                names.add(kept);
            }
            CharacterTraits value = draft.characterTraits().get(k);
            boolean ownKnown = kept.equals(own) && !value.equals(CharacterTraits.UNKNOWN);
            if (ownKnown || traits.getOrDefault(kept, CharacterTraits.UNKNOWN).equals(CharacterTraits.UNKNOWN)) {
                traits.put(kept, value);
            }
        }
        List<ScriptDraft.Line> lines = draft.lines().stream().map(line -> {
            if (line.characterIndex() == null) {
                return line;
            }
            String own = draft.characterNames().get(line.characterIndex());
            String kept = parent.getOrDefault(own, own);
            return dropped.contains(kept) ? new ScriptDraft.Line(line.ordinal(), "direction", null, line.text())
                    : new ScriptDraft.Line(line.ordinal(), line.kind(), names.indexOf(kept), line.text());
        }).toList();
        return new ScriptDraft(draft.title(), draft.rawText(), draft.source(), names, lines, names.stream().map(traits::get).toList());
    }

    /** 대응을 끝까지 따라간 역할. 돌고 돌면 {@code null}. */
    private static String root(Map<String, String> target, String name) {
        Set<String> seen = new HashSet<>(Set.of(name));
        String at = target.get(name);
        while (target.containsKey(at)) {
            if (!seen.add(at)) {
                return null;
            }
            at = target.get(at);
        }
        return at.equals(name) ? null : at;
    }
}
