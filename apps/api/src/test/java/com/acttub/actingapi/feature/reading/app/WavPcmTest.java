package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
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
}
