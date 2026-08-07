package com.acttub.actingapi.domain;

import jakarta.persistence.Converter;

public enum IdentityProvider implements PgEnum {
    GOOGLE("google"), KAKAO("kakao"), APPLE("apple"), DEVELOPMENT("development");
    private final String value;
    IdentityProvider(String value) { this.value = value; }
    public String dbValue() { return value; }
    @Converter(autoApply = false) public static class JpaConverter extends PgEnumConverter<IdentityProvider> {
        public JpaConverter() { super(IdentityProvider.class); }
    }
}
