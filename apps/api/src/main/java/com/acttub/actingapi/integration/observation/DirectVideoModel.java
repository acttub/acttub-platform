package com.acttub.actingapi.integration.observation;

import java.nio.file.Path;
import java.util.List;

/** Raw video and conversation only; no observation/record generation. */
public interface DirectVideoModel {
    record Video(String name, String uri, String mimeType) {}
    record Message(String role, String text) {}
    Video upload(Path path, String mimeType);
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
