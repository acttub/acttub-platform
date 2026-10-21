package com.acttub.actingapi.platform.web;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.Filter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.ContentCachingRequestWrapper;

/**
 * 본문 캐시 필터({@link RequestBodyCachingFilter})가 빠진 경우의 폴백. 오류의 종류와 위치는 그대로이고, 되돌려 줄
 * {@code input} 은 Spring 의 부분 캐시가 있으면 거기서, 그것도 없으면 빈 본문으로 읽는다.
 */
class ApiErrorAdviceBodyFallbackTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    private static MockMvc mvc(Filter... filters) {
        return MockMvcBuilders.standaloneSetup(new ItemController())
                .setControllerAdvice(new ApiErrorAdvice(JSON, new RecordingFailureReporter()))
                .addFilters(filters)
                .build();
    }

    private static String post(MockMvc mvc, String body) throws Exception {
        var response = mvc.perform(MockMvcRequestBuilders.post("/items").contentType(MediaType.APPLICATION_JSON)
                .content(body)).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(422);
        return response.getContentAsString();
    }

    @Test
    void withoutAnyBodyCacheTheErrorKeepsItsShapeAndEchoesAnEmptyBody() throws Exception {
        assertThat(JSON.readTree(post(mvc(), "{\"count\":3}"))).isEqualTo(JSON.readTree("""
                {"detail":[{"type":"missing","loc":["body","name"],"msg":"Field required","input":{}}]}
                """));
    }

    @Test
    void springsPartialCacheSuppliesTheInputWhenOurFilterIsMissing() throws Exception {
        Filter partialCache = (request, response, chain) ->
                chain.doFilter(new ContentCachingRequestWrapper((HttpServletRequest) request), response);

        assertThat(JSON.readTree(post(mvc(partialCache), "{\"count\":3}"))).isEqualTo(JSON.readTree("""
                {"detail":[{"type":"missing","loc":["body","name"],"msg":"Field required","input":{"count":3}}]}
                """));
    }

    @RestController
    static class ItemController {
        @PostMapping("/items")
        void create(@Valid @RequestBody Item item) {
        }
    }

    record Item(@NotNull String name, Integer count) {
    }
}
