package com.acttub.actingapi.auth.app;
import static org.assertj.core.api.Assertions.*; import java.nio.charset.StandardCharsets; import java.time.*; import java.util.*; import com.fasterxml.jackson.databind.ObjectMapper; import org.junit.jupiter.api.*;
class JwtServiceTest {private static final Instant NOW=Instant.parse("2026-08-08T00:00:00Z");private JwtService service(){return new JwtService("비ASCII-원문-secret",Clock.fixed(NOW,ZoneOffset.UTC),new ObjectMapper());}
    @Test void headerPaddingTtlAndHashMatchPythonContract()throws Exception{var token=service().issueAccessToken(UUID.randomUUID());String[] p=token.value().split("\\.");assertThat(new String(Base64.getUrlDecoder().decode(p[0]),StandardCharsets.UTF_8)).isEqualTo("{\"alg\":\"HS256\",\"typ\":\"JWT\"}");assertThat(token.value()).doesNotContain("=");assertThat(token.expiresAt()).isEqualTo(NOW.plusSeconds(1800));assertThat(JwtService.hashToken(token.value())).matches("[0-9a-f]{64}");}
    @Test void expirationBoundaryIsExclusiveAndSkewIsZero(){UUID user=UUID.randomUUID();var token=service().issue(user,"access",10,NOW);assertThat(service().decode(token.value(),"access",NOW.plusSeconds(9)).userId()).isEqualTo(user);assertThatThrownBy(()->service().decode(token.value(),"access",NOW.plusSeconds(10))).isInstanceOf(JwtService.TokenValidationException.class);var future=service().issue(user,"access",10,NOW.plusSeconds(1));assertThatThrownBy(()->service().decode(future.value(),"access",NOW)).isInstanceOf(JwtService.TokenValidationException.class);}
    @Test void emptySecretFailsFast(){assertThatThrownBy(()->new JwtService("",Clock.systemUTC(),new ObjectMapper())).isInstanceOf(IllegalArgumentException.class);}
    @Test void tokenIssuedByPythonIsAccepted()throws Exception{java.nio.file.Path python=java.nio.file.Path.of("../api/.venv/bin/python");Assumptions.assumeTrue(java.nio.file.Files.isExecutable(python),"Python virtualenv is unavailable");String code="""
import sys
sys.path.insert(0,'../api/acting-api/src')
from acting_api.auth.jwt import JwtService
from datetime import datetime,timezone
from uuid import UUID
print(JwtService('비ASCII-원문-secret').issue_access_token(UUID('00000000-0000-0000-0000-000000000001'),now=datetime.fromtimestamp(1786147200,timezone.utc)).value)
""";Process process=new ProcessBuilder(python.toString(),"-c",code).redirectErrorStream(true).start();String value=new String(process.getInputStream().readAllBytes(),StandardCharsets.UTF_8).strip();assertThat(process.waitFor()).isZero();assertThat(service().decode(value,"access",NOW).userId()).isEqualTo(UUID.fromString("00000000-0000-0000-0000-000000000001"));}
}
