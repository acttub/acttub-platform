package com.acttub.actingapi.auth.adapter;
import com.acttub.actingapi.auth.app.JwtService;
import java.time.Clock; import com.fasterxml.jackson.databind.ObjectMapper; import org.springframework.beans.factory.annotation.Value; import org.springframework.context.annotation.*;
@Configuration
public class AuthConfiguration {
    @Bean @Profile("!contract") Clock applicationClock(){return Clock.systemUTC();}

    /**
     * JWT 전용 시계. <b>하네스의 {@code advance-clock} 에 딸려가면 안 된다.</b>
     *
     * <p>contract 프로파일에서 {@code Clock} 빈은 {@code OffsettableClock} 이고, 그것을
     * JWT 검증에 그대로 쓰면 시나리오가 시계를 3시간 앞당기는 순간 **액세스 토큰(TTL 30분)이
     * 만료돼 뒤따르는 요청이 전부 401** 이 된다. 실제로 `worker-failure` 가 sweep 뒤
     * status 조회에서 그렇게 죽었다.
     *
     * <p>원본도 같은 구조다 — 하네스 wrapper 는 레이트리밋 monotonic 과 워커에 넘기는
     * 시각만 앞당기고 {@code JwtService} 에는 시계를 주입하지 않는다. 시간 층을 나눈다는
     * M2 결정(DB transaction now / JWT / 레이트리밋 monotonic)의 연장이다.
     */
    @Bean JwtService jwtService(@Value("${JWT_SECRET:}")String secret,ObjectMapper mapper){return new JwtService(secret,Clock.systemUTC(),mapper);}
}
