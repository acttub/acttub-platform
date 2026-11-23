package com.acttub.actingapi.platform.http;

import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.web.client.RestClient;

/**
 * 바깥 API 를 부르는 {@link RestClient} 는 여기서만 만든다({@code RestClientsTest} 가 다른 자리를 막는다).
 *
 * <p>JSON 은 Jackson 2 로 읽고 쓴다. Spring 의 {@code RestClient.builder()} 는 Boot 설정을 거치지 않고 classpath 만
 * 보고 변환기를 고르는데, Flyway 12 가 Jackson 3 을 끌고 와서 Jackson 3 을 고른다. 그러면 Jackson 2 의
 * {@code JsonNode} 가 노드 속성 목록으로 직렬화되고 {@code @JsonNaming} 같은 Jackson 2 전용 주석이 무시된다.
 * 변환기는 Boot 3.5(Spring 6.2)의 {@code RestClient.builder()} 가 쓰던 것과 같은 기본 Jackson 2 변환기다.
 */
public final class RestClients {

    private RestClients() {
    }

    @SuppressWarnings("removal") // Jackson 2 변환기는 Spring 7 에서 지워질 예정이다. Jackson 3 으로 옮길 때 이 줄을 바꾼다.
    public static RestClient.Builder builder() {
        return RestClient.builder()
                .configureMessageConverters(converters -> converters.withJsonConverter(new MappingJackson2HttpMessageConverter()));
    }
}
