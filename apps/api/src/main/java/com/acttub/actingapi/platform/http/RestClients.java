package com.acttub.actingapi.platform.http;

import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.json.JsonMapper;

/**
 * 바깥 API 를 부르는 {@link RestClient} 는 여기서만 만든다({@code RestClientsTest} 가 다른 자리를 막는다).
 *
 * <p>JSON 은 코드가 직접 만드는 다른 매퍼와 같은 규칙(Jackson 2 기본값의 Jackson 3)으로 읽고 쓴다. Spring 의
 * {@code RestClient.builder()} 는 Boot 설정을 거치지 않고 Jackson 3 기본값의 매퍼를 써서, 레코드 본문의 속성을
 * 알파벳 순으로 쓰고 뒤에 붙은 토큰을 거부하는 등 다른 JSON 경로와 규칙이 갈린다.
 */
public final class RestClients {

    private RestClients() {
    }

    public static RestClient.Builder builder() {
        return RestClient.builder().configureMessageConverters(converters -> converters.withJsonConverter(
                new JacksonJsonHttpMessageConverter(JsonMapper.builderWithJackson2Defaults().build())));
    }
}
