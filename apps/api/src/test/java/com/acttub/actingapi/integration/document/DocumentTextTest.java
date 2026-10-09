package com.acttub.actingapi.integration.document;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.encryption.AccessPermission;
import org.apache.pdfbox.pdmodel.encryption.StandardProtectionPolicy;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
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
    @DisplayName("reading.script 원본: hwp 의 표는 칸을 탭으로, 행을 줄로 잇는다(hwplib 1.1.11 로 만든 2×2 표)")
    void hwpTablesBecomeTabbedLines() throws IOException {
        assertThat(read(resource("table.hwp"))).isEqualTo(new DocumentText.Text("\n윤서\t오늘은 바람이 차네.\n태오\t옥상은 원래 그래.\n\n"));
    }

    @Test
    @DisplayName("reading.script 원본: 표 칸 하나에 한도를 넘는 글이 있어도 칸에 다 쌓기 전에 TooLong 이다 — docx(XML 210MB 를 푸는 칸)·hwp(300,000자 칸)")
    void longTableCellsStopAtTheLimit() throws IOException {
        Path docx = dir.resolve("bomb.docx");
        try (ZipOutputStream out = new ZipOutputStream(Files.newOutputStream(docx))) {
            out.putNextEntry(new ZipEntry("word/document.xml"));
            out.write(("<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>"
                    + "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>").getBytes(StandardCharsets.UTF_8));
            byte[] chunk = "a".repeat(1 << 20).getBytes(StandardCharsets.US_ASCII);
            for (int i = 0; i < 210; i++) out.write(chunk);
            out.write("</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>".getBytes(StandardCharsets.UTF_8));
            out.closeEntry();
        }
        assertThat(Files.size(docx)).as("작은 파일이 크게 풀린다").isLessThan(1_000_000);
        assertThat(read(docx)).isEqualTo(new DocumentText.TooLong());
        assertThat(read(resource("table-long.hwp"))).isEqualTo(new DocumentText.TooLong());
    }

    @Test
    @DisplayName("reading.script 원본: 본문 구역이 작게 압축돼 크게 풀리는 hwp(압축 폭탄)는 풀기 전에 읽지 못함이다")
    void hwpDecompressionBomb() throws IOException {
        Path bomb = dir.resolve("bomb.hwp");
        try (InputStream in = Files.newInputStream(resource("rooftop.hwp"))) {
            var fs = new kr.dogfoot.hwplib.org.apache.poi.poifs.filesystem.POIFSFileSystem(in);
            var body = (kr.dogfoot.hwplib.org.apache.poi.poifs.filesystem.DirectoryEntry) fs.getRoot().getEntry("BodyText");
            body.getEntry("Section0").delete();
            ByteArrayOutputStream deflated = new ByteArrayOutputStream();
            try (var deflater = new java.util.zip.DeflaterOutputStream(deflated, new java.util.zip.Deflater(9, true))) {
                byte[] zeros = new byte[1 << 20];
                for (int i = 0; i < 300; i++) deflater.write(zeros);
            }
            body.createDocument("Section0", new java.io.ByteArrayInputStream(deflated.toByteArray()));
            try (var out = Files.newOutputStream(bomb)) {
                fs.writeFilesystem(out);
            }
        }
        assertThat(Files.size(bomb)).as("작은 파일이 크게 풀린다").isLessThan(2_000_000);
        assertThat(read(bomb)).isEqualTo(new DocumentText.Unreadable("too_large"));
    }

    @Test
    @DisplayName("reading.script 원본: docx 글상자의 mc:AlternateContent 는 Choice 만 읽는다 — Fallback 의 같은 글을 두 번 넣지 않는다")
    void docxTextBoxesAreReadOnce() throws IOException {
        String ns = "xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" "
                + "xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" xmlns:v=\"urn:schemas-microsoft-com:vml\"";
        String box = p("w", "<w:r><w:t>(바람 소리)</w:t></w:r>");
        String xml = "<w:document " + ns + "><w:body>"
                + p("w", "<w:r><w:t>윤서</w:t><w:tab/><w:t>추워.</w:t></w:r><w:r><mc:AlternateContent><mc:Choice Requires=\"wps\"><w:drawing><w:txbxContent>"
                        + box + "</w:txbxContent></w:drawing></mc:Choice><mc:Fallback><w:pict><v:textbox><w:txbxContent>" + box
                        + "</w:txbxContent></v:textbox></w:pict></mc:Fallback></mc:AlternateContent></w:r>")
                + "</w:body></w:document>";
        assertThat(read(zip("box.docx", Map.of("word/document.xml", xml)))).isEqualTo(new DocumentText.Text("윤서\t추워.(바람 소리)\n\n"));
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
    @DisplayName("reading.script 원본: 한 줄의 글자를 먼저 그리고 괄호·부호를 나중에 그린 PDF 는 그 줄만 가로 위치 순으로 세운다")
    void pdfLineDrawnOutOfOrder() throws IOException {
        // 운영의 macOS PDF(2026-10-08)는 한 줄의 한글을 먼저, 괄호·쉼표·물음표를 나중에 그려 「없네( ) , ?」로 읽혔다.
        Path file = pdf("marks-last.pdf", List.of(marksLast("(calmly) so, gone?", 50, 700), marksLast("Who (me)?", 50, 680)));
        assertThat(read(file)).isEqualTo(new DocumentText.Text("(calmly) so, gone?\nWho (me)?\n"));
    }

    @Test
    @DisplayName("reading.script 원본: 2단 편집 PDF 는 단마다 그린 순서대로 — 같은 높이의 두 단을 한 줄로 섞지 않는다")
    void pdfColumnsStayApart() throws IOException {
        Path file = pdf("columns.pdf", List.of(inOrder("Left one", 50, 700), inOrder("Left two", 50, 680),
                inOrder("Right one", 320, 700), inOrder("Right two", 320, 680)));
        assertThat(read(file)).isEqualTo(new DocumentText.Text("Left one\nLeft two\nRight one\nRight two\n"));
    }

    @Test
    @DisplayName("reading.script 원본: 앞 글자와 살짝 겹쳐 그린 글자(따옴표)는 되돌아간 것으로 보지 않는다")
    void pdfSlightOverlapKeepsOrder() throws IOException {
        List<Glyph> line = new ArrayList<>(inOrder("go ", 50, 700));
        Glyph space = line.getLast();
        line.add(new Glyph("\u2018", space.x() - 1, 700));
        line.addAll(inOrder("home", space.x() - 1 + width("\u2018"), 700));
        assertThat(read(pdf("overlap.pdf", List.of(line)))).isEqualTo(new DocumentText.Text("go \u2018home\n"));
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

    private static final PDType1Font HELVETICA = new PDType1Font(Standard14Fonts.FontName.HELVETICA);
    private static final float SIZE = 12;

    /** PDF 에 그리는 글자 하나. 그리는 순서는 목록 순서다. */
    private record Glyph(String text, float x, float y) {
    }

    private static float width(String text) throws IOException {
        return HELVETICA.getStringWidth(text) / 1000 * SIZE;
    }

    /** 왼쪽부터 차례로 그린다. */
    private static List<Glyph> inOrder(String text, float x, float y) throws IOException {
        List<Glyph> glyphs = new ArrayList<>();
        for (int i = 0; i < text.length(); i++) {
            String ch = text.substring(i, i + 1);
            glyphs.add(new Glyph(ch, x, y));
            x += width(ch);
        }
        return glyphs;
    }

    /** 글자·공백을 먼저, 괄호·부호를 나중에 그린다 — 자리는 inOrder 와 같다. */
    private static List<Glyph> marksLast(String text, float x, float y) throws IOException {
        List<Glyph> glyphs = inOrder(text, x, y);
        List<Glyph> ordered = new ArrayList<>();
        glyphs.stream().filter(g -> g.text().matches("[\\p{L} ]")).forEach(ordered::add);
        glyphs.stream().filter(g -> !g.text().matches("[\\p{L} ]")).forEach(ordered::add);
        return ordered;
    }

    /** 줄마다 글자를 목록 순서대로 하나씩 그린 한 쪽짜리 PDF. */
    private Path pdf(String name, List<List<Glyph>> lines) throws IOException {
        Path file = dir.resolve(name);
        try (PDDocument document = new PDDocument()) {
            PDPage page = new PDPage();
            document.addPage(page);
            try (PDPageContentStream content = new PDPageContentStream(document, page)) {
                for (List<Glyph> line : lines) {
                    for (Glyph glyph : line) {
                        content.beginText();
                        content.setFont(HELVETICA, SIZE);
                        content.newLineAtOffset(glyph.x(), glyph.y());
                        content.showText(glyph.text());
                        content.endText();
                    }
                }
            }
            document.save(file.toFile());
        }
        return file;
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
