package com.acttub.actingapi.integration.document;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.encryption.AccessPermission;
import org.apache.pdfbox.pdmodel.encryption.StandardProtectionPolicy;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * 표본 파일에서 뽑은 글을 글자 그대로 본다. 표본: {@code rooftop.docx} 는 macOS textutil 이 RTF(탭·줄바꿈)에서 만든 것,
 * {@code rooftop.hwp} 는 hwplib 1.1.11 로 탭(인라인 컨트롤 9)을 넣어 만든 것, {@code rooftop.pdf}·{@code scan.pdf} 는 Chrome 이
 * 찍은 것(scan 은 캔버스 그림뿐이라 글자가 없다). 표가 든 docx·hwpx 는 구조를 그대로 적어 이 자리에서 만든다.
 */
class DocumentTextTest {
    private static final String ROOFTOP = "옥상, 밤\n윤서\t오늘은 바람이 차네.\n태오\t옥상은 원래 그래.\n(윤서, 난간에 기댄다)\n윤서\t너도 이리 와 봐.\n";

    @TempDir
    Path dir;

    @Test
    @DisplayName("reading.script 원본: hwp 의 탭으로 가른 배역·대사는 탭 그대로 남는다(hwplib 의 TextExtractor 는 탭을 버린다)")
    void hwpKeepsTabs() throws IOException {
        assertThat(read(resource("rooftop.hwp"))).isEqualTo(new DocumentText.Text("\n" + ROOFTOP));
    }

    @Test
    @DisplayName("reading.script 원본: docx 의 탭과 줄바꿈이 남는다")
    void docxKeepsTabsAndBreaks() throws IOException {
        assertThat(read(resource("rooftop.docx"))).isEqualTo(new DocumentText.Text(
                "옥상, 밤\n윤서\t오늘은 바람이 차네.\n태오\t옥상은 원래 그래.\n(윤서, 난간에 기댄다)\n윤서\t너도 이리 와 봐.\n여기서 보면 다 작아 보여.\n태오\n정말 그러네.\n끝\n"));
    }

    @Test
    @DisplayName("reading.script 원본: docx 의 표는 칸을 탭으로, 행을 줄로 잇는다. 칸 안 문단은 공백, 칸 하나인 행은 문단 그대로. 문단 속성의 탭 정의는 글이 아니다")
    void docxTablesBecomeTabbedLines() throws IOException {
        String w = "xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"";
        String xml = "<w:document " + w + "><w:body>"
                + p("w", "<w:pPr><w:tabs><w:tab w:val=\"left\" w:pos=\"1000\"/></w:tabs></w:pPr><w:r><w:t>옥상, 밤</w:t></w:r>")
                + "<w:tbl><w:tr>" + cell("w", "<w:r><w:t>윤서</w:t></w:r>") + cell("w", "<w:r><w:t>오늘은 바람이 차네.</w:t></w:r>") + "</w:tr>"
                + "<w:tr>" + cell("w", "<w:r><w:t>태오</w:t></w:r>") + "<w:tc>" + p("w", "<w:r><w:t>옥상은 원래 그래.</w:t></w:r>")
                + p("w", "<w:r><w:t>너도 알잖아.</w:t></w:r>") + "</w:tc></w:tr>"
                + "<w:tr><w:tc>" + p("w", "<w:r><w:t>(윤서, 난간에 기댄다)</w:t></w:r>") + p("w", "<w:r><w:t>(바람)</w:t></w:r>") + "</w:tc></w:tr></w:tbl>"
                + p("w", "<w:r><w:delText>지운 글</w:delText><w:t>끝</w:t></w:r>") + "</w:body></w:document>";
        assertThat(read(zip("table.docx", Map.of("word/document.xml", xml)))).isEqualTo(new DocumentText.Text(
                "옥상, 밤\n윤서\t오늘은 바람이 차네.\n태오\t옥상은 원래 그래. 너도 알잖아.\n(윤서, 난간에 기댄다)\n(바람)\n끝\n"));
    }

    @Test
    @DisplayName("reading.script 원본: hwpx 는 구역 번호 순으로 읽고 hp:tab·hp:lineBreak·표를 docx 와 같이 다룬다")
    void hwpxReadsSectionsInOrder() throws IOException {
        String hp = "xmlns:hp=\"http://www.hancom.co.kr/hwpml/2011/paragraph\" xmlns:hs=\"http://www.hancom.co.kr/hwpml/2011/section\"";
        String second = "<hs:sec " + hp + ">" + p("hp", "<hp:run><hp:t>윤서<hp:tab width=\"4000\"/>너도 이리 와 봐.<hp:lineBreak/>여기서 보면 다 작아 보여.</hp:t></hp:run>")
                + "</hs:sec>";
        String first = "<hs:sec " + hp + ">" + p("hp", "<hp:run><hp:t>옥상, 밤</hp:t></hp:run>")
                + p("hp", "<hp:run><hp:tbl><hp:tr>" + cell("hp", "<hp:run><hp:t>태오</hp:t></hp:run>")
                        + cell("hp", "<hp:run><hp:t>옥상은 원래 그래.</hp:t></hp:run>") + "</hp:tr></hp:tbl></hp:run>")
                + "</hs:sec>";
        Map<String, String> entries = new LinkedHashMap<>();
        entries.put("mimetype", "application/hwp+zip");
        entries.put("Contents/section10.xml", "<hs:sec " + hp + ">" + p("hp", "<hp:run><hp:t>끝</hp:t></hp:run>") + "</hs:sec>");
        entries.put("Contents/section1.xml", second);
        entries.put("Contents/section0.xml", first);
        assertThat(read(zip("rooftop.hwpx", entries))).isEqualTo(new DocumentText.Text(
                "옥상, 밤\n태오\t옥상은 원래 그래.\n\n윤서\t너도 이리 와 봐.\n여기서 보면 다 작아 보여.\n끝\n"));
    }

    @Test
    @DisplayName("reading.script 원본: PDF 는 그려진 글자를 내용 순서대로 읽는다")
    void pdfText() throws IOException {
        assertThat(read(resource("rooftop.pdf"))).isEqualTo(new DocumentText.Text(
                "옥상, 밤\n윤서 오늘은 바람이 차네.\n태오 옥상은 원래 그래.\n(윤서, 난간에 기댄다)\n"));
    }

    @Test
    @DisplayName("reading.script 원본: 글자 없는 PDF(스캔)·사용자 암호 PDF·잘린 PDF·한글 97·모르는 zip·이진 파일은 읽지 못함이다")
    void unreadableFiles() throws IOException {
        assertThat(read(resource("scan.pdf"))).isEqualTo(new DocumentText.Unreadable("no_text"));

        Path locked = dir.resolve("locked.pdf");
        try (PDDocument document = Loader.loadPDF(resource("rooftop.pdf").toFile())) {
            StandardProtectionPolicy policy = new StandardProtectionPolicy("owner", "user", new AccessPermission());
            document.protect(policy);
            document.save(locked.toFile());
        }
        assertThat(read(locked)).isEqualTo(new DocumentText.Unreadable("encrypted"));

        byte[] pdf = Files.readAllBytes(resource("rooftop.pdf"));
        assertThat(read(write("cut.pdf", Arrays.copyOf(pdf, 400)))).isInstanceOf(DocumentText.Unreadable.class);

        byte[] hwp3 = Arrays.copyOf("HWP Document File V3.00 \u001A\u0001\u0002\u0003\u0004\u0005".getBytes(StandardCharsets.ISO_8859_1), 256);
        assertThat(read(write("old.hwp", hwp3))).isEqualTo(new DocumentText.Unreadable("hwp3"));

        assertThat(read(zip("book.docx", Map.of("content.xml", "<x/>")))).isEqualTo(new DocumentText.Unreadable("unknown_zip"));
        assertThat(read(write("image.txt", new byte[] {(byte) 0x89, 'P', 'N', 'G', 0, 0, 0, 13}))).isEqualTo(new DocumentText.Unreadable("binary"));
        assertThat(read(write("blank.txt", "  \n\t\n".getBytes(StandardCharsets.UTF_8)))).isEqualTo(new DocumentText.Unreadable("no_text"));
    }

    @Test
    @DisplayName("reading.script 원본: 형식은 확장자가 아니라 파일 머리로 가른다 — .txt 이름의 PDF 도 PDF 로 읽는다")
    void formatComesFromContent() throws IOException {
        Path renamed = write("rooftop.txt", Files.readAllBytes(resource("rooftop.pdf")));
        assertThat(read(renamed)).isEqualTo(read(resource("rooftop.pdf")));
    }

    @Test
    @DisplayName("reading.script 원본: txt 는 UTF-8·BOM UTF-8·UTF-16(BOM)·CP949(EUC-KR) 를 알아보고 줄바꿈을 \\n 으로, 제어 문자는 탭·줄바꿈만 남긴다")
    void plainTextEncodings() throws IOException {
        String text = "윤서\t오늘은 바람이 차네.\r\n태오\t옥상은 원래 그래.\u0007\n";
        String expected = "윤서\t오늘은 바람이 차네.\n태오\t옥상은 원래 그래.\n";
        assertThat(read(write("utf8.txt", text.getBytes(StandardCharsets.UTF_8)))).isEqualTo(new DocumentText.Text(expected));
        assertThat(read(write("bom.txt", concat(new byte[] {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF}, text.getBytes(StandardCharsets.UTF_8)))))
                .isEqualTo(new DocumentText.Text(expected));
        assertThat(read(write("utf16.txt", concat(new byte[] {(byte) 0xFF, (byte) 0xFE}, text.getBytes(StandardCharsets.UTF_16LE)))))
                .isEqualTo(new DocumentText.Text(expected));
        assertThat(read(write("utf16be.txt", concat(new byte[] {(byte) 0xFE, (byte) 0xFF}, text.getBytes(StandardCharsets.UTF_16BE)))))
                .isEqualTo(new DocumentText.Text(expected));
        assertThat(read(write("cp949.txt", text.getBytes(Charset.forName("x-windows-949"))))).isEqualTo(new DocumentText.Text(expected));
    }

    @Test
    @DisplayName("reading.script 원본: 한도를 넘는 글은 TooLong — 한도 그대로는 Text")
    void lengthLimit() throws IOException {
        Path file = write("long.txt", "가".repeat(10).getBytes(StandardCharsets.UTF_8));
        assertThat(DocumentText.read(file, 10)).isEqualTo(new DocumentText.Text("가".repeat(10)));
        assertThat(DocumentText.read(file, 9)).isEqualTo(new DocumentText.TooLong());
        assertThat(DocumentText.read(write("huge.txt", "가".repeat(5_000).getBytes(StandardCharsets.UTF_8)), 100))
                .isEqualTo(new DocumentText.TooLong());
    }

    private static DocumentText.Extracted read(Path file) {
        return DocumentText.read(file, 100_000);
    }

    private static String p(String prefix, String inner) {
        return "<" + prefix + ":p>" + inner + "</" + prefix + ":p>";
    }

    private static String cell(String prefix, String run) {
        return "<" + prefix + ":tc>" + p(prefix, run) + "</" + prefix + ":tc>";
    }

    private Path resource(String name) throws IOException {
        Path copy = dir.resolve("resource-" + name);
        try (InputStream in = DocumentTextTest.class.getResourceAsStream("/script-files/" + name)) {
            Files.copy(in, copy, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }
        return copy;
    }

    private Path write(String name, byte[] bytes) throws IOException {
        return Files.write(dir.resolve(name), bytes);
    }

    private Path zip(String name, Map<String, String> entries) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream out = new ZipOutputStream(bytes)) {
            for (var entry : entries.entrySet()) {
                out.putNextEntry(new ZipEntry(entry.getKey()));
                out.write(entry.getValue().getBytes(StandardCharsets.UTF_8));
                out.closeEntry();
            }
        }
        return write(name, bytes.toByteArray());
    }

    private static byte[] concat(byte[] head, byte[] tail) {
        byte[] out = Arrays.copyOf(head, head.length + tail.length);
        System.arraycopy(tail, 0, out, head.length, tail.length);
        return out;
    }
}
