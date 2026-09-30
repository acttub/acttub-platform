package com.acttub.actingapi.feature.push.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ClientAppVersionTest {
    @Test void extractsOnlyAppClientVersions() {
        assertThat(ClientAppVersion.parse("app/0.1.2")).isEqualTo("0.1.2");
        assertThat(ClientAppVersion.parse("web/0.1.2")).isNull();
        assertThat(ClientAppVersion.parse("app/")).isNull();
        assertThat(ClientAppVersion.parse(null)).isNull();
    }
}
