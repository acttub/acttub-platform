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
    String model();
}
