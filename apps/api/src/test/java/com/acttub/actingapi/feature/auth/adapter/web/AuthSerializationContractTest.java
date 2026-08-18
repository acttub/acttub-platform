package com.acttub.actingapi.feature.auth.adapter.web;
import static org.assertj.core.api.Assertions.*; import java.lang.reflect.RecordComponent; import java.nio.file.*; import java.util.*; import com.fasterxml.jackson.annotation.JsonIgnoreProperties; import com.fasterxml.jackson.databind.*; import org.junit.jupiter.api.Test;
class AuthSerializationContractTest {@Test void onlyThreeM2RequestsExplicitlyAllowUnknownKeys()throws Exception{for(Class<?> type:List.of(AuthDtos.LoginRequest.class,AuthDtos.LogoutRequest.class,AuthDtos.RefreshRequest.class))assertThat(type.getAnnotation(JsonIgnoreProperties.class).ignoreUnknown()).isTrue();ObjectMapper mapper=new ObjectMapper().enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);assertThatCode(()->mapper.readValue("{\"provider\":\"development\",\"id_token\":\"u\",\"future\":1}",AuthDtos.LoginRequest.class)).doesNotThrowAnyException();}
    /**
     * 위 테스트가 어노테이션을, 이 테스트가 <b>커밋된 스펙</b>을 본다. 둘이 갈리면 웹이 받는
     * 계약서와 서버가 실제로 받아주는 것이 어긋난다. 대조 상대는 {@code SOMA-403} 5단계까지
     * 파이썬 스펙이었고, 지금은 springdoc 이 뜬 {@code spec/openapi.json} 이다.
     */
    @Test void committedOpenApiDerivesTheSameAuthAllowSet()throws Exception{JsonNode root=new ObjectMapper().readTree(Path.of("spec/openapi.json").toFile());Set<String> allowed=new TreeSet<>();root.path("paths").properties().stream().filter(path->path.getKey().startsWith("/v2/auth/")).forEach(path->path.getValue().properties().forEach(op->{JsonNode schema=op.getValue().at("/requestBody/content/application~1json/schema/$ref");if(schema.isTextual()){String name=schema.asText().substring(schema.asText().lastIndexOf('/')+1);if(!root.at("/components/schemas/"+name).path("additionalProperties").isBoolean())allowed.add(name);}}));assertThat(allowed).containsExactly("LoginRequest","LogoutRequest","RefreshRequest");}
}
