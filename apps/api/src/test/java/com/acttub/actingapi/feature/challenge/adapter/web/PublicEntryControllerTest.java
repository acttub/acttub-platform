package com.acttub.actingapi.feature.challenge.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import java.time.Clock;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.app.EntryMedia;
import com.acttub.actingapi.feature.challenge.app.EntryRepository;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.PublicEntry;
import com.acttub.actingapi.feature.challenge.app.EntryService;
import com.acttub.actingapi.platform.security.ClientAddress;
import com.acttub.actingapi.platform.security.FixedWindowRateLimiter;
import com.acttub.actingapi.platform.web.ApiErrorAdvice;
import com.acttub.actingapi.platform.web.CanonicalJson;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/**
 * 참여작 공유 링크의 공개 조회(challenge.share). 응답의 모양과 404·429 를 DB 없이 본다 — 어떤 참여작이 보이는지는
 * {@code ChallengeEntryIT} 가 실제 Postgres 로 본다.
 */
class PublicEntryControllerTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private final EntryRepository entries = mock(EntryRepository.class);
    private final EntryService service =
            new EntryService(entries, mock(EntryMedia.class), new CanonicalJson(JSON), Clock.systemUTC());
    private final MockMvc mvc = MockMvcBuilders
            .standaloneSetup(new PublicEntryController(service, new FixedWindowRateLimiter(), new ClientAddress("")))
            .setControllerAdvice(new ApiErrorAdvice(JSON, new RecordingFailureReporter()))
            .build();

    @Test
    void publicEntryShowsOnlyTheSceneAndNeverTheAuthor() throws Exception {
        UUID id = UUID.randomUUID();
        when(entries.publicEntry(id)).thenReturn(new PublicEntry("햄릿", "죽느냐 사느냐", "햄릿"));

        MockHttpServletResponse response = mvc.perform(get("/v2/public/entries/{id}", id)).andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getHeader("X-Robots-Tag")).isEqualTo("noindex, nofollow");
        JsonNode body = JSON.readTree(response.getContentAsString());
        assertThat(body).isEqualTo(JSON.readTree("""
                {"work":"햄릿","line":"죽느냐 사느냐","character":"햄릿","poster_url":null}"""));
    }

    @Test
    void characterIsNullWhenTheChallengeHasNone() throws Exception {
        UUID id = UUID.randomUUID();
        when(entries.publicEntry(id)).thenReturn(new PublicEntry("창작", "대사", null));

        JsonNode body = JSON.readTree(mvc.perform(get("/v2/public/entries/{id}", id)).andReturn().getResponse()
                .getContentAsString());

        assertThat(body.has("character")).isTrue();
        assertThat(body.path("character").isNull()).isTrue();
    }

    @Test
    void hiddenOrMissingEntriesAreTheSameNotFound() throws Exception {
        UUID id = UUID.randomUUID();
        when(entries.publicEntry(id)).thenReturn(null);

        MockHttpServletResponse response = mvc.perform(get("/v2/public/entries/{id}", id)).andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(404);
        assertThat(JSON.readTree(response.getContentAsString()).path("detail").asText()).isEqualTo("entry_not_found");
    }

    @Test
    void eachVisitorAddressGetsSixtyLookupsAMinute() throws Exception {
        UUID id = UUID.randomUUID();
        when(entries.publicEntry(id)).thenReturn(new PublicEntry("햄릿", "대사", null));

        List<Integer> statuses = new java.util.ArrayList<>();
        for (int i = 0; i < 61; i++) {
            statuses.add(mvc.perform(get("/v2/public/entries/{id}", id).with(request -> {
                request.setRemoteAddr("203.0.113.7");
                return request;
            })).andReturn().getResponse().getStatus());
        }
        assertThat(statuses.subList(0, 60)).containsOnly(200);
        assertThat(statuses.get(60)).isEqualTo(429);

        int other = mvc.perform(get("/v2/public/entries/{id}", id).with(request -> {
            request.setRemoteAddr("203.0.113.8");
            return request;
        })).andReturn().getResponse().getStatus();
        assertThat(other).isEqualTo(200);
    }
}
