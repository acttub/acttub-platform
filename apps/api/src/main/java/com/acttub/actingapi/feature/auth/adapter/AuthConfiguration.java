package com.acttub.actingapi.feature.auth.adapter;
import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.auth.app.SignupTokens;
import java.time.Clock; import com.fasterxml.jackson.databind.ObjectMapper; import org.springframework.beans.factory.annotation.Value; import org.springframework.context.annotation.*;
@Configuration
public class AuthConfiguration {
    @Bean Clock applicationClock(){return Clock.systemUTC();}

    /**
     * JWT 전용 시계. <b>애플리케이션 시계를 옮겨도 여기는 따라가지 않는다.</b>
     *
     * <p>시간 층을 나눈다는 M2 결정(DB transaction now / JWT / 레이트리밋 monotonic)의
     * 연장이고, 파이썬 정본도 {@code JwtService} 에는 시계를 주입하지 않는다. 붙여 두면
     * 시계를 앞당기는 순간 <b>액세스 토큰(TTL 30분)이 만료돼 뒤따르는 요청이 전부 401</b> 이
     * 된다 — 실제로 그렇게 죽은 적이 있다.
     */
    @Bean JwtService jwtService(@Value("${JWT_SECRET:}")String secret,ObjectMapper mapper){return new JwtService(secret,Clock.systemUTC(),mapper);}

    /** 가입 토큰은 발급 시각과 만료를 <b>애플리케이션 시계</b>로 잰다 — 30분 만료를 시계를 돌려 확인한다. */
    @Bean SignupTokens signupTokens(@Value("${JWT_SECRET:}")String secret){return new SignupTokens(secret);}
}
