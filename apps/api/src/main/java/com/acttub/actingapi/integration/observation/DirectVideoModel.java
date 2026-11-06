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
    /**
     * 지시문 안의 경계 표시(SOMA-1063). 앞은 회차 안에서 바뀌지 않는 지시라 systemInstruction 에 두고, 뒤는 이번 답만의
     * 지시라 {@link #TURN_HEADER} 를 달아 마지막 user 메시지 끝에 붙인다. 요청 앞부분이 턴마다 같아야 Gemini 암묵 캐시가 걸린다.
     * 표시가 없으면 예전처럼 지시문 전체가 systemInstruction 이다. 모델에는 이 표시 자체를 보내지 않는다.
     */
    String TURN_BOUNDARY = "\u0000acttub-turn\u0000";
    /** 마지막 user 메시지에 붙는 이번 답 지시의 머리말. */
    String TURN_HEADER = "[이번 답 지시]";
    /** 기록(Langfuse 입력)용: 경계 표시를 머리말로 바꾼다. 표시가 없으면 그대로다. */
    static String readable(String instruction) {
        return instruction == null ? null : instruction.replace(TURN_BOUNDARY, "\n\n" + TURN_HEADER + "\n");
    }
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
     * 생각을 거의 하지 않고 쓴다(SOMA-780). 이미 쓴 코치 말을 짧게 다듬기처럼 판단이 단순한 호출용이다.
     * 따로 지원하지 않는 구현은 {@link #reply} 와 같다.
     */
    default String replyLight(Video video, List<Message> history, String instruction) {
        return reply(video, history, instruction);
    }
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
