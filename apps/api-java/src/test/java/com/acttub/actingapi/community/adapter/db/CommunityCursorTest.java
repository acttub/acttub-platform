package com.acttub.actingapi.community.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import org.junit.jupiter.api.Test;

/**
 * 커서는 파이썬이 발급한 것과 <b>글자까지</b> 같아야 한다. 두 백엔드가 같은 목록을 이어서
 * 넘겨줄 수 있어야 하고, 커서는 그 사이를 오가는 유일한 상태이기 때문이다.
 *
 * <p>종전에 이 검증이 {@code CommunityEndpointIT} 안에 있었다. 스프링도 Postgres 도 필요 없는
 * 순수 왕복 검사인데 컨테이너를 띄우고 있었다 — 본문은 그대로 두고 자리만 옮겼다.
 */
class CommunityCursorTest {

    @Test
    void cursorParsesPythonOffsetLiteralAndEmitsTheSameOffsetSpelling() {
        String pythonIssued =
                "MjAyNi0wOC0wOFQwMTowMjowMy40NTY3ODkrMDA6MDB8"
                        + "MDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwNzc3";

        CommunityCursor.Cursor decoded = CommunityCursor.decode(pythonIssued);

        assertThat(decoded.createdAt())
                .isEqualTo(OffsetDateTime.of(2026, 8, 8, 1, 2, 3, 456789000, ZoneOffset.UTC));
        assertThat(decoded.id())
                .isEqualTo(UUID.fromString("00000000-0000-4000-8000-000000000777"));
        assertThat(CommunityCursor.encode(decoded.createdAt(), decoded.id()))
                .isEqualTo(pythonIssued);

        String zSpelling = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(
                "2026-08-08T01:02:03.456789Z|00000000-0000-4000-8000-000000000777"
                        .getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertThat(CommunityCursor.decode(zSpelling)).isEqualTo(decoded);
    }
}
