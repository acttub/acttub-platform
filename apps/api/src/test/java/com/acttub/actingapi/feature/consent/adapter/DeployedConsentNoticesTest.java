package com.acttub.actingapi.feature.consent.adapter;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.DefaultResourceLoader;

/** 고지 문서는 배포 디렉토리(CONSENT_DOCS_DIR)가 있으면 거기서, 없으면 jar 안에서 요청마다 읽는다. */
class DeployedConsentNoticesTest {
    @TempDir
    Path directory;

    @Test
    void configuredDirectoryWinsOverTheBundledCopy() throws Exception {
        Files.writeString(directory.resolve(DeployedConsentNotices.PRIVACY_POLICY_FILE), "배포본 처리방침");

        var notices = new DeployedConsentNotices(new DefaultResourceLoader(), directory.toString()).notices();

        assertThat(notices).singleElement().satisfies(notice -> {
            assertThat(notice.type()).isEqualTo("privacy_policy");
            assertThat(notice.body()).isEqualTo("배포본 처리방침");
        });
        assertThat(new DeployedConsentNotices(new DefaultResourceLoader(), " ").notices().getFirst().body())
                .isNotEqualTo("배포본 처리방침").isNotBlank();
    }

    @Test
    void missingNoticeFileFailsThatRequest() {
        assertThatThrownBy(() -> new DeployedConsentNotices(new DefaultResourceLoader(), directory.toString()).notices())
                .isInstanceOf(UncheckedIOException.class)
                .hasMessage("consent notice is missing: privacy_policy.md");
    }
}
