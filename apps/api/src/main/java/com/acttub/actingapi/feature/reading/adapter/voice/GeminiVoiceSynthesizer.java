package com.acttub.actingapi.feature.reading.adapter.voice;

import com.acttub.actingapi.feature.reading.app.VoiceSynthesizer;
import com.google.genai.Client;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.PrebuiltVoiceConfig;
import com.google.genai.types.SpeechConfig;
import com.google.genai.types.VoiceConfig;
import java.util.List;

/** Gemini TTS 경계. contents에는 사용자가 입력한 대사 원문 하나만 전달한다. */
public final class GeminiVoiceSynthesizer implements VoiceSynthesizer {
    private final Client client;
    private final String model;
    public GeminiVoiceSynthesizer(Client client, String model) { this.client = client; this.model = model; }

    @Override
    public byte[] synthesizePcm(String text, String geminiVoiceName) {
        var config = GenerateContentConfig.builder()
                .responseModalities(List.of("AUDIO"))
                .speechConfig(SpeechConfig.builder()
                        .voiceConfig(VoiceConfig.builder()
                                .prebuiltVoiceConfig(PrebuiltVoiceConfig.builder().voiceName(geminiVoiceName).build())
                                .build())
                        .build())
                .build();
        var response = client.models.generateContent(model, text, config);
        return response.candidates().orElseThrow()
                .getFirst().content().orElseThrow().parts().orElseThrow()
                .getFirst().inlineData().orElseThrow().data().orElseThrow();
    }
}
