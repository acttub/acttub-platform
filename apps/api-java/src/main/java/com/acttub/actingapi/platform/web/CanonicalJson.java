package com.acttub.actingapi.platform.web;

import java.io.IOException;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.springframework.stereotype.Component;

/**
 * 파이썬 {@code json.dumps(..., sort_keys=True, separators=(",", ":"), ensure_ascii=False)} 와 같은
 * 바이트열을 낸다.
 *
 * <p>두 군데서 쓰이며 두 곳 다 바이트가 계약이다 — 요청 지문(SHA-256 입력)과, 멱등 응답으로
 * 다시 실어 보내는 본문. 키 순서나 공백이 흔들리면 같은 요청이 다른 지문을 갖는다.
 *
 * <p>도메인이 아니라 배관에 산다. 연습·코치·리포트가 같은 규칙을 쓰는데, 어느 한 도메인에 두면
 * 나머지가 그 도메인을 통해 인코딩 규칙을 빌려 오게 된다.
 */
@Component
public class CanonicalJson {
    private final ObjectMapper mapper;

    public CanonicalJson(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public byte[] bytes(Object value) {
        Object sortable = value instanceof JsonNode node
                ? mapper.convertValue(node, Object.class)
                : value;
        try {
            return mapper.writer()
                    .with(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS)
                    .writeValueAsBytes(sortable);
        } catch (IOException exception) {
            throw new IllegalStateException("cannot encode canonical JSON", exception);
        }
    }
}
