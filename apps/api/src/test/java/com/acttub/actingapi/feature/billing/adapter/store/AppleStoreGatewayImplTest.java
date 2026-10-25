package com.acttub.actingapi.feature.billing.adapter.store;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.InputStream;
import java.security.MessageDigest;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.HexFormat;

import com.acttub.actingapi.feature.billing.app.StoreGateways.StoreException;
import org.junit.jupiter.api.Test;

class AppleStoreGatewayImplTest {
    @Test
    void bundledRootIsAppleRootCaG3() throws Exception {
        try (InputStream in = AppleStoreGatewayImpl.class.getResourceAsStream("/apple/AppleRootCA-G3.cer")) {
            X509Certificate cert = (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(in);
            assertThat(cert.getSubjectX500Principal().getName()).contains("Apple Root CA - G3");
            assertThat(HexFormat.of().withUpperCase().formatHex(MessageDigest.getInstance("SHA-256").digest(cert.getEncoded())))
                    .isEqualTo("63343ABFB89A6A03EBB57E9B3F5FA7BE7C4F5C756F3017B3A8C488C3653E9179");
        }
    }

    @Test
    void forgedOrMalformedSignedDataIsRejected() {
        AppleStoreGatewayImpl gateway = new AppleStoreGatewayImpl("com.acttub.app", 6793056855L, false, "", "", "");
        assertThat(gateway.configured()).isTrue();
        // 헤더·서명이 Apple 체인이 아닌 값은 모두 invalid_store_receipt 로 막힌다.
        for (String forged : new String[] {"", "abc", "a.b.c",
                "eyJhbGciOiJFUzI1NiIsIng1YyI6WyJBQUEiXX0.eyJidW5kbGVJZCI6ImNvbS5hY3R0dWIuYXBwIn0.c2ln"}) {
            assertThatThrownBy(() -> gateway.verifyTransaction(forged)).isInstanceOfSatisfying(StoreException.class,
                    e -> assertThat(e.kind()).isEqualTo(StoreException.Kind.INVALID));
            assertThatThrownBy(() -> gateway.verifyNotification(forged)).isInstanceOf(StoreException.class);
        }
        assertThat(gateway.latest("2000000111", "Production")).isEmpty();
    }
}
