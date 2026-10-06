package com.acttub.actingapi.feature.reading.app;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/**
 * 합성 결과를 재생할 WAV 한 벌로 만든다. 모델이 PCM(16bit·mono·24kHz)만 주면 머리를 씌우고,
 * 이미 WAV를 주면(gemini-3.8-flash-tts — 끝에 C2PA 출처 덩어리가 붙는다) {@code data} 덩어리만 꺼내
 * 다시 싼다. 그대로 싸면 안쪽 머리와 C2PA가 소리로 재생돼 틱·지지직 소리가 난다.
 */
public final class WavPcm {
    private static final int DEFAULT_RATE = 24_000;

    private WavPcm() {}

    public static byte[] wrap(byte[] audio) {
        if (!isRiffWave(audio)) return build(audio, DEFAULT_RATE);
        ByteBuffer in = ByteBuffer.wrap(audio).order(ByteOrder.LITTLE_ENDIAN);
        int rate = DEFAULT_RATE;
        int at = 12;
        while (at + 8 <= audio.length) {
            String id = new String(audio, at, 4, StandardCharsets.US_ASCII);
            long size = Integer.toUnsignedLong(in.getInt(at + 4));
            int body = at + 8;
            if (id.equals("fmt ") && body + 8 <= audio.length) rate = in.getInt(body + 4);
            if (id.equals("data")) {
                int end = (int) Math.min(audio.length, body + size);
                return build(Arrays.copyOfRange(audio, body, end), rate);
            }
            long next = body + size + (size & 1);
            if (next > audio.length) break;
            at = (int) next;
        }
        throw new IllegalStateException("synthesized WAV has no data chunk");
    }

    private static boolean isRiffWave(byte[] audio) {
        return audio.length >= 12
                && new String(audio, 0, 4, StandardCharsets.US_ASCII).equals("RIFF")
                && new String(audio, 8, 4, StandardCharsets.US_ASCII).equals("WAVE");
    }

    private static byte[] build(byte[] pcm, int rate) {
        ByteBuffer wav = ByteBuffer.allocate(44 + pcm.length).order(ByteOrder.LITTLE_ENDIAN);
        wav.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + pcm.length);
        wav.put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short) 1);
        wav.putShort((short) 1).putInt(rate).putInt(rate * 2).putShort((short) 2).putShort((short) 16);
        wav.put("data".getBytes(StandardCharsets.US_ASCII)).putInt(pcm.length).put(pcm);
        return wav.array();
    }
}
