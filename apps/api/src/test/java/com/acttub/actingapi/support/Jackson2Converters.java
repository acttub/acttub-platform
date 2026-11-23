package com.acttub.actingapi.support;

import java.util.ArrayList;
import java.util.List;

import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.converter.HttpMessageConverters;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;

/**
 * {@code MockMvcBuilders.standaloneSetup} 에 줄 변환기. Spring 기본값에 JSON 만 Jackson 2 로 둔다.
 *
 * <p>standalone MockMvc 는 Boot 설정을 거치지 않아 classpath 만 보고 JSON 변환기를 고르고, Flyway 가 끌고 온
 * Jackson 3 을 고른다. 운영 MVC 는 {@code spring.http.converters.preferred-json-mapper=jackson2} 로 Jackson 2 를
 * 쓰므로 테스트도 같게 둔다(Boot 3.5 때 standalone 기본값과 같은 변환기다).
 */
public final class Jackson2Converters {

    private Jackson2Converters() {
    }

    @SuppressWarnings("removal") // Jackson 3 으로 옮길 때 이 파일을 지운다.
    public static HttpMessageConverter<?>[] server() {
        List<HttpMessageConverter<?>> converters = new ArrayList<>();
        HttpMessageConverters.forServer().registerDefaults()
                .withJsonConverter(new MappingJackson2HttpMessageConverter()).build().forEach(converters::add);
        return converters.toArray(HttpMessageConverter<?>[]::new);
    }
}
