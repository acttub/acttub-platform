package com.acttub.actingapi.feature.analysis.adapter.media;

import java.io.IOException;
import java.net.http.HttpClient;
import java.time.Duration;

import org.springframework.core.io.FileSystemResource;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

final class RestClientOpenAiTranscriptionTransport
        implements OpenAiAudioTranscriber.OpenAiTranscriptionTransport {
    private final RestClient client;

    RestClientOpenAiTranscriptionTransport(Duration timeout) {
        HttpClient httpClient = HttpClient.newBuilder().connectTimeout(timeout).build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(timeout);
        this.client = RestClient.builder().requestFactory(requestFactory).build();
    }

    @Override
    public OpenAiAudioTranscriber.TranscriptionResponse exchange(
            OpenAiAudioTranscriber.TranscriptionRequest request) throws IOException {
        org.springframework.http.client.MultipartBodyBuilder parts =
                new org.springframework.http.client.MultipartBodyBuilder();
        parts.part("model", request.model());
        parts.part("response_format", request.responseFormat());
        parts.part("prompt", request.prompt());
        parts.part(request.fileField(), new FileSystemResource(request.audioPath()))
                .filename(request.fileName())
                .contentType(MediaType.parseMediaType(request.fileContentType()));
        MultiValueMap<String, String> headers = new LinkedMultiValueMap<>();
        request.headers().forEach(headers::add);
        try {
            return client.post()
                    .uri(request.uri())
                    .headers(target -> target.addAll(headers))
                    .contentType(MediaType.MULTIPART_FORM_DATA)
                    .body(parts.build())
                    .exchange((ignored, response) ->
                            new OpenAiAudioTranscriber.TranscriptionResponse(
                                    response.getStatusCode().value(),
                                    new String(response.getBody().readAllBytes(),
                                            java.nio.charset.StandardCharsets.UTF_8)));
        } catch (ResourceAccessException exception) {
            throw new IOException(exception.getMessage(), exception);
        }
    }
}
