package com.acttub.actingapi.feature.auth.app;
import static org.assertj.core.api.Assertions.*; import java.nio.charset.StandardCharsets; import java.time.*; import java.util.*; import com.acttub.actingapi.support.FrozenValue; import com.fasterxml.jackson.databind.ObjectMapper; import org.junit.jupiter.api.*;
class JwtServiceTest {private static final Instant NOW=Instant.parse("2026-08-08T00:00:00Z");private JwtService service(){return new JwtService("비ASCII-원문-secret",Clock.fixed(NOW,ZoneOffset.UTC),new ObjectMapper());}
    @Test void headerPaddingTtlAndHashMatchPythonContract()throws Exception{var token=service().issueAccessToken(UUID.randomUUID());String[] p=token.value().split("\\.");assertThat(new String(Base64.getUrlDecoder().decode(p[0]),StandardCharsets.UTF_8)).isEqualTo("{\"alg\":\"HS256\",\"typ\":\"JWT\"}");assertThat(token.value()).doesNotContain("=");assertThat(token.expiresAt()).isEqualTo(NOW.plusSeconds(1800));assertThat(JwtService.hashToken(token.value())).matches("[0-9a-f]{64}");}
    @Test void expirationBoundaryIsExclusiveAndSkewIsZero(){UUID user=UUID.randomUUID();var token=service().issue(user,"access",10,NOW);assertThat(service().decode(token.value(),"access",NOW.plusSeconds(9)).userId()).isEqualTo(user);assertThatThrownBy(()->service().decode(token.value(),"access",NOW.plusSeconds(10))).isInstanceOf(JwtService.TokenValidationException.class);var future=service().issue(user,"access",10,NOW.plusSeconds(1));assertThatThrownBy(()->service().decode(future.value(),"access",NOW)).isInstanceOf(JwtService.TokenValidationException.class);}
    @Test void emptySecretFailsFast(){assertThatThrownBy(()->new JwtService("",Clock.systemUTC(),new ObjectMapper())).isInstanceOf(IllegalArgumentException.class);}
    /**
     * 파이썬이 발급한 실제 토큰을 자바가 받아들인다. 예전에는 venv 를 돌려 그 자리에서
     * 발급받았고, 파이썬이 사라지기 직전에 그 값을 {@code frozen/} 으로 동결했다
     * ({@code SOMA-403} 5단계). 서명 검증은 비밀키와 바이트에만 달려 있어 발급자가
     * 없어져도 성립한다 — 자바가 HS256·헤더·클레임 표기 중 하나라도 바꾸면 여기서 깨진다.
     */
    @Test void tokenIssuedByPythonIsAccepted(){assertThat(service().decode(FrozenValue.of("jwt-python-issued-access-token.txt"),"access",NOW).userId()).isEqualTo(UUID.fromString("00000000-0000-0000-0000-000000000001"));}
}
