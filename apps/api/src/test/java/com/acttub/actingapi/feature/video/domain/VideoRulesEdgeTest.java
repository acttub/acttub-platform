package com.acttub.actingapi.feature.video.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** practice.record: 형식이 없으면 거절할 값이고, 확장자 없는 객체 키의 포스터는 키 뒤에 붙는다. */
class VideoRulesEdgeTest {
    @Test void missingTypesAndExtensionlessKeys() {
        assertThat(VideoRules.normalize(null)).isNull();
        assertThat(VideoRules.normalize("Video/MP4; codecs=avc1")).isEqualTo("video/mp4");
        assertThat(VideoRules.posterKey("videos/u.1/clip")).isEqualTo("videos/u.1/clip.poster.jpg");
        assertThat(VideoRules.posterKey("videos/u/clip.mov")).isEqualTo("videos/u/clip.poster.jpg");
    }
}
