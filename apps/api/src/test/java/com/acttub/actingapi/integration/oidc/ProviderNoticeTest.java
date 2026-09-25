package com.acttub.actingapi.integration.oidc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 연결 끊기 알림의 검증 규격은 각 제공자의 공식 문서가 정한다. 여기서는 그 규격대로 만든 알림이
 * 통과하고, 어긋난 알림은 하나도 통과하지 못하는 것을 본다.
 *
 * <p>네이버: 네이버 로그인 개발가이드 §4.4.2(식별자 암호화)·§4.4.3(HMAC). 카카오: 카카오 로그인 ›
 * 웹훅 › 연결 해제 웹훅(어드민 키 헤더).
 */
class ProviderNoticeTest {
    private static final String CLIENT_ID = "naver-client-id";
    private static final String CLIENT_SECRET = "naver-client-secret";

    private final NaverDisconnectNotice naver = new NaverDisconnectNotice(CLIENT_ID, CLIENT_SECRET);
    private final KakaoUnlinkNotice kakao = new KakaoUnlinkNotice("kakao-admin-key", "1234");

    @Test
    @DisplayName("account.login: 네이버 문서의 규격대로 서명한 알림에서 끊긴 이용자의 식별자를 꺼낸다")
    void naverNoticeSignedAsDocumentedYieldsTheUserId() throws Exception {
        String encrypted = naverEncrypt("naver-unique-id-1", CLIENT_SECRET);
        String signature = NaverDisconnectNotice.sign(
                NaverDisconnectNotice.key(CLIENT_SECRET), CLIENT_ID, encrypted, "1693877406");

        assertThat(naver.disconnectedUserId(CLIENT_ID, encrypted, "1693877406", signature))
                .isEqualTo("naver-unique-id-1");
    }

    @Test
    @DisplayName("account.login: 서명이 틀렸거나, 값이 바뀌었거나, 우리 앱의 알림이 아니면 네이버 알림을 거절한다")
    void naverNoticeThatDoesNotVerifyIsRejected() throws Exception {
        String encrypted = naverEncrypt("naver-unique-id-1", CLIENT_SECRET);
        String signature = NaverDisconnectNotice.sign(
                NaverDisconnectNotice.key(CLIENT_SECRET), CLIENT_ID, encrypted, "1693877406");
        String otherSecret = NaverDisconnectNotice.sign(
                NaverDisconnectNotice.key("someone-else"), CLIENT_ID, encrypted, "1693877406");

        assertThatThrownBy(() -> naver.disconnectedUserId(CLIENT_ID, encrypted, "1693877406", otherSecret))
                .isInstanceOf(InvalidProviderNotice.class);
        assertThatThrownBy(() -> naver.disconnectedUserId(CLIENT_ID, encrypted, "1693877407", signature))
                .as("timestamp 를 바꾸면 서명이 맞지 않는다")
                .isInstanceOf(InvalidProviderNotice.class);
        assertThatThrownBy(() -> naver.disconnectedUserId(
                        CLIENT_ID, naverEncrypt("someone-else", CLIENT_SECRET), "1693877406", signature))
                .isInstanceOf(InvalidProviderNotice.class);
        assertThatThrownBy(() -> naver.disconnectedUserId("other-client", encrypted, "1693877406", signature))
                .isInstanceOf(InvalidProviderNotice.class);
        assertThatThrownBy(() -> naver.disconnectedUserId(CLIENT_ID, encrypted, "1693877406", null))
                .isInstanceOf(InvalidProviderNotice.class);
    }

    @Test
    @DisplayName("account.login: 네이버 설정이 없으면 알림을 검증할 수 없다 — 운영 사고로 가른다")
    void naverNoticeWithoutConfigurationIsAConfigurationError() {
        assertThatThrownBy(() -> new NaverDisconnectNotice("", "").disconnectedUserId("a", "b", "c", "d"))
                .isInstanceOf(ProviderConfigurationError.class);
    }

    @Test
    @DisplayName("account.login: 카카오 알림은 헤더의 어드민 키가 맞아야 받고 회원번호를 꺼낸다")
    void kakaoNoticeCarryingTheAdminKeyYieldsTheUserId() {
        assertThat(kakao.unlinkedUserId("KakaoAK kakao-admin-key", "1234", "987654321")).isEqualTo("987654321");
    }

    @Test
    @DisplayName("account.login: 어드민 키가 다르거나 헤더가 없거나 다른 앱의 알림이면 카카오 알림을 거절한다")
    void kakaoNoticeThatDoesNotVerifyIsRejected() {
        assertThatThrownBy(() -> kakao.unlinkedUserId("KakaoAK wrong-key", "1234", "987654321"))
                .isInstanceOf(InvalidProviderNotice.class);
        assertThatThrownBy(() -> kakao.unlinkedUserId(null, "1234", "987654321"))
                .isInstanceOf(InvalidProviderNotice.class);
        assertThatThrownBy(() -> kakao.unlinkedUserId("Bearer kakao-admin-key", "1234", "987654321"))
                .isInstanceOf(InvalidProviderNotice.class);
        assertThatThrownBy(() -> kakao.unlinkedUserId("KakaoAK kakao-admin-key", "9999", "987654321"))
                .isInstanceOf(InvalidProviderNotice.class);
        assertThatThrownBy(() -> kakao.unlinkedUserId("KakaoAK kakao-admin-key", "1234", " "))
                .isInstanceOf(InvalidProviderNotice.class);
        assertThatThrownBy(() -> new KakaoUnlinkNotice("", "").unlinkedUserId("KakaoAK ", "1234", "1"))
                .isInstanceOf(ProviderConfigurationError.class);
    }

    /** 네이버 문서 §4.4.2 의 암호화 예제 그대로다 — base64url( iv + AES128/CBC/PKCS5(평문, md5(secret)[0..16]) ). */
    static String naverEncrypt(String uniqueId, String clientSecret) throws Exception {
        byte[] iv = new byte[16];
        new SecureRandom().nextBytes(iv);
        Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        cipher.init(
                Cipher.ENCRYPT_MODE,
                new SecretKeySpec(NaverDisconnectNotice.key(clientSecret), "AES"),
                new IvParameterSpec(iv));
        byte[] encrypted = cipher.doFinal(uniqueId.getBytes(StandardCharsets.UTF_8));
        byte[] packed = new byte[iv.length + encrypted.length];
        System.arraycopy(iv, 0, packed, 0, iv.length);
        System.arraycopy(encrypted, 0, packed, iv.length, encrypted.length);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(packed);
    }
}
