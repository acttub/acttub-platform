package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

class UploadFileInputTest {

    @Test
    void fillsTheWholeRequestWhileAskingTheFileForSmallSlicesOnly() throws Exception {
        byte[] content = new byte[3 * UploadFileInput.SLICE + 123];
        for (int i = 0; i < content.length; i++) content[i] = (byte) i;
        List<Integer> asked = new ArrayList<>();
        // 파일처럼 요청보다 적게 돌려줄 때도 있다.
        InputStream source = new ByteArrayInputStream(content) {
            @Override
            public synchronized int read(byte[] b, int off, int len) {
                asked.add(len);
                return super.read(b, off, Math.min(len, 10_000));
            }
        };

        byte[] chunk = new byte[content.length + 1000];
        try (InputStream input = UploadFileInput.sliced(source)) {
            assertThat(input.read(chunk, 0, content.length)).isEqualTo(content.length);
            assertThat(input.read(chunk, 0, chunk.length)).isEqualTo(-1);
        }
        assertThat(java.util.Arrays.copyOf(chunk, content.length)).isEqualTo(content);
        assertThat(asked).allSatisfy(length -> assertThat(length).isLessThanOrEqualTo(UploadFileInput.SLICE));
    }

    @Test
    void returnsWhatIsLeftBeforeTheEnd() throws Exception {
        try (InputStream input = UploadFileInput.sliced(new ByteArrayInputStream(new byte[] {1, 2, 3}))) {
            byte[] chunk = new byte[8];
            assertThat(input.read(chunk, 2, 6)).isEqualTo(3);
            assertThat(chunk).containsExactly(0, 0, 1, 2, 3, 0, 0, 0);
            assertThat(input.read(chunk, 0, 0)).isZero();
            assertThat(input.read(chunk, 0, 8)).isEqualTo(-1);
        }
    }
}
