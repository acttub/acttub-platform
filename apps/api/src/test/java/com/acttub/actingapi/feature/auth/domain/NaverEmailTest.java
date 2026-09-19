package com.acttub.actingapi.feature.auth.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;

/** 네이버는 이메일 검증 표시를 주지 않는다. 주소로 판단하는 것은 계정 구조에 따른 우리 규칙이다. */
class NaverEmailTest {

    @ParameterizedTest
    @ValueSource(strings = {"actor@naver.com", "Actor@NAVER.com", "  actor@naver.com "})
    @DisplayName("account.login: @naver.com 주소는 그 네이버 계정의 메일함이므로 검증된 것으로 본다")
    void ownDomainIsVerified(String email) {
        assertThat(NaverEmail.verifiedByAccountStructure(email)).isTrue();
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {
        "actor@gmail.com", "actor@naver.com.evil.test", "actor@mail.naver.com",
        "actor@evil.test@naver.com", "@naver.com", "naver.com", ""})
    @DisplayName("account.login: 외부 메일이나 네이버 주소처럼 보이기만 하는 값은 검증되지 않은 것으로 본다")
    void anythingElseIsUnverified(String email) {
        assertThat(NaverEmail.verifiedByAccountStructure(email)).isFalse();
    }
}
