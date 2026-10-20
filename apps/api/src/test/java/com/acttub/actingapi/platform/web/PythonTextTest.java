package com.acttub.actingapi.platform.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class PythonTextTest {

    @Test
    void stripRemovesNonBreakingSpaceAndNextLineLikePython() {
        assertThat(PythonText.strip("  제목\t\u0085")).isEqualTo("제목");
        assertThat(PythonText.strip(" \u0085")).isEmpty();
        assertThat(PythonText.strip(null)).isNull();
    }

    @Test
    void rstripKeepsLeadingSpaceAndRemovesTrailingPythonSpace() {
        assertThat(PythonText.rstrip(" 본문  \u0085")).isEqualTo(" 본문");
        assertThat(PythonText.rstrip("  ")).isEmpty();
        assertThat(PythonText.rstrip(null)).isNull();
    }
}
