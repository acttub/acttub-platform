package com.acttub.actingapi.integration.observation;

import java.nio.file.Path;
import java.util.List;

/** Raw video and conversation only; no observation/record generation. */
public interface DirectVideoModel {
    record Video(String name, String uri, String mimeType, Boolean hasAudioTrack) {
        /** Audio-track presence unknown (e.g. existing mocks/callers predating the probe). */
        public Video(String name, String uri, String mimeType) {
            this(name, uri, mimeType, null);
        }
    }
    /** Local measured file facts, not model observations. Unknown facts never classify an input as empty. */
    record InputInspection(Boolean hasAudioTrack, Boolean fullBlack, Boolean hasAudioSignal) {
        public InputInspection(Boolean hasAudioTrack, Boolean fullBlack) {
            this(hasAudioTrack, fullBlack, null);
        }
        public boolean emptyInput() {
            return Boolean.FALSE.equals(hasAudioTrack) && Boolean.TRUE.equals(fullBlack);
        }
        public boolean unusableAudio() {
            return Boolean.TRUE.equals(hasAudioTrack) && Boolean.FALSE.equals(hasAudioSignal);
        }
    }
    record Message(String role, String text) {}
    /** No provider call. Older/test implementations can leave both facts unknown. */
    default InputInspection inspect(Path path) { return new InputInspection(null, null); }
    Video upload(Path path, String mimeType);
    /** Reuses local inspection without changing existing upload callers. */
    default Video upload(Path path, String mimeType, InputInspection inspection) {
        return upload(path, mimeType);
    }
    boolean ready(Video video);
    String reply(Video video, List<Message> history, String instruction);
    /** Text-only routing; the application owns the allowed categories. */
    String classify(List<Message> history, String instruction, List<String> categories);
    void delete(Video video);
    /**
     * 여러 영상을 라벨과 함께 한 번에 보고 JSON 하나를 낸다(챌린지 AI 리포트). 라벨은 영상 바로 앞에 글로 붙는다.
     * 지원하지 않는 구현은 던진다.
     */
    default String compare(List<Video> videos, List<String> labels, String instruction) {
        throw new UnsupportedOperationException("multi-video comparison is not supported");
    }
    String model();
}
