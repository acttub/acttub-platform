package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.regex.Pattern;

/**
 * 나누기가 끝난 대본에서 여럿이 함께 말하는 화자를 묶음 배역으로 표시한다 (SOMA-709 1번).
 *
 * <ul>
 *   <li>화자가 「A, B」「A·B」「A/B」「A &amp; B」「A와 B」처럼 이 대본의 다른 배역 이름(띄어쓰기·대소문자 무시)만으로 되어 있으면 그 줄은 함께 말하는
 *       줄이고, 화자는 그 배역들을 품은 묶음 배역이다. 한 사람 몫의 배역은 새로 생기지 않는다.</li>
 *   <li>「모두」「다 같이」「전원」「일동」「all」은 대본의 모든 보통 배역이 함께 말하는 줄이다. 「합창」「코러스」는 따로 연기하는 배역일 수 있어 그대로 둔다.</li>
 *   <li>같은 배역들의 묶음은 순서·띄어쓰기·구분 부호가 달라도(「순이네,동진네」·「동진네, 순이네」) 하나다. 남기는 표기는 대사가 많은 쪽, 같으면 먼저 나온 쪽이다.</li>
 *   <li>묶음 배역은 보통 배역 뒤에 둔다. 옛 앱은 묶음 배역을 보통 배역처럼 보여 준다 — 저장 형식은 넓히기만 한다.</li>
 * </ul>
 * 이름 하나라도 다른 배역이 아니면(「엄마들, 앰버」에 「엄마들」 배역이 없으면) 보통 배역으로 둔다.
 */
public final class SpeakerGroups {

    /** 함께 말하기 이름의 사람 사이 구분 — 부호, 띄어 쓴 「와/과/and」, 한글 뒤에 붙인 「와/과」. */
    private static final Pattern SEPARATOR = Pattern.compile("(?iu)\\s*[,，/·•∙・&+、]\\s*|\\s+(?:와|과|and)\\s+|(?<=\\p{IsHangul})(?:와|과)\\s+");
    private static final Pattern EVERYONE = Pattern.compile("(?iu)모두|다같이|전원|일동|all|everyone");

    private SpeakerGroups() {
    }

    public static ScriptDraft apply(ScriptDraft draft) {
        List<String> names = draft.characterNames();
        Map<String, Integer> single = new HashMap<>();
        Map<Integer, TreeSet<Integer>> members = new LinkedHashMap<>();
        for (int k = 0; k < names.size(); k++) {
            if (!EVERYONE.matcher(key(names.get(k))).matches() && SEPARATOR.split(names.get(k).strip()).length < 2) {
                single.putIfAbsent(key(names.get(k)), k);
            }
        }
        for (int k = 0; k < names.size(); k++) {
            TreeSet<Integer> found = members(names.get(k), single);
            if (found != null) {
                members.put(k, found);
            }
        }
        // 「모두」는 보통 배역 모두다 — 다른 묶음을 가린 뒤에 센다.
        TreeSet<Integer> everyone = new TreeSet<>();
        for (int k = 0; k < names.size(); k++) {
            if (!members.containsKey(k)) {
                everyone.add(k);
            }
        }
        members.replaceAll((k, found) -> found.isEmpty() ? everyone : found);
        members.values().removeIf(found -> found.size() < 2);
        List<Integer> plain = new ArrayList<>();
        for (int k = 0; k < names.size(); k++) {
            if (!members.containsKey(k)) {
                plain.add(k);
            }
        }
        if (members.isEmpty()) {
            return draft;
        }
        Map<Integer, Integer> spoken = new HashMap<>();
        draft.lines().stream().filter(line -> line.characterIndex() != null).forEach(line -> spoken.merge(line.characterIndex(), 1, Integer::sum));
        // 같은 배역들의 묶음 → 남길 자리
        Map<TreeSet<Integer>, Integer> kept = new LinkedHashMap<>();
        members.forEach((k, found) -> kept.merge(found, k, (a, b) -> Comparator.<Integer, Integer>comparing(at -> -spoken.getOrDefault(at, 0))
                .thenComparing(at -> at).compare(a, b) <= 0 ? a : b));
        List<Integer> order = new ArrayList<>(plain);
        kept.values().stream().sorted().forEach(order::add);
        Map<Integer, Integer> moved = new HashMap<>();
        for (int at = 0; at < order.size(); at++) {
            moved.put(order.get(at), at);
        }
        members.forEach((k, found) -> moved.put(k, moved.get(kept.get(found))));
        List<String> nextNames = order.stream().map(names::get).toList();
        List<CharacterTraits> nextTraits = order.stream().map(draft.characterTraits()::get).toList();
        List<List<Integer>> nextMembers = order.stream().map(k -> members.containsKey(k) ? members.get(k).stream().map(moved::get).sorted().toList()
                : List.<Integer>of()).toList();
        List<ScriptDraft.Line> lines = draft.lines().stream().map(line -> line.characterIndex() == null ? line
                : new ScriptDraft.Line(line.ordinal(), line.kind(), moved.get(line.characterIndex()), line.text(), line.lang(), line.speech())).toList();
        return new ScriptDraft(draft.title(), draft.rawText(), draft.source(), nextNames, lines, nextTraits, nextMembers);
    }

    /** 묶음 배역이면 그 사람들의 자리, 「모두」면 빈 집합, 아니면 {@code null}. */
    private static TreeSet<Integer> members(String name, Map<String, Integer> single) {
        if (EVERYONE.matcher(key(name)).matches()) {
            return new TreeSet<>();
        }
        String[] parts = SEPARATOR.split(name.strip());
        if (parts.length < 2) {
            return null;
        }
        TreeSet<Integer> found = new TreeSet<>();
        for (String part : parts) {
            Integer k = single.get(key(part));
            if (k == null) {
                return null;
            }
            found.add(k);
        }
        return found;
    }

    private static String key(String name) {
        return CharacterNames.squash(name).toLowerCase();
    }
}
