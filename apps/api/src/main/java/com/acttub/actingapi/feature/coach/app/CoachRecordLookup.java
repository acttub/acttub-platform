package com.acttub.actingapi.feature.coach.app;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.observation.VideoRecord;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** 소유권이 검증된 세션의 메모리상 기록만 조회한다. URL·S3·영상 분석 접근은 없다. */
public final class CoachRecordLookup {
    static final int MAX_RESULT_CHARS = 24_000;

    public ObjectNode initial(JsonNode record) {
        ObjectNode view = StructuredJson.MAPPER.createObjectNode();
        if (!VideoRecord.isRecord(record)) {
            view.putNull("record_ref");
            view.putObject("overview");
            view.putArray("utterance_index");
            view.putArray("source_catalog");
            view.putObject("coverage").put("status", "failed");
            view.put("retrieval_status", "unavailable");
            return view;
        }
        view.set("record_ref", VideoRecord.reference(record));
        view.set("overview", record.path("overview"));
        view.set("coverage", record.path("processing"));
        ArrayNode index = view.putArray("utterance_index");
        int chars = 0;
        for (JsonNode utterance : record.path("speech").path("utterances")) {
            if (chars + utterance.toString().length() > 8_000) break;
            index.add(utterance);
            chars += utterance.toString().length();
        }
        view.put("utterance_index_complete", index.size() == record.path("speech").path("utterances").size());
        Map<String, JsonNode> sources = VideoRecord.sources(record);
        Set<String> ids = new LinkedHashSet<>();
        index.forEach(item -> ids.add(item.path("id").asText()));
        record.path("overview").findValues("source_refs").forEach(refs -> refs.forEach(id -> ids.add(id.asText())));
        ArrayNode catalog = view.putArray("source_catalog");
        ids.forEach(id -> { if (sources.containsKey(id)) catalog.add(sources.get(id)); });
        view.put("retrieval_status", "index_only");
        return view;
    }

    public ObjectNode lookup(JsonNode record, JsonNode request) {
        if (!VideoRecord.isRecord(record)) {
            return empty(request.path("record_ref"), "unavailable");
        }
        if (!VideoRecord.reference(record).equals(request.path("record_ref"))) {
            throw new IllegalArgumentException("lookup record is not the session record");
        }
        JsonNode selector = request.path("selector");
        String kind = selector.path("kind").asText();
        List<JsonNode> matches = new ArrayList<>();
        JsonNode wantedUtterance = null;
        if ("utterance".equals(kind)) {
            for (JsonNode utterance : record.path("speech").path("utterances")) {
                if (utterance.path("id").asText().equals(selector.path("utterance_id").asText())) wantedUtterance = utterance;
            }
        }
        if ("range".equals(kind) && (selector.path("end_ms").asLong() <= selector.path("start_ms").asLong()
                || selector.path("end_ms").asLong() > record.path("media").path("duration_ms").asLong())) {
            throw new IllegalArgumentException("lookup range is outside the record");
        }
        Map<String, JsonNode> sourceIndex = VideoRecord.sources(record);
        ArrayNode segments = (ArrayNode) record.path("segments");
        Set<Integer> positions = new java.util.TreeSet<>();
        for (int i = 0; i < segments.size(); i++) {
            JsonNode segment = segments.get(i);
            boolean match = switch (kind) {
                case "range" -> VideoRecord.overlaps(segment, selector);
                case "utterance" -> wantedUtterance != null && VideoRecord.overlaps(segment, wantedUtterance);
                case "query" -> matchesText(segment, sourceIndex, selector.path("text").asText());
                default -> throw new IllegalArgumentException("unknown lookup selector");
            };
            if (match) {
                positions.add(i);
                if (request.path("include_neighbors").asBoolean()) {
                    if (i > 0) positions.add(i - 1);
                    if (i + 1 < segments.size()) positions.add(i + 1);
                }
            }
        }
        positions.forEach(i -> matches.add(segments.get(i)));
        List<Fact> facts = facts(record, matches, request.path("dimensions"));
        int offset = offset(request, facts.size());
        ObjectNode result = empty(VideoRecord.reference(record), matches.isEmpty() ? "not_found" : "ok");
        ArrayNode ranges = (ArrayNode) result.path("searched_ranges");
        if ("query".equals(kind)) {
            ranges.add(VideoRecord.range(0, record.path("media").path("duration_ms").asLong()));
        } else {
            for (JsonNode segment : matches) {
                long start = segment.path("start_ms").asLong(), end = segment.path("end_ms").asLong();
                ObjectNode last = ranges.isEmpty() ? null : (ObjectNode) ranges.get(ranges.size() - 1);
                if (last != null && last.path("end_ms").asLong() >= start) last.put("end_ms", end);
                else ranges.add(VideoRecord.range(start, end));
            }
        }
        int next = offset;
        for (; next < facts.size(); next++) {
            ObjectNode proposed = result.deepCopy();
            addFact(proposed, facts.get(next), sourceIndex, record);
            // 조회 상태와 커서도 예산에 포함한다. 한 구간의 관찰/단어가 많아도 사실 단위로 진전한다.
            pagination(proposed, request, next + 1, facts.size());
            if (proposed.toString().length() > MAX_RESULT_CHARS - 100) break;
            result = proposed;
        }
        pagination(result, request, next, facts.size());
        if (next == offset && next < facts.size()) {
            result.put("status", "unavailable").putNull("continuation_token");
            result.put("reason", "single_fact_exceeds_budget");
        }
        // 처리 누락도 조회 결과에 나타난다. 빈/누락 구간을 정상 관찰로 취급하지 않는다.
        if (!record.path("processing").path("missing_ranges").isEmpty()) result.put("record_status", "partial");
        return result;
    }

    /**
     * 조회 결과를 record_view 에 누적한다. 한 응답에서 조회를 두 번 하면 두 번째 결과가 첫 번째 근거를
     * 덮어쓰지 않아야 모델이 앞서 본 구간을 계속 인용할 수 있다(설계 §6 "결과를 다음 생성 입력에 실제로 넣는다").
     * 구간은 id 로 합치고 참조 목록은 합집합이다. 마지막 조회의 상태·커서는 last_lookup 에 그대로 둔다.
     */
    public ObjectNode merge(ObjectNode current, JsonNode result) {
        ObjectNode next = current.deepCopy();
        unionById(arrayAt(next, "source_catalog"), result.path("source_catalog"));
        for (JsonNode segment : result.path("segments")) {
            ObjectNode existing = byId(arrayAt(next, "segments"), segment.path("id"));
            if (existing == null) {
                arrayAt(next, "segments").add(segment.deepCopy());
                continue;
            }
            for (String field : List.of("utterance_ids", "event_ids", "limitation_ids")) {
                unionByValue(arrayAt(existing, field), segment.path(field));
            }
        }
        unionById(arrayAt(next, "events"), result.path("events"));
        unionById(arrayAt(next, "limitations"), result.path("limitations"));
        ObjectNode speech = objectAt(next, "speech");
        if (result.path("speech").has("status")) speech.set("status", result.path("speech").path("status"));
        unionById(arrayAt(speech, "utterances"), result.path("speech").path("utterances"));
        for (String field : List.of("word_timings", "word_gaps")) {
            ObjectNode target = objectAt(speech, field);
            if (result.path("speech").path(field).has("status")) {
                target.set("status", result.path("speech").path(field).path("status"));
            }
            unionByValue(arrayAt(target, "items"), result.path("speech").path(field).path("items"));
        }
        next.put("retrieval_status", result.path("status").asText());
        next.set("last_lookup", result);
        return next;
    }

    private static ArrayNode arrayAt(ObjectNode parent, String field) {
        return parent.path(field).isArray() ? (ArrayNode) parent.path(field) : parent.putArray(field);
    }

    private static ObjectNode objectAt(ObjectNode parent, String field) {
        return parent.path(field).isObject() ? (ObjectNode) parent.path(field) : parent.putObject(field);
    }

    private static ObjectNode byId(ArrayNode items, JsonNode id) {
        for (JsonNode item : items) if (item.path("id").equals(id)) return (ObjectNode) item;
        return null;
    }

    private static void unionById(ArrayNode into, JsonNode added) {
        for (JsonNode item : added) if (byId(into, item.path("id")) == null) into.add(item.deepCopy());
    }

    private static void unionByValue(ArrayNode into, JsonNode added) {
        for (JsonNode item : added) {
            boolean present = false;
            for (JsonNode existing : into) if (existing.equals(item)) present = true;
            if (!present) into.add(item.deepCopy());
        }
    }

    private static ObjectNode empty(JsonNode ref, String status) {
        ObjectNode result = StructuredJson.MAPPER.createObjectNode().put("status", status);
        result.set("record_ref", ref);
        result.putArray("searched_ranges");
        result.putArray("source_catalog");
        result.putArray("segments");
        result.putArray("events");
        result.putArray("limitations");
        ObjectNode speech = result.putObject("speech");
        speech.putArray("utterances");
        speech.putObject("word_timings").put("status", "unavailable").putArray("items");
        speech.putObject("word_gaps").put("status", "unavailable").putArray("items");
        result.put("has_more", false).putNull("continuation_token");
        return result;
    }

    private record Fact(JsonNode segment, String field, JsonNode value) { }

    private static List<Fact> facts(JsonNode record, List<JsonNode> segments, JsonNode dimensions) {
        Set<String> wanted = new LinkedHashSet<>();
        dimensions.forEach(d -> wanted.add(d.asText()));
        Map<String, JsonNode> detail = new LinkedHashMap<>();
        for (String field : List.of("events", "limitations")) {
            record.path(field).forEach(item -> detail.put(item.path("id").asText(), item));
        }
        record.path("speech").path("utterances").forEach(item -> detail.put(item.path("id").asText(), item));
        List<Fact> facts = new ArrayList<>();
        Set<String> delivered = new LinkedHashSet<>();
        for (JsonNode segment : segments) {
            facts.add(new Fact(segment, "segment", segment));
            for (String field : List.of("utterance_ids", "event_ids", "limitation_ids")) {
                for (JsonNode id : segment.path(field)) {
                    JsonNode item = detail.get(id.asText());
                    if (item == null) continue;
                    if (field.equals("event_ids") && !wanted.isEmpty()
                            && !wanted.contains(item.path("dimension").asText())) continue;
                    facts.add(new Fact(segment, field, item));
                }
            }
            if (wanted.isEmpty() || wanted.stream().anyMatch(Set.of("speech", "rhythm", "voice", "breath")::contains)) {
                for (String field : List.of("word_timings", "word_gaps")) {
                    int index = 0;
                    for (JsonNode item : record.path("speech").path(field).path("items")) {
                        if (VideoRecord.overlaps(item, segment) && delivered.add(field + ":" + index)) {
                            facts.add(new Fact(segment, field, item));
                        }
                        index++;
                    }
                }
            }
        }
        return facts;
    }

    private static void addFact(ObjectNode result, Fact fact, Map<String, JsonNode> sources, JsonNode record) {
        ArrayNode segments = (ArrayNode) result.path("segments");
        ObjectNode segment = null;
        for (JsonNode item : segments) {
            if (item.path("id").equals(fact.segment().path("id"))) segment = (ObjectNode) item;
        }
        if (segment == null) {
            segment = fact.segment().deepCopy();
            for (String field : List.of("utterance_ids", "event_ids", "limitation_ids")) segment.putArray(field);
            // 원본 구간의 전체 참조 목록으로 오해하지 않게 페이지별 참조임을 표시한다.
            segment.put("refs_scope", "this_page");
            segments.add(segment);
        }
        ObjectNode speech = (ObjectNode) result.path("speech");
        speech.set("status", record.path("speech").path("status"));
        for (String field : List.of("word_timings", "word_gaps")) {
            ((ObjectNode) speech.path(field)).set("status", record.path("speech").path(field).path("status"));
        }
        if (fact.field().equals("segment")) return;
        if (fact.field().endsWith("_ids")) {
            String id = fact.value().path("id").asText();
            ((ArrayNode) segment.path(fact.field())).add(id);
            ArrayNode catalog = (ArrayNode) result.path("source_catalog");
            boolean exists = false;
            for (JsonNode source : catalog) if (source.path("id").asText().equals(id)) exists = true;
            if (!exists && sources.containsKey(id)) {
                catalog.add(sources.get(id));
                switch (fact.field()) {
                    case "utterance_ids" -> ((ArrayNode) speech.path("utterances")).add(fact.value());
                    case "event_ids" -> ((ArrayNode) result.path("events")).add(fact.value());
                    case "limitation_ids" -> ((ArrayNode) result.path("limitations")).add(fact.value());
                    default -> throw new IllegalArgumentException("unknown fact kind");
                }
            }
        } else {
            ((ArrayNode) speech.path(fact.field()).path("items")).add(fact.value());
        }
    }

    private static void pagination(ObjectNode result, JsonNode request, int next, int size) {
        boolean more = next < size;
        result.put("has_more", more);
        if (more) {
            result.put("status", "partial").put("continuation_token", token(request, next));
        } else {
            result.putNull("continuation_token");
            if (!result.path("segments").isEmpty()) result.put("status", "ok");
        }
    }

    private static void addRefs(JsonNode segment, Set<String> ids) {
        for (String field : List.of("utterance_ids", "event_ids", "limitation_ids")) {
            segment.path(field).forEach(id -> ids.add(id.asText()));
        }
    }

    private static boolean matchesText(JsonNode segment, Map<String, JsonNode> sources, String query) {
        if (query.isBlank()) throw new IllegalArgumentException("empty lookup query");
        Set<String> ids = new LinkedHashSet<>();
        addRefs(segment, ids);
        String text = ids.stream().map(sources::get).filter(java.util.Objects::nonNull)
                .map(source -> source.path("text").asText()).collect(java.util.stream.Collectors.joining(" "))
                .toLowerCase(java.util.Locale.ROOT);
        return java.util.Arrays.stream(query.toLowerCase(java.util.Locale.ROOT).strip().split("\\s+"))
                .allMatch(text::contains);
    }

    private static String token(JsonNode request, int offset) {
        ObjectNode value = StructuredJson.MAPPER.createObjectNode().put("offset", offset);
        value.set("record_ref", request.path("record_ref"));
        value.set("selector", request.path("selector"));
        value.set("include_neighbors", request.path("include_neighbors"));
        value.set("dimensions", request.path("dimensions"));
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static int offset(JsonNode request, int size) {
        if (!request.hasNonNull("continuation_token")) return 0;
        try {
            JsonNode value = StructuredJson.parse(new String(Base64.getUrlDecoder().decode(
                    request.path("continuation_token").asText()), StandardCharsets.UTF_8));
            int offset = value.path("offset").asInt(-1);
            if (offset < 0 || offset >= size || !value.path("record_ref").equals(request.path("record_ref"))
                    || !value.path("selector").equals(request.path("selector"))
                    || !value.path("include_neighbors").equals(request.path("include_neighbors"))
                    || !value.path("dimensions").equals(request.path("dimensions"))) {
                throw new IllegalArgumentException("invalid lookup continuation");
            }
            return offset;
        } catch (RuntimeException failure) {
            throw new IllegalArgumentException("invalid lookup continuation", failure);
        }
    }
}
