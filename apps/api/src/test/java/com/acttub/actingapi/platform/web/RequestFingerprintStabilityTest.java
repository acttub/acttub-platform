package com.acttub.actingapi.platform.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.feature.challenge.app.ChallengeRepository;
import com.acttub.actingapi.platform.config.JacksonConfig;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;
import org.springframework.context.annotation.Import;

/**
 * 멱등 요청의 지문(SHA-256 of {@link CanonicalJson})이 배포 전후로 같은지 본다(SOMA-1103). 기대값은 옮기기 전
 * (origin/dev, Jackson 2)의 앱 매퍼로 같은 입력을 돌려 얻은 값이다. 배포를 사이에 두고 같은 request_id 로 다시
 * 보낸 요청이 다른 지문이 되면 422 request_fingerprint_mismatch 가 난다.
 *
 * <p>입력은 서비스가 지문을 만드는 모양 그대로다: 레코드(속성 순서는 선언 순서), 목록, 키를 정렬하는 맵,
 * JsonNode. 글자는 이모지·따옴표·빗금·줄바꿈·제어 문자를 섞었다.
 */
@JsonTest
@Import(JacksonConfig.class)
class RequestFingerprintStabilityTest {

    private static final String TRICKY = "대사 🎭 \"따옴\" /빗금 \\역빗금\n줄\t탭\u001f끝";

    @Autowired
    ObjectMapper mapper;

    private String fingerprint(Object body) {
        return Hashing.sha256Hex(new CanonicalJson(mapper).bytes(body));
    }

    @Test
    @DisplayName("챌린지·참여·반응·리포트·대본 요청의 지문이 Jackson 2 때 값과 같다")
    void fingerprintsMatchTheValuesComputedWithJackson2() throws Exception {
        var draft = new ChallengeRepository.Draft(TRICKY, "작품/1", null, "장면\n메모 😀", 7);
        Map<String, Object> importPayload = new LinkedHashMap<>();
        importPayload.put("title", TRICKY);
        importPayload.put("source", "paste");
        importPayload.put("raw_text", "A: 안녕 🎭\nB: \"응\"");
        importPayload.put("allow_duplicate", false);
        importPayload.put("skip_script_check", true);
        Map<String, Object> line = new LinkedHashMap<>();
        line.put("speaker", "A");
        line.put("text", "안녕 😀");
        line.put("order", 1);
        line.put("note", null);
        Map<String, Object> createPayload = new LinkedHashMap<>();
        createPayload.put("title", "제목");
        createPayload.put("source", null);
        createPayload.put("raw_text", TRICKY);
        createPayload.put("characters", List.of("A", "B 🎭"));
        createPayload.put("lines", List.of(line));
        var entry = new ArrayList<>(Arrays.asList("6f1c0c8e-0000-4000-8000-000000000001",
                "6f1c0c8e-0000-4000-8000-000000000002", null, "public"));
        entry.add("face_mosaic");

        Map<String, String> actual = new LinkedHashMap<>();
        actual.put("challenge", fingerprint(draft));
        actual.put("challenge_team", fingerprint(Arrays.asList(draft, "2026-11-24")));
        actual.put("entry", fingerprint(entry));
        actual.put("comment", fingerprint(Arrays.asList("6f1c0c8e-0000-4000-8000-000000000003", TRICKY)));
        actual.put("report", fingerprint(Arrays.asList("entry", "6f1c0c8e-0000-4000-8000-000000000004", "spam", null)));
        actual.put("ai_report", fingerprint(List.of("challenge_report", "6f1c0c8e-0000-4000-8000-000000000005")));
        actual.put("script_import", fingerprint(Map.of("kind", "script_import", "payload", importPayload)));
        actual.put("script_create", fingerprint(Map.of("kind", "script_create", "payload", createPayload)));
        actual.put("tree", fingerprint(mapper.readTree("{\"b\":[1.50,2,null],\"a\":\"😀\",\"c\":{\"z\":true,\"y\":1e3}}")));

        assertThat(actual).isEqualTo(JACKSON2);
    }

    /** origin/dev(fdeb0fa04, Jackson 2.21)에서 같은 입력으로 뽑은 값. */
    private static final Map<String, String> JACKSON2 = Map.ofEntries(
            Map.entry("challenge", "ba9edacf5c920b650390d9311af373352f3cb69e2a23e69bd05921ec349c0d7f"),
            Map.entry("challenge_team", "38c4c5269a8bd6f86ced8308ddb4099ad197fa50afe995c8b59446579ca02b9f"),
            Map.entry("entry", "d18ff48156725a1065f28b0efab6eb9788df5116e29bc912ad237825cbfdc4ff"),
            Map.entry("comment", "e9d8253feae06f03794752f0f61627c114552249894d16c75758b000be1a7243"),
            Map.entry("report", "cc3fbddc191ef70159a818db26d72ce42fa2f96095c2906ce33b151c0c4a142a"),
            Map.entry("ai_report", "96befe5f58803e3a1a58ad7478776c377bae4e453b1f363dee3ec3d4a8df68e1"),
            Map.entry("script_import", "860dfa56c1e13eeee8e6fa52219fbe2dd206b5ee2e32836743f9044a1f14b866"),
            Map.entry("script_create", "41fbe2d55762e3e50d9beaec2065ec367e396bf93243681667202c698db40444"),
            Map.entry("tree", "cd35a47daddbae53e5eba15b6967399bcc15710120b6f429055759c2a78535a7"));
}
