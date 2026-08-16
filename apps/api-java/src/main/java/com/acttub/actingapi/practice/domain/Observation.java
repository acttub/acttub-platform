package com.acttub.actingapi.practice.domain;

import java.math.BigDecimal;
import java.math.BigInteger;

/**
 * 관찰 한 건.
 *
 * <p>{@code BigInteger}/{@code BigDecimal} 인 이유는 계약이다 — 파이썬이 임의 정밀도 정수와
 * {@code Decimal} 로 내던 값이라, {@code long}/{@code double} 로 좁히면 자릿수와 표기가 달라진다.
 */
public record Observation(
        BigInteger startMs,
        BigInteger endMs,
        String label,
        BigDecimal confidence) {
}
