package com.acttub.actingapi.integration.llm;

import java.io.IOException;
import java.net.http.HttpClient;
import java.time.Duration;

import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

final class RestClientOpenAiTransport implements OpenAiHttpTransport {

    private final RestClient client;

    RestClientOpenAiTransport(Duration timeout) {
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(timeout)
                .build();
        JdkClientHttpRequestFactory requestFactory =
                new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(timeout);
        this.client = RestClient.builder()
                .requestFactory(requestFactory)
                .build();
    }

    @Override
    public OpenAiHttpResponse exchange(OpenAiHttpRequest request) throws IOException {
        try {
            return client.post()
                    .uri(request.uri())
                    .headers(headers -> request.headers().forEach(headers::set))
                    .body(request.body())
                    .exchange((ignored, response) -> new OpenAiHttpResponse(
                            response.getStatusCode().value(),
                            new String(response.getBody().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)));
        } catch (ResourceAccessException exc) {
            throw new IOException(exc.getMessage(), exc);
        }
    }
}
