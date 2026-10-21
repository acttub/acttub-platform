package com.acttub.actingapi.feature.reading.adapter.voice;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;

import com.acttub.actingapi.feature.reading.app.RecordingCoachModel;
import com.acttub.actingapi.feature.reading.domain.RecordingCoachMaterial.Clip;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.google.genai.Client;
import com.google.genai.types.Content;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.GenerateContentResponse;
import com.google.genai.types.Part;
import com.google.genai.types.ThinkingConfig;

/**
 * 리딩 녹음 코치의 Gemini 연결 (reading.recording-coach, 실험). 줄별 m4a 를 저장소에서 받아 인라인 소리로 붙인다 — 녹음은
 * 작아서(중앙값 8줄 약 56초) 파일 올리기·처리 대기 없이 한 요청에 담는다. 받은 임시 파일은 바로 지운다.
 *
 * <p>저장소는 부를 때 꺼낸다 — 스토리지가 없는 기동에서도 스위치를 켤 수 있고, 그때 첫 호출이 실패해 503 이 된다.
 *
 * <p>코칭 키 클라이언트(@Primary, GEMINI_COACH_API_KEY)를 쓴다 — 배우의 소리를 연기 코칭에 쓰는 일이라 영상 코칭과 같은
 * 키·동의(ai_analysis)의 범위다.
 */
public class GeminiRecordingCoachModel implements RecordingCoachModel {

    private final Client client;
    private final Supplier<ObjectStorage> storage;
    private final String model;
    private final FailureReporter failures;

    public GeminiRecordingCoachModel(
            Client client, Supplier<ObjectStorage> storage, String model, FailureReporter failures) {
        this.client = client;
        this.storage = storage;
        this.model = model;
        this.failures = failures;
    }

    @Override
    public Reply reply(String instruction, String script, List<Clip> clips, List<Turn> turns) {
        List<Part> first = new ArrayList<>();
        first.add(Part.fromText(script));
        for (Clip clip : clips) {
            first.add(Part.fromText(clip.label()));
            first.add(Part.fromBytes(download(clip.objectKey()), clip.contentType()));
        }
        List<Content> contents = new ArrayList<>();
        for (int i = 0; i < turns.size(); i++) {
            Turn turn = turns.get(i);
            List<Part> parts = new ArrayList<>();
            if (i == 0) {
                parts.addAll(first);
            }
            parts.add(Part.fromText(turn.text()));
            contents.add(Content.builder().role(turn.coach() ? "model" : "user").parts(parts).build());
        }
        GenerateContentConfig config = GenerateContentConfig.builder()
                .systemInstruction(Content.fromParts(Part.fromText(instruction)))
                .thinkingConfig(model.startsWith("gemini-3")
                        ? ThinkingConfig.builder().thinkingLevel("LOW").build()
                        : ThinkingConfig.builder().thinkingBudget(0).build())
                .build();
        GenerateContentResponse response = client.models.generateContent(model, contents, config);
        String text = response.text();
        if (text == null || text.isBlank()) {
            throw new IllegalStateException("recording coach model returned no text");
        }
        return new Reply(text, model);
    }

    private byte[] download(String objectKey) {
        Path local = null;
        try {
            local = Files.createTempFile("recording-coach-", ".m4a");
            storage.get().downloadToPath(objectKey, local);
            return Files.readAllBytes(local);
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        } finally {
            if (local != null) {
                try {
                    Files.deleteIfExists(local);
                } catch (IOException failure) {
                    failures.report(failure, new FailureContext("GeminiRecordingCoachModel.tempCleanup"));
                }
            }
        }
    }
}
