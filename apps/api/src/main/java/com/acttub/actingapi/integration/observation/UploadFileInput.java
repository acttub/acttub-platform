package com.acttub.actingapi.integration.observation;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Objects;

/**
 * Gemini 에 올릴 파일을 연다. genai SDK 는 8MB 배열을 read 한 번으로 채우고, 덜 채워지면 그 조각을 마지막으로 보고 올리기를 끝낸다.
 * 파일을 8MB 씩 한 번에 읽으면 JDK 가 8MB 임시 네이티브 버퍼를 만들어 그 스레드(가상 스레드면 캐리어)에 남겨 두고, JDK 25 는 이것을
 * direct 버퍼 지표에도 보이지 않는다. 캐리어는 1초 예약 작업 때문에 줄지 않아 캐리어마다 8MB 가 쌓였다(SOMA-1179).
 * 그래서 요청한 길이는 다 채우되 파일은 {@link #SLICE} 씩 읽는다.
 */
final class UploadFileInput {
    static final int SLICE = 64 * 1024;

    private UploadFileInput() {
    }

    static InputStream open(Path path) throws IOException {
        return sliced(Files.newInputStream(path));
    }

    static InputStream sliced(InputStream source) {
        return new FilterInputStream(source) {
            @Override
            public int read(byte[] buffer, int offset, int length) throws IOException {
                Objects.checkFromIndexSize(offset, length, buffer.length);
                int filled = 0;
                while (filled < length) {
                    int read = in.read(buffer, offset + filled, Math.min(SLICE, length - filled));
                    if (read < 0) break;
                    filled += read;
                }
                return filled == 0 && length > 0 ? -1 : filled;
            }
        };
    }
}
