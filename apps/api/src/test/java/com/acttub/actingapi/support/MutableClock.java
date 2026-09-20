package com.acttub.actingapi.support;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/**
 * 테스트가 돌릴 수 있는 애플리케이션 시계. 가입 토큰의 30분, 만 나이의 자정 앞뒤처럼 시각에 기대는
 * 규칙을 실제로 기다리지 않고 본다.
 *
 * <p>JWT 는 따라가지 않는다 — {@code AuthConfiguration} 이 액세스 토큰에는 시계를 따로 준다. 그래서
 * 시계를 돌려도 테스트가 들고 있는 액세스 토큰은 만료되지 않는다.
 */
public final class MutableClock extends Clock {
    private volatile Instant now;

    public MutableClock(Instant start) {
        this.now = start;
    }

    public void set(Instant instant) {
        this.now = instant;
    }

    public void advance(Duration duration) {
        this.now = now.plus(duration);
    }

    @Override
    public Instant instant() {
        return now;
    }

    @Override
    public ZoneId getZone() {
        return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(ZoneId zone) {
        MutableClock source = this;
        return new Clock() {
            @Override
            public ZoneId getZone() {
                return zone;
            }

            @Override
            public Clock withZone(ZoneId other) {
                return source.withZone(other);
            }

            @Override
            public Instant instant() {
                return source.instant();
            }
        };
    }

    /** {@code @Import(MutableClock.Fixture.class)} 로 애플리케이션 시계를 갈아 끼운다. */
    @TestConfiguration(proxyBeanMethods = false)
    public static class Fixture {
        @Bean
        @Primary
        MutableClock mutableClock() {
            // 지금에서 시작한다. 갱신이 발급하는 액세스 토큰은 이 시계로 `iat` 를 적고 검증은 실제
            // 시계로 하므로, 미래에서 시작하면 방금 받은 토큰이 "아직 유효하지 않다"로 거절된다.
            return new MutableClock(Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS));
        }
    }
}
