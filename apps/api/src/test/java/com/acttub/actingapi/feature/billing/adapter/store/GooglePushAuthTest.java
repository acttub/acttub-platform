package com.acttub.actingapi.feature.billing.adapter.store;

import static org.assertj.core.api.Assertions.assertThat;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.util.Date;
import java.util.List;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.Test;

class GooglePushAuthTest {
    static final String AUDIENCE = "https://api.acttub.com/v2/billing/store-notify/google";
    static final String EMAIL = "pubsub-push@acttub.iam.gserviceaccount.com";

    final KeyPair pair = newPair();
    final KeyPair stranger = newPair();
    final GooglePushAuth oidc = new GooglePushAuth("oidc", "", AUDIENCE, EMAIL, new ImmutableJWKSet<>(new JWKSet(
            new RSAKey.Builder((RSAPublicKey) pair.getPublic()).keyID("k1").build())));

    static KeyPair newPair() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            return generator.generateKeyPair();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    String jwt(KeyPair signer, String issuer, String audience, String email, boolean verified, long expiresInSeconds) throws Exception {
        SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).type(JOSEObjectType.JWT).keyID("k1").build(),
                new JWTClaimsSet.Builder().issuer(issuer).audience(audience).claim("email", email).claim("email_verified", verified)
                        .expirationTime(new Date(System.currentTimeMillis() + expiresInSeconds * 1000)).build());
        jwt.sign(new RSASSASigner((RSAPrivateKey) signer.getPrivate()));
        return "Bearer " + jwt.serialize();
    }

    @Test
    void tokenModeComparesTheSecretAndNothingElse() {
        GooglePushAuth token = new GooglePushAuth("token", "s3cret-value", "", "", null);
        assertThat(token.accepts("s3cret-value", null)).isTrue();
        assertThat(token.accepts("s3cret-valuf", null)).isFalse();
        assertThat(token.accepts(null, "Bearer anything")).isFalse();
        assertThat(new GooglePushAuth("token", "", "", "", null).accepts("", null)).isFalse();
    }

    @Test
    void unsetModeRejectsEverything() {
        assertThat(new GooglePushAuth("", "x", AUDIENCE, EMAIL, null).accepts("x", "Bearer a")).isFalse();
    }

    @Test
    void oidcAcceptsOnlyAValidGoogleSignedToken() throws Exception {
        assertThat(oidc.accepts(null, jwt(pair, "https://accounts.google.com", AUDIENCE, EMAIL, true, 600))).isTrue();
        assertThat(oidc.accepts(null, jwt(pair, "accounts.google.com", AUDIENCE, EMAIL, true, 600))).isTrue();
        assertThat(oidc.accepts(null, jwt(stranger, "https://accounts.google.com", AUDIENCE, EMAIL, true, 600))).isFalse();
        assertThat(oidc.accepts(null, jwt(pair, "https://evil.example", AUDIENCE, EMAIL, true, 600))).isFalse();
        assertThat(oidc.accepts(null, jwt(pair, "https://accounts.google.com", "https://other", EMAIL, true, 600))).isFalse();
        assertThat(oidc.accepts(null, jwt(pair, "https://accounts.google.com", AUDIENCE, "other@x.com", true, 600))).isFalse();
        assertThat(oidc.accepts(null, jwt(pair, "https://accounts.google.com", AUDIENCE, EMAIL, false, 600))).isFalse();
        assertThat(oidc.accepts(null, jwt(pair, "https://accounts.google.com", AUDIENCE, EMAIL, true, -600))).isFalse();
        assertThat(oidc.accepts(null, null)).isFalse();
        assertThat(oidc.accepts("?", "Bearer not-a-jwt")).isFalse();
        assertThat(List.of(GooglePushAuth.issuers())).isNotEmpty();
    }
}
