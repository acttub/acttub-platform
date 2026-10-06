package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class WavPcmTest {
    @Test
    void wrapsSignedLittleEndian24KhzMonoPcm() {
        byte[] wav = WavPcm.wrap(new byte[] {1, 2, 3, 4});
        assertThat(wav).hasSize(48);
        assertThat(new String(wav, 0, 4)).isEqualTo("RIFF");
        assertThat(new String(wav, 8, 4)).isEqualTo("WAVE");
        ByteBuffer header = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN);
        assertThat(header.getInt(24)).isEqualTo(24_000);
        assertThat(header.getShort(22)).isEqualTo((short) 1);
        assertThat(header.getShort(34)).isEqualTo((short) 16);
        assertThat(header.getInt(40)).isEqualTo(4);
        assertThat(wav).endsWith(1, 2, 3, 4);
    }

    /** gemini-3.8-flash-tts 는 PCM 대신 완성된 WAV(+끝에 C2PA 출처 덩어리)를 준다 — 두 번 싸면 머리와 C2PA가 소리로 나온다. */
    @Test
    void unwrapsReturnedWavAndDropsTrailingC2paChunk() {
        byte[] returned = wavWith(24_000, new byte[] {5, 6, 7, 8}, chunk("C2PA", new byte[] {9, 9, 9, 9, 9, 9}));

        byte[] wav = WavPcm.wrap(returned);

        assertThat(wav).hasSize(48);
        ByteBuffer header = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN);
        assertThat(header.getInt(4)).isEqualTo(40);
        assertThat(header.getInt(40)).isEqualTo(4);
        assertThat(wav).endsWith(5, 6, 7, 8);
    }

    @Test
    void keepsSampleRateOfReturnedWav() {
        byte[] wav = WavPcm.wrap(wavWith(48_000, new byte[] {1, 2}, new byte[0]));

        ByteBuffer header = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN);
        assertThat(header.getInt(24)).isEqualTo(48_000);
        assertThat(header.getInt(28)).isEqualTo(96_000);
        assertThat(wav).endsWith(1, 2);
    }

    @Test
    void clampsDataChunkLongerThanPayload() {
        byte[] returned = wavWith(24_000, new byte[] {1, 2, 3, 4}, new byte[0]);
        ByteBuffer.wrap(returned).order(ByteOrder.LITTLE_ENDIAN).putInt(40, 1_000);

        assertThat(WavPcm.wrap(returned)).hasSize(48).endsWith(1, 2, 3, 4);
    }

    private static byte[] wavWith(int rate, byte[] pcm, byte[] trailing) {
        ByteBuffer fmt = ByteBuffer.allocate(16).order(ByteOrder.LITTLE_ENDIAN);
        fmt.putShort((short) 1).putShort((short) 1).putInt(rate).putInt(rate * 2).putShort((short) 2).putShort((short) 16);
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        body.writeBytes("WAVE".getBytes(StandardCharsets.US_ASCII));
        body.writeBytes(chunk("fmt ", fmt.array()));
        body.writeBytes(chunk("data", pcm));
        body.writeBytes(trailing);
        ByteBuffer riff = ByteBuffer.allocate(8 + body.size()).order(ByteOrder.LITTLE_ENDIAN);
        riff.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(body.size()).put(body.toByteArray());
        return riff.array();
    }

    private static byte[] chunk(String id, byte[] payload) {
        ByteBuffer chunk = ByteBuffer.allocate(8 + payload.length).order(ByteOrder.LITTLE_ENDIAN);
        chunk.put(id.getBytes(StandardCharsets.US_ASCII)).putInt(payload.length).put(payload);
        return chunk.array();
    }
}
