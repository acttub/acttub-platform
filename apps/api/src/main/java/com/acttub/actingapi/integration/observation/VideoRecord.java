package com.acttub.actingapi.integration.observation;

import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.integration.llm.StructuredJson;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
import com.acttub.actingapi.platform.json.LenientJson;

/** 원본 시각·출처·누락 범위를 보존하는 1층 정본. 모델의 해석을 관찰로 승격하지 않는다. */
public final class VideoRecord {
    public static final String VERSION = "acttub.video_record.v1";
    private static final List<String> GROUPS = List.of("subjects", "utterances", "segments", "events", "limitations");

    private VideoRecord() {
    }

    public static boolean isRecord(JsonNode value) {
        return value != null && VERSION.equals(LenientJson.asText(value.path("schema_version")));
    }

    public static ObjectNode reference(JsonNode record) {
        if (!isRecord(record)) {
            throw new IllegalArgumentException("video record is unavailable");
        }
        ObjectNode result = StructuredJson.MAPPER.createObjectNode();
        result.set("record_id", record.path("record_id"));
        result.set("version", record.path("record_version"));
        result.set("duration_ms", record.path("media").path("duration_ms"));
        return result;
    }

    /** 구간 참조는 관찰의 시간 범위에서 계산하는 색인이다. 관찰 자체는 수정하지 않는다. */
    public static ObjectNode prepareChunk(JsonNode value, String chunkId, long duration) {
        StructuredJson.validate("layer1_chunk", value);
        ObjectNode prepared = value.deepCopy();
        for (JsonNode segment : prepared.path("segments")) {
            for (String group : List.of("utterances", "events", "limitations")) {
                String key = switch (group) {
                    case "utterances" -> "utterance_ids";
                    case "events" -> "event_ids";
                    default -> "limitation_ids";
                };
                ArrayNode refs = ((ObjectNode) segment).putArray(key);
                for (JsonNode item : prepared.path(group)) {
                    if (overlaps(segment, item)) refs.add(LenientJson.asText(item.path("id")));
                }
            }
        }
        validateChunk(prepared, chunkId, duration);
        return prepared;
    }

    public static void validateChunk(JsonNode value, String chunkId, long duration) {
        StructuredJson.validate("layer1_chunk", value);
        require(chunkId.equals(LenientJson.asText(value.path("chunk_id"))), "wrong chunk ID");
        Map<String, Set<String>> ids = new HashMap<>();
        Set<String> allIds = new HashSet<>();
        for (String group : GROUPS) {
            Set<String> groupIds = new HashSet<>();
            for (JsonNode item : value.path(group)) {
                String id = LenientJson.asText(item.path("id"));
                require(allIds.add(id), "duplicate chunk ID");
                groupIds.add(id);
                if (!"subjects".equals(group)) {
                    require(LenientJson.asLong(item.path("start_ms")) < LenientJson.asLong(item.path("end_ms"))
                            && LenientJson.asLong(item.path("end_ms")) <= duration, "invalid observation range");
                }
            }
            ids.put(group, groupIds);
        }
        long cursor = 0;
        for (JsonNode segment : value.path("segments")) {
            require(LenientJson.asLong(segment.path("start_ms")) == cursor, "incomplete chunk coverage");
            cursor = LenientJson.asLong(segment.path("end_ms"));
            for (String group : List.of("utterances", "events", "limitations")) {
                String key = switch (group) {
                    case "utterances" -> "utterance_ids";
                    case "events" -> "event_ids";
                    default -> "limitation_ids";
                };
                Set<String> expected = new HashSet<>();
                for (JsonNode item : value.path(group)) {
                    if (overlaps(segment, item)) {
                        expected.add(LenientJson.asText(item.path("id")));
                    }
                }
                require(strings(segment.path(key)).equals(expected), "incorrect segment references");
            }
            boolean partial = !"recorded".equals(LenientJson.asText(segment.path("channel_status").path("visual")))
                    || !"recorded".equals(LenientJson.asText(segment.path("channel_status").path("audio")));
            require(!partial || !segment.path("limitation_ids").isEmpty(), "missing channel limitation");
        }
        require(cursor == duration, "missing final interval");
        for (String group : List.of("utterances", "events", "limitations")) {
            for (JsonNode item : value.path(group)) {
                for (String key : List.of("subject_id", "speaker_id")) {
                    if (item.hasNonNull(key)) {
                        require(ids.get("subjects").contains(LenientJson.asText(item.path(key))), "unknown subject");
                    }
                }
                if (item.has("utterance_ids")) {
                    require(ids.get("utterances").containsAll(strings(item.path("utterance_ids"))), "unknown utterance");
                }
                if (item.has("timing_basis")) {
                    require("estimated".equals(LenientJson.asText(item.path("timing_basis"))), "unverified aligned timing");
                }
            }
        }
        for (JsonNode event : value.path("events")) {
            String dimension = LenientJson.asText(event.path("dimension"));
            if (Set.of("gaze", "face", "movement").contains(dimension)) {
                require("visual".equals(LenientJson.asText(event.path("channel"))), "wrong visual channel");
            } else if (Set.of("speech", "voice", "rhythm").contains(dimension)) {
                require("audio".equals(LenientJson.asText(event.path("channel"))), "wrong audio channel");
            }
        }
    }

    public static ObjectNode empty(UUID id, long duration, boolean audio, ActorMaterial actor) {
        ObjectNode root = StructuredJson.MAPPER.createObjectNode();
        root.put("schema_version", VERSION).put("record_id", id.toString()).put("record_version", 1);
        root.putObject("media").put("duration_ms", duration).put("audio_track_present", audio).put("time_mapping", "identity");
        ObjectNode processing = root.putObject("processing").put("status", "ready");
        processing.putArray("processed_ranges");
        processing.putArray("missing_ranges");
        ObjectNode context = root.putObject("actor_context");
        if (!actor.situation().isBlank()) context.put("situation", actor.situation());
        if (!actor.character().isBlank()) context.put("character_context", actor.character());
        if (!actor.goal().isBlank()) context.put("goal", actor.goal());
        ObjectNode overview = root.putObject("overview");
        overview.putArray("observed_scene");
        overview.putArray("spoken_content");
        root.putArray("subjects");
        ObjectNode speech = root.putObject("speech").put("status", audio ? "recorded" : "no_audio");
        speech.putArray("utterances");
        speech.putObject("word_timings").put("status", "unavailable").putArray("items");
        speech.putObject("word_gaps").put("status", "unavailable").putArray("items");
        root.putArray("segments");
        root.putArray("events");
        root.putArray("limitations");
        return root;
    }

    public static void append(ObjectNode record, JsonNode chunk, long offset) {
        String prefix = LenientJson.asText(chunk.path("chunk_id")) + ":";
        Map<String, String> ids = new HashMap<>();
        for (String group : GROUPS) {
            for (JsonNode item : chunk.path(group)) {
                ids.put(LenientJson.asText(item.path("id")), prefix + LenientJson.asText(item.path("id")));
            }
        }
        for (String group : GROUPS) {
            ArrayNode target = "utterances".equals(group)
                    ? (ArrayNode) record.path("speech").path("utterances") : (ArrayNode) record.path(group);
            for (JsonNode item : chunk.path(group)) {
                ObjectNode mapped = item.deepCopy();
                mapped.put("id", ids.get(LenientJson.asText(item.path("id"))));
                if (mapped.has("start_ms")) {
                    mapped.put("start_ms", LenientJson.asLong(item.path("start_ms")) + offset);
                    mapped.put("end_ms", LenientJson.asLong(item.path("end_ms")) + offset);
                }
                for (String key : List.of("speaker_id", "subject_id")) {
                    if (mapped.hasNonNull(key)) mapped.put(key, ids.get(LenientJson.asText(mapped.path(key))));
                }
                for (String key : List.of("utterance_ids", "event_ids", "limitation_ids")) {
                    if (mapped.has(key)) {
                        ArrayNode refs = StructuredJson.MAPPER.createArrayNode();
                        item.path(key).forEach(ref -> refs.add(ids.get(LenientJson.asText(ref))));
                        mapped.set(key, refs);
                    }
                }
                target.add(mapped);
            }
        }
        long end = LenientJson.asLong(chunk.path("segments").get(chunk.path("segments").size() - 1).path("end_ms")) + offset;
        ((ArrayNode) record.path("processing").path("processed_ranges")).add(range(offset, end));
    }

    public static void missing(ObjectNode record, long start, long end) {
        ((ObjectNode) record.path("processing")).put("status", "partial");
        ((ObjectNode) record.path("speech")).put("status", "partial");
        ((ArrayNode) record.path("processing").path("missing_ranges")).add(range(start, end));
        String id = "missing:" + start;
        addLimitation(record, id, start, end, "extraction", "해당 구간의 영상 관찰 처리를 완료하지 못했다.");
        ObjectNode segment = ((ArrayNode) record.path("segments")).addObject().put("id", "segment:" + id);
        segment.put("start_ms", start).put("end_ms", end);
        segment.putArray("utterance_ids");
        segment.putArray("event_ids");
        segment.putArray("limitation_ids").add(id);
        segment.putObject("channel_status").put("visual", "unavailable").put("audio", "unavailable");
    }

    public static void finish(ObjectNode record, SpeechAnalysis analysis) {
        int duration = LenientJson.asInt(record.path("media").path("duration_ms"));
        boolean audio = LenientJson.asBoolean(record.path("media").path("audio_track_present"));
        if (record.path("processing").path("processed_ranges").isEmpty()) {
            throw new SummaryParseError("no usable video record chunks");
        }
        if (audio && analysis != null && analysis.words().stream().allMatch(w -> w.end() * 1000 <= duration + 1)
                && analysis.words().stream().allMatch(w -> Double.isFinite(w.start()) && Double.isFinite(w.end())
                        && w.start() >= 0 && w.end() > w.start())
                && (!analysis.words().isEmpty() || analysis.transcript().isBlank())) {
            ObjectNode speech = (ObjectNode) record.path("speech");
            speech.put("reference_transcript", analysis.transcript());
            ObjectNode timing = (ObjectNode) speech.path("word_timings");
            ObjectNode gaps = (ObjectNode) speech.path("word_gaps");
            timing.put("status", "recorded");
            gaps.put("status", "recorded");
            for (int i = 0; i < analysis.words().size(); i++) {
                var word = analysis.words().get(i);
                ((ArrayNode) timing.path("items")).addObject().put("id", "word:" + i).put("text", word.word())
                        .put("start_ms", Math.round(word.start() * 1000)).put("end_ms", Math.round(word.end() * 1000))
                        .put("timing_basis", "aligned");
                if (i > 0) {
                    var before = analysis.words().get(i - 1);
                    if (word.start() > before.end()) {
                        ((ArrayNode) gaps.path("items")).addObject().put("start_ms", Math.round(before.end() * 1000))
                                .put("end_ms", Math.round(word.start() * 1000)).put("before_word_id", "word:" + (i - 1))
                                .put("after_word_id", "word:" + i).put("kind", "word_gap");
                    }
                }
            }
            String observed = normalized(record.path("speech").path("utterances").findValuesAsString("text").stream()
                    .collect(java.util.stream.Collectors.joining("")));
            if (!normalized(analysis.transcript()).equals(observed)) {
                addLimitation(record, "transcription:disagreement", 0, duration, "conflict",
                        "원본 받아쓰기와 영상 관찰의 대사 전사가 일치하지 않는다. 두 자료를 구분해서 읽어야 한다.");
                speech.put("status", "partial");
            }
        } else if (audio) {
            addLimitation(record, "transcription:unavailable", 0, duration, "extraction",
                    "원본 받아쓰기의 단어별 시각을 확보하지 못했다. 영상 관찰의 대사는 추정 시각이다.");
        }
        if (!audio) {
            addLimitation(record, "audio:absent", 0, duration, "audibility", "원본 영상에 음성 트랙이 없다.");
        }
        // 개요는 실제 관찰/대사의 발췌다. 원본 목록은 모두 유지하며 코칭 조회가 사용한다.
        ArrayNode scene = (ArrayNode) record.path("overview").path("observed_scene");
        for (JsonNode event : record.path("events")) {
            if (scene.size() >= 4) break;
            if ("visual".equals(LenientJson.asText(event.path("channel")))) {
                scene.add(grounded(LenientJson.asText(event.path("description")), LenientJson.asText(event.path("id"))));
            }
        }
        ArrayNode spoken = (ArrayNode) record.path("overview").path("spoken_content");
        for (JsonNode utterance : record.path("speech").path("utterances")) {
            if (spoken.size() >= 4) break;
            spoken.add(grounded(LenientJson.asText(utterance.path("text")), LenientJson.asText(utterance.path("id"))));
        }
        for (JsonNode segment : record.path("segments")) {
            ArrayNode refs = ((ObjectNode) segment).putArray("limitation_ids");
            for (JsonNode limit : record.path("limitations")) {
                if (overlaps(segment, limit)) refs.add(LenientJson.asText(limit.path("id")));
            }
        }
        long cursor = 0;
        for (JsonNode segment : record.path("segments")) {
            require(LenientJson.asLong(segment.path("start_ms")) == cursor, "incomplete assembled record");
            cursor = LenientJson.asLong(segment.path("end_ms"));
        }
        require(cursor == duration, "missing assembled tail");
    }

    public static Map<String, JsonNode> sources(JsonNode record) {
        Map<String, JsonNode> result = new LinkedHashMap<>();
        if (!isRecord(record)) return result;
        for (String group : List.of("utterances", "events", "limitations")) {
            JsonNode items = "utterances".equals(group) ? record.path("speech").path(group) : record.path(group);
            String kind = switch (group) {
                case "utterances" -> "video_utterance";
                case "events" -> "video_observation";
                default -> "record_limitation";
            };
            for (JsonNode item : items) {
                ObjectNode source = StructuredJson.MAPPER.createObjectNode();
                source.put("id", LenientJson.asText(item.path("id"))).put("kind", kind)
                        .put("text", LenientJson.asText(item.path("text"), LenientJson.asText(item.path("description"))));
                source.set("record_id", record.path("record_id"));
                source.set("record_version", record.path("record_version"));
                source.set("start_ms", item.path("start_ms"));
                source.set("end_ms", item.path("end_ms"));
                result.put(LenientJson.asText(source.path("id")), source);
            }
        }
        return result;
    }

    public static ObjectNode range(long start, long end) {
        return StructuredJson.MAPPER.createObjectNode().put("start_ms", start).put("end_ms", end);
    }

    public static boolean overlaps(JsonNode left, JsonNode right) {
        return LenientJson.asLong(left.path("start_ms")) < LenientJson.asLong(right.path("end_ms"))
                && LenientJson.asLong(right.path("start_ms")) < LenientJson.asLong(left.path("end_ms"));
    }

    public static ObjectNode grounded(String text, String ref) {
        ObjectNode result = StructuredJson.MAPPER.createObjectNode().put("text", text);
        result.putArray("source_refs").add(ref);
        return result;
    }

    private static void addLimitation(ObjectNode record, String id, long start, long end, String kind, String text) {
        ObjectNode item = ((ArrayNode) record.path("limitations")).addObject().put("id", id)
                .put("start_ms", start).put("end_ms", end).putNull("subject_id").put("kind", kind).put("description", text);
        item.putArray("dimensions").add("speech").add("voice").add("breath").add("rhythm");
        if (id.startsWith("missing:")) {
            ((ArrayNode) item.path("dimensions")).add("gaze").add("face").add("movement");
        }
    }

    private static Set<String> strings(JsonNode values) {
        Set<String> result = new HashSet<>();
        values.forEach(value -> result.add(LenientJson.asText(value)));
        return result;
    }

    private static String normalized(String text) {
        return text.replaceAll("[\\s\\p{Punct}\\p{P}]", "");
    }

    private static void require(boolean valid, String reason) {
        if (!valid) throw new IllegalArgumentException(reason);
    }
}
