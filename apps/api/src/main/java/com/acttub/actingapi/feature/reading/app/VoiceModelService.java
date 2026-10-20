package com.acttub.actingapi.feature.reading.app;

import java.util.List;

import com.acttub.actingapi.platform.web.ApiException;

/**
 * 리딩 기기 목소리 모델(Supertonic 3 fp16 묶음)의 내려받을 주소를 준다(SOMA-747).
 *
 * <p>모델은 공개 Hugging Face 원본(fp32 398MB)을 fp16 으로 줄인 우리 파일이라(약 200MB) 비공개 저장소에 둔다. 앱은 이
 * 주소로 받고 폰에서 fp32 로 풀어 쓴다. 저장소 위치({@code READING_VOICE_MODEL_PREFIX})가 없으면 503 이고, 앱은
 * 예전처럼 원본 fp32 를 받는다. 파일 목록과 크기·해시는 그 묶음의 정본이라 바뀌면 판(prefix)을 새로 만든다.
 */
public final class VoiceModelService {
    static final int EXPIRES_IN_SECONDS = 3600;

    public record File(String name, long bytes, String sha256, String url) {}

    public record Model(String version, List<File> files, int expiresIn) {}

    private record Entry(String name, long bytes, String sha256) {}

    private static final List<Entry> FILES = List.of(
            new Entry("duration_predictor.graph.onnx", 248_870, "bd90aca63b279514b53e278ffb5d136e6b240d7bacb0dcbc24f3db8ebeb638e7"),
            new Entry("duration_predictor.weights.f16", 1_729_412, "4d699d39089c96eac9639c1136eecd5f202741656b240aabd51b852563293f26"),
            new Entry("text_encoder.graph.onnx", 422_962, "07227baf9c4637d836ce74006c64ffb0f631ede0d682d9b7907bc95321462a04"),
            new Entry("text_encoder.weights.f16", 18_001_920, "0acd98162c7fc49807a39a615224affe6f0a645c5b8eefba580567844d964291"),
            new Entry("vector_estimator.graph.onnx", 508_835, "5a2dd4a48fdc176e7a4251c9a0d86c61f18e7d933d0e9f695f541123ba81986e"),
            new Entry("vector_estimator.weights.f16", 128_026_898, "5c46952ce91a3cdc29530e1f9460a7045d10a88c9da03e424abdd41d4d685935"),
            new Entry("vocoder.graph.onnx", 77_364, "18b0927c81dc08c26c4974ce62e66b1c0f2add00a4a985d0cc773164dbf698ea"),
            new Entry("vocoder.weights.f16", 50_676_836, "b4d23ffadadfdc1422e0e175e6f5c11e159ebbed3bc924ee40adc549cf5c4b09"));

    private final VoiceModelStorage storage;
    private final String prefix;

    public VoiceModelService(VoiceModelStorage storage, String prefix) {
        this.storage = storage;
        String trimmed = prefix == null ? "" : prefix.trim();
        this.prefix = trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length() - 1) : trimmed;
    }

    public Model current() {
        if (prefix.isEmpty() || !storage.configured()) {
            throw ApiException.external(503, "voice_model_unavailable", new IllegalStateException("voice model is not configured"));
        }
        String version = prefix.substring(prefix.lastIndexOf('/') + 1);
        List<File> files = FILES.stream()
                .map(e -> new File(e.name(), e.bytes(), e.sha256(), storage.downloadUrl(prefix + "/" + e.name(), EXPIRES_IN_SECONDS)))
                .toList();
        return new Model(version, files, EXPIRES_IN_SECONDS);
    }
}
