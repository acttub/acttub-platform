package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

/** 스트리밍·비교·검사를 하지 못하는 구현이 받는 기본 동작. */
class DirectVideoModelTest {
    private static final DirectVideoModel.Video VIDEO = new DirectVideoModel.Video("files/a", "uri", "video/mp4");

    private static DirectVideoModel model(String reply, List<String> uploads) {
        return new DirectVideoModel() {
            @Override
            public Video upload(Path path, String mimeType) {
                uploads.add(path + " " + mimeType);
                return VIDEO;
            }

            @Override
            public boolean ready(Video video) {
                return true;
            }

            @Override
            public String reply(Video video, List<Message> history, String instruction) {
                return reply;
            }

            @Override
            public String classify(List<Message> history, String instruction, List<String> categories) {
                return "{}";
            }

            @Override
            public void delete(Video video) {
            }

            @Override
            public String model() {
                return "plain";
            }
        };
    }

    @Test
    void streamingFallsBackToTheWholeReplyAsOnePiece() {
        List<String> pieces = new ArrayList<>();

        String whole = model("한 번에 온 답", new ArrayList<>()).replyStream(VIDEO, List.of(), "지침", pieces::add);
        String empty = model("", new ArrayList<>()).replyStream(VIDEO, List.of(), "지침", pieces::add);

        assertThat(whole).isEqualTo("한 번에 온 답");
        assertThat(empty).isEmpty();
        assertThat(pieces).containsExactly("한 번에 온 답");
    }

    @Test
    void inspectionIsUnknownAndUploadWithAnInspectionIsAPlainUpload() {
        List<String> uploads = new ArrayList<>();
        DirectVideoModel model = model("답", uploads);

        DirectVideoModel.InputInspection inspection = model.inspect(Path.of("take.mp4"));

        assertThat(inspection).isEqualTo(new DirectVideoModel.InputInspection(null, null, null));
        assertThat(inspection.emptyInput()).isFalse();
        assertThat(inspection.unusableAudio()).isFalse();
        assertThat(model.upload(Path.of("take.mp4"), "video/mp4", inspection)).isEqualTo(VIDEO);
        assertThat(uploads).containsExactly("take.mp4 video/mp4");
    }

    @Test
    void comparingVideosIsUnsupportedByDefault() {
        assertThatThrownBy(() -> model("답", new ArrayList<>()).compare(List.of(VIDEO), List.of("1차"), "지침"))
                .isInstanceOf(UnsupportedOperationException.class)
                .hasMessage("multi-video comparison is not supported");
    }
}
