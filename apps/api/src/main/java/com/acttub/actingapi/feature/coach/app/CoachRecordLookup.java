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
        int offset = offset(request, matches.size());
        ObjectNode result = empty(VideoRecord.reference(record), matches.isEmpty() ? "not_found" : "ok");
        ArrayNode chosen = (ArrayNode) result.path("segments");
        int next = offset;
        Set<String> ids = new LinkedHashSet<>();
        for (; next < matches.size(); next++) {
            JsonNode segment = matches.get(next);
            Set<String> candidate = new LinkedHashSet<>(ids);
            addRefs(segment, candidate);
            ObjectNode proposed = result.deepCopy();
            ((ArrayNode) proposed.path("segments")).add(segment);
            fill(record, proposed, candidate, sourceIndex);
            if (proposed.toString().length() > MAX_RESULT_CHARS) break;
            chosen.add(segment);
            ids = candidate;
        }
        fill(record, result, ids, sourceIndex);
        ArrayNode ranges = (ArrayNode) result.path("searched_ranges");
        if ("query".equals(kind)) {
            ranges.add(VideoRecord.range(0, record.path("media").path("duration_ms").asLong()));
        } else {
            matches.forEach(segment -> ranges.add(VideoRecord.range(segment.path("start_ms").asLong(), segment.path("end_ms").asLong())));
        }
        boolean more = next < matches.size();
        result.put("has_more", more);
        if (more) {
            result.put("status", chosen.isEmpty() ? "unavailable" : "partial");
            if (!chosen.isEmpty()) result.put("continuation_token", token(request, next));
        }
        // 처리 누락도 조회 결과에 나타난다. 빈/누락 구간을 정상 관찰로 취급하지 않는다.
        if (!record.path("processing").path("missing_ranges").isEmpty()) result.put("record_status", "partial");
        return result;
    }

    public ObjectNode merge(ObjectNode current, JsonNode result) {
        ObjectNode next = current.deepCopy();
        Map<String, JsonNode> catalog = new LinkedHashMap<>();
        current.path("source_catalog").forEach(s -> catalog.put(s.path("id").asText(), s));
        result.path("source_catalog").forEach(s -> catalog.put(s.path("id").asText(), s));
        next.set("source_catalog", StructuredJson.MAPPER.valueToTree(catalog.values()));
        next.set("segments", result.path("segments"));
        next.set("speech", result.path("speech"));
        next.put("retrieval_status", result.path("status").asText());
        next.set("last_lookup", result);
        return next;
    }

    private static ObjectNode empty(JsonNode ref, String status) {
        ObjectNode result = StructuredJson.MAPPER.createObjectNode().put("status", status);
        result.set("record_ref", ref);
        result.putArray("searched_ranges");
        result.putArray("source_catalog");
        result.putArray("segments");
        ObjectNode speech = result.putObject("speech");
        speech.putArray("utterances");
        speech.putObject("word_timings").put("status", "unavailable").putArray("items");
        speech.putObject("word_gaps").put("status", "unavailable").putArray("items");
        result.put("has_more", false).putNull("continuation_token");
        return result;
    }

    private static void fill(JsonNode record, ObjectNode result, Set<String> ids, Map<String, JsonNode> sources) {
        ArrayNode catalog = result.putArray("source_catalog");
        ids.forEach(id -> { if (sources.containsKey(id)) catalog.add(sources.get(id)); });
        ObjectNode speech = (ObjectNode) result.path("speech");
        speech.set("status", record.path("speech").path("status"));
        ArrayNode utterances = speech.putArray("utterances");
        record.path("speech").path("utterances").forEach(u -> { if (ids.contains(u.path("id").asText())) utterances.add(u); });
        for (String kind : List.of("word_timings", "word_gaps")) {
            ObjectNode detail = speech.putObject(kind);
            detail.set("status", record.path("speech").path(kind).path("status"));
            ArrayNode items = detail.putArray("items");
            for (JsonNode item : record.path("speech").path(kind).path("items")) {
                for (JsonNode segment : result.path("segments")) {
                    if (VideoRecord.overlaps(item, segment)) { items.add(item); break; }
                }
            }
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
                    || !value.path("include_neighbors").equals(request.path("include_neighbors"))) {
                throw new IllegalArgumentException("invalid lookup continuation");
            }
            return offset;
        } catch (RuntimeException failure) {
            throw new IllegalArgumentException("invalid lookup continuation", failure);
        }
    }
}
