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
    /**
     * 이름표를 달아 올린다(SOMA-780). 서버가 바뀌어도 같은 대화가 이름표로 같은 영상을 찾아 다시 쓴다.
     * 이름표를 못 다는 구현은 그냥 올린다.
     */
    default Video upload(Path path, String mimeType, InputInspection inspection, String label) {
        return inspection == null || inspection.hasAudioTrack() == null
                ? upload(path, mimeType) : upload(path, mimeType, inspection);
    }
    /** 이름표를 단 파일. {@code label} 은 올릴 때 준 이름표 그대로다. */
    record Labeled(Video video, String label, java.time.Instant created) { }
    /** 이 접두어로 시작하는 이름표를 단 파일들. 지원하지 않는 구현은 빈 목록이다. */
    default List<Labeled> labeled(String prefix) { return List.of(); }
    boolean ready(Video video);
    String reply(Video video, List<Message> history, String instruction);
    /**
     * {@link #reply} 와 같은 답을 쓰면서 원문 조각을 쓰는 대로 넘긴다(코칭 스트리밍).
     * 스트리밍을 못 하는 구현은 다 쓴 답을 한 조각으로 넘긴다.
     */
    default String replyStream(Video video, List<Message> history, String instruction,
            java.util.function.Consumer<String> onText) {
        String reply = reply(video, history, instruction);
        if (reply != null && !reply.isEmpty()) onText.accept(reply);
        return reply;
    }
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
