package com.acttub.actingapi.feature.reading.app;

@FunctionalInterface
public interface VoiceSynthesizer {
    byte[] synthesizePcm(String text, String geminiVoiceName);
}
