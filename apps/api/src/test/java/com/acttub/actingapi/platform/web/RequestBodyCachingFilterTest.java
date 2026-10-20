package com.acttub.actingapi.platform.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.util.StreamUtils;

class RequestBodyCachingFilterTest {

    @Test
    void cachedBodyCanBeReadAgainAsStreamAndAsReader() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/v2/anything");
        request.setContentType("application/json");
        request.setContent("{\"title\":\"장면\"}".getBytes(StandardCharsets.UTF_8));
        List<String> reads = new ArrayList<>();

        new RequestBodyCachingFilter().doFilter(request, new MockHttpServletResponse(), (wrapped, response) -> {
            HttpServletRequest http = (HttpServletRequest) wrapped;
            ServletInputStream stream = http.getInputStream();
            assertThat(stream.isReady()).isTrue();
            assertThat(stream.isFinished()).isFalse();
            reads.add(new String(StreamUtils.copyToByteArray(stream), StandardCharsets.UTF_8));
            assertThat(stream.isFinished()).isTrue();
            reads.add(readAll(http));
        });

        assertThat(reads).containsExactly("{\"title\":\"장면\"}", "{\"title\":\"장면\"}");
    }

    @Test
    void multipartIsPassedThroughWithoutReadingTheBody() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/v2/anything");
        request.setContentType("Multipart/form-data; boundary=x");
        request.setContent("--x--".getBytes(StandardCharsets.UTF_8));
        List<Object> seen = new ArrayList<>();

        new RequestBodyCachingFilter().doFilter(request, new MockHttpServletResponse(),
                (wrapped, response) -> seen.add(wrapped));

        assertThat(seen).containsExactly(request);
    }

    private static String readAll(HttpServletRequest request) throws IOException {
        StringBuilder text = new StringBuilder();
        try (var reader = request.getReader()) {
            reader.lines().forEach(text::append);
        }
        return text.toString();
    }
}
