package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;

import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.Test;

class VoiceModelServiceTest {
    private final List<String> signed = new ArrayList<>();

    private VoiceModelStorage storage(boolean configured) {
        return new VoiceModelStorage() {
            public boolean configured() { return configured; }
            public String downloadUrl(String key, int expiresInSeconds) {
                signed.add(key + "@" + expiresInSeconds);
                return "https://signed.example/" + key;
            }
        };
    }

    @Test
    void listsEightFilesWithSignedUrlsUnderThePrefix() {
        var model = new VoiceModelService(storage(true), "reading-model/supertonic3-fp16-v1/").current();
        assertThat(model.version()).isEqualTo("supertonic3-fp16-v1");
        assertThat(model.expiresIn()).isEqualTo(3600);
        assertThat(model.files()).hasSize(8);
        var first = model.files().getFirst();
        assertThat(first.name()).isEqualTo("duration_predictor.graph.onnx");
        assertThat(first.bytes()).isEqualTo(248_870);
        assertThat(first.sha256()).hasSize(64);
        assertThat(first.url()).isEqualTo("https://signed.example/reading-model/supertonic3-fp16-v1/duration_predictor.graph.onnx");
        assertThat(model.files()).extracting(VoiceModelService.File::name).contains("vector_estimator.weights.f16");
        assertThat(model.files().stream().mapToLong(VoiceModelService.File::bytes).sum()).isEqualTo(199_693_097L);
        assertThat(signed).allMatch(s -> s.endsWith("@3600"));
    }

    @Test
    void unavailableWithoutPrefixOrStorage() {
        assertUnavailable(new VoiceModelService(storage(true), ""));
        assertUnavailable(new VoiceModelService(storage(true), null));
        assertUnavailable(new VoiceModelService(storage(false), "reading-model/supertonic3-fp16-v1"));
        assertThat(signed).isEmpty();
    }

    private void assertUnavailable(VoiceModelService target) {
        assertThatThrownBy(target::current).isInstanceOfSatisfying(ApiException.class, error -> {
            assertThat(error.status()).isEqualTo(503);
            assertThat(error.getMessage()).isEqualTo("voice_model_unavailable");
        });
    }
}
