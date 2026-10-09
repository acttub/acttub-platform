package com.acttub.actingapi.integration.document;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.Charset;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.Inflater;
import java.util.zip.InflaterInputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipException;
import java.util.zip.ZipFile;

import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamConstants;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamReader;

import kr.dogfoot.hwplib.object.bodytext.control.Control;
import kr.dogfoot.hwplib.object.bodytext.control.ControlTable;
import kr.dogfoot.hwplib.object.bodytext.control.table.Cell;
import kr.dogfoot.hwplib.object.bodytext.control.table.Row;
import kr.dogfoot.hwplib.object.bodytext.paragraph.Paragraph;
import kr.dogfoot.hwplib.object.bodytext.paragraph.text.HWPChar;
import kr.dogfoot.hwplib.org.apache.poi.poifs.filesystem.DirectoryEntry;
import kr.dogfoot.hwplib.org.apache.poi.poifs.filesystem.DocumentEntry;
import kr.dogfoot.hwplib.org.apache.poi.poifs.filesystem.DocumentInputStream;
import kr.dogfoot.hwplib.org.apache.poi.poifs.filesystem.Entry;
import kr.dogfoot.hwplib.org.apache.poi.poifs.filesystem.NPOIFSFileSystem;
import kr.dogfoot.hwplib.reader.HWPReader;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.io.IOUtils;
import org.apache.pdfbox.io.RandomAccessReadBufferedFile;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.encryption.InvalidPasswordException;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.text.TextPosition;

/**
 * 문서 파일(txt·docx·hwpx·pdf·hwp)에서 글자만 뽑는다. 대본 원본(reading.script)이 쓴다.
 *
 * <p>형식은 확장자가 아니라 파일 머리로 가른다. 대본에서는 탭이 뜻을 갖는다(배역과 대사를 탭으로 가르는 대본이 많다) —
 * 탭을 공백으로 뭉개지 않고, 표는 칸을 탭으로, 행을 줄로 잇는다. 칸이 하나뿐인 표(글상자)는 문단을 그대로 줄로 둔다.
 *
 * <p>PDF 는 그려진 위치로 줄을 다시 세우지 않고 내용 순서대로 읽는다. 공개 희곡과 한글(Hancom PDF) 문서로 잰 결과
 * 위치 정렬은 2단 편집에서 두 단을 한 줄로 섞고, 내용 순서가 더 맞았다(SOMA-593 C2 비교).
 */
public final class DocumentText {
    private static final byte[] OLE2 = {(byte) 0xD0, (byte) 0xCF, 0x11, (byte) 0xE0, (byte) 0xA1, (byte) 0xB1, 0x1A, (byte) 0xE1};
    private static final byte[] ZIP = {'P', 'K', 3, 4};
    private static final byte[] HWP3 = "HWP Document File".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] PDF = "%PDF-".getBytes(StandardCharsets.US_ASCII);
    /** zip 안 XML 을 이만큼 넘게 풀면 읽지 않는다 — 작은 파일이 끝없이 풀리는 압축 폭탄을 막는다. */
    private static final long XML_MAX_BYTES = 200L * 1024 * 1024;
    private static final Pattern CONTROL = Pattern.compile("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]");
    private static final String COMPATIBILITY = "http://schemas.openxmlformats.org/markup-compatibility/2006";
    /** hwp 의 압축된 흐름을 모두 풀었을 때의 상한. hwplib 은 상한 없이 풀어 전부 힙에 올린다(그림·첨부 포함). */
    private static final long HWP_MAX_BYTES = 100L * 1024 * 1024;
    private static final Pattern HWPX_SECTION = Pattern.compile("Contents/section(\\d+)\\.xml");

    private DocumentText() {
    }

    /** 뽑은 결과. 글자가 하나도 없으면(스캔한 PDF·빈 문서) 읽지 못한 것이다. */
    public sealed interface Extracted {
    }

    public record Text(String value) implements Extracted {
    }

    /** 유니코드 글자 수가 한도를 넘었다. 넘는 순간 멈추므로 나머지는 읽지 않았다. */
    public record TooLong() implements Extracted {
    }

    /** @param cause 로그용 사유 — 화면에는 한 문구만 보인다 */
    public record Unreadable(String cause) implements Extracted {
    }

    public static Extracted read(Path file, int maxCodePoints) {
        try {
            String text = switch (sniff(file)) {
                case PDF -> pdf(file, maxCodePoints);
                case HWP -> hwp(file, maxCodePoints);
                case HWP3 -> throw new Refused("hwp3");
                case ZIP -> zip(file, maxCodePoints);
                case TEXT -> plain(file, maxCodePoints);
            };
            String cleaned = CONTROL.matcher(text.replace("\r\n", "\n").replace('\r', '\n')).replaceAll("");
            if (cleaned.isBlank()) return new Unreadable("no_text");
            return cleaned.codePointCount(0, cleaned.length()) > maxCodePoints ? new TooLong() : new Text(cleaned);
        } catch (Limit limit) {
            return new TooLong();
        } catch (Refused refused) {
            return new Unreadable(refused.getMessage());
        } catch (Exception | StackOverflowError broken) {
            return new Unreadable("broken: " + broken.getClass().getSimpleName());
        }
    }

    private enum Kind { PDF, HWP, HWP3, ZIP, TEXT }

    private static Kind sniff(Path file) throws IOException {
        byte[] head = new byte[1024];
        int length;
        try (InputStream in = Files.newInputStream(file)) {
            length = in.readNBytes(head, 0, head.length);
        }
        head = Arrays.copyOf(head, length);
        if (startsWith(head, OLE2)) return Kind.HWP;
        if (startsWith(head, HWP3)) return Kind.HWP3;
        if (startsWith(head, ZIP)) return Kind.ZIP;
        if (indexOf(head, PDF) >= 0) return Kind.PDF;
        return Kind.TEXT;
    }

    // ---- txt ----

    private static String plain(Path file, int max) throws IOException {
        byte[] head;
        try (InputStream in = Files.newInputStream(file)) {
            head = in.readNBytes(8192);
        }
        if (startsWith(head, new byte[] {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF})) return decode(file, 3, StandardCharsets.UTF_8, max);
        if (startsWith(head, new byte[] {(byte) 0xFF, (byte) 0xFE})) return decode(file, 2, StandardCharsets.UTF_16LE, max);
        if (startsWith(head, new byte[] {(byte) 0xFE, (byte) 0xFF})) return decode(file, 2, StandardCharsets.UTF_16BE, max);
        for (byte b : head) {
            if (b == 0) throw new Refused("binary");
        }
        try {
            return decode(file, 0, StandardCharsets.UTF_8, max);
        } catch (CharacterCodingException notUtf8) {
            try {
                // 한국어 윈도의 메모장이 오래 써 온 인코딩. EUC-KR 을 품는다.
                return decode(file, 0, Charset.forName("x-windows-949"), max);
            } catch (CharacterCodingException notKorean) {
                throw new Refused("unknown_encoding");
            }
        }
    }

    /** 엄격하게 푼다 — 틀린 바이트를 대체 글자로 바꾸지 않아야 다른 인코딩을 시도할 수 있다. */
    private static String decode(Path file, int skip, Charset charset, int max) throws IOException {
        CharsetDecoder decoder = charset.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT);
        StringBuilder out = new StringBuilder();
        try (InputStream in = Files.newInputStream(file); Reader reader = new InputStreamReader(in, decoder)) {
            in.skipNBytes(skip);
            char[] buffer = new char[8192];
            int read;
            while ((read = reader.read(buffer)) > 0) {
                stopIfInterrupted();
                out.append(buffer, 0, read);
                if (out.length() > 2L * max + 2) throw new Limit();
            }
        }
        return out.toString();
    }

    // ---- docx · hwpx ----

    /** zip 안 XML 의 요소 이름. 둘 다 문단 → 런 → 글 구조이고 표는 행 → 칸이다. */
    private record Markup(String namespace, String paragraph, String run, String text, String tab, Set<String> breaks,
            String row, String cell) {
    }

    private static final Markup WORD = new Markup("http://schemas.openxmlformats.org/wordprocessingml/2006/main",
            "p", "r", "t", "tab", Set.of("br", "cr"), "tr", "tc");
    private static final Markup HANGUL = new Markup("http://www.hancom.co.kr/hwpml/2011/paragraph",
            "p", "run", "t", "tab", Set.of("lineBreak"), "tr", "tc");

    private static String zip(Path file, int max) throws IOException, XMLStreamException {
        try (ZipFile zip = new ZipFile(file.toFile())) {
            ZipEntry word = zip.getEntry("word/document.xml");
            if (word != null) {
                Lines lines = new Lines(max);
                xml(zip, word, WORD, lines);
                return lines.text();
            }
            List<ZipEntry> sections = new ArrayList<>();
            zip.stream().filter(entry -> HWPX_SECTION.matcher(entry.getName()).matches()).forEach(sections::add);
            if (sections.isEmpty()) throw new Refused("unknown_zip");
            sections.sort((a, b) -> Integer.compare(sectionNumber(a), sectionNumber(b)));
            Lines lines = new Lines(max);
            for (ZipEntry section : sections) {
                xml(zip, section, HANGUL, lines);
            }
            return lines.text();
        }
    }

    private static int sectionNumber(ZipEntry entry) {
        Matcher matcher = HWPX_SECTION.matcher(entry.getName());
        return matcher.matches() ? Integer.parseInt(matcher.group(1)) : Integer.MAX_VALUE;
    }

    private static void xml(ZipFile zip, ZipEntry entry, Markup markup, Lines lines) throws IOException, XMLStreamException {
        XMLInputFactory factory = XMLInputFactory.newFactory();
        factory.setProperty(XMLInputFactory.SUPPORT_DTD, false);
        factory.setProperty(XMLInputFactory.IS_SUPPORTING_EXTERNAL_ENTITIES, false);
        try (InputStream in = new Bounded(zip.getInputStream(entry), XML_MAX_BYTES)) {
            XMLStreamReader reader = factory.createXMLStreamReader(in);
            int runs = 0;
            int texts = 0;
            int fallbacks = 0;
            while (reader.hasNext()) {
                int event = reader.next();
                if ((event == XMLStreamConstants.START_ELEMENT || event == XMLStreamConstants.END_ELEMENT)
                        && COMPATIBILITY.equals(reader.getNamespaceURI()) && "Fallback".equals(reader.getLocalName())) {
                    // 글상자는 같은 글을 새 모양(Choice)과 옛 모양(Fallback)으로 두 번 담는다. Choice 만 읽는다.
                    fallbacks += event == XMLStreamConstants.START_ELEMENT ? 1 : -1;
                    continue;
                }
                if (fallbacks > 0) continue;
                if (event == XMLStreamConstants.START_ELEMENT || event == XMLStreamConstants.END_ELEMENT) {
                    if (!markup.namespace().equals(reader.getNamespaceURI())) continue;
                    String name = reader.getLocalName();
                    boolean start = event == XMLStreamConstants.START_ELEMENT;
                    if (name.equals(markup.run())) runs += start ? 1 : -1;
                    else if (name.equals(markup.text())) texts += start ? 1 : -1;
                    else if (name.equals(markup.paragraph()) && !start) lines.paragraphEnd();
                    else if (name.equals(markup.row())) {
                        if (start) lines.rowStart(); else lines.rowEnd();
                    } else if (name.equals(markup.cell()) && start) lines.cellStart();
                    // 문단 속성의 탭 위치 정의(w:tabs/w:tab)는 글이 아니다 — 런 안의 탭만 글이다.
                    else if (start && runs > 0 && name.equals(markup.tab())) lines.append("\t");
                    else if (start && runs > 0 && markup.breaks().contains(name)) lines.append("\n");
                } else if ((event == XMLStreamConstants.CHARACTERS || event == XMLStreamConstants.CDATA) && texts > 0) {
                    lines.append(reader.getText());
                }
            }
            reader.close();
        }
    }

    // ---- pdf ----

    private static String pdf(Path file, int max) throws IOException {
        PDDocument document;
        try {
            // 내용 캐시를 힙이 아니라 임시 파일에 둔다 — 50MB PDF 도 힙을 크게 쓰지 않는다.
            document = Loader.loadPDF(new RandomAccessReadBufferedFile(file.toFile()), "", null, null,
                    IOUtils.createTempFileOnlyStreamCache());
        } catch (InvalidPasswordException locked) {
            throw new Refused("encrypted");
        }
        try (document) {
            PDFTextStripper stripper = new LineOrderStripper();
            stripper.setLineSeparator("\n");
            StringBuilder out = new StringBuilder();
            stripper.writeText(document, new Writer() {
                @Override
                public void write(char[] chars, int offset, int length) {
                    stopIfInterrupted();
                    out.append(chars, offset, length);
                    if (out.length() > 2L * max + 2) throw new Limit();
                }

                @Override
                public void flush() {
                }

                @Override
                public void close() {
                }
            });
            return out.toString();
        }
    }

    /**
     * 그린 순서(내용 순서)대로 읽되, 같은 높이로 연달아 그린 글자 묶음 안에서 앞 글자 폭의 절반 넘게 왼쪽으로 되돌아간 글자가
     * 있으면 그 묶음만 가로 위치 순으로 세운다. 운영의 macOS PDF(2026-10-08)가 한 줄의 한글을 먼저, 괄호·부호를 나중에 그려
     * 「없네( ) , ?」로 읽혔다. 쪽 전체를 위치로 세우면 2단 편집의 두 단이 한 줄로 섞이고(표본 대본집 1,111줄), 문턱이 없으면
     * 앞 글자와 살짝 겹쳐 그린 따옴표가 앞으로 넘어간다(「않고‘ 크루즈’」).
     */
    private static final class LineOrderStripper extends PDFTextStripper {
        private static final float SAME_LINE = 0.5f;

        @Override
        protected void writePage() throws IOException {
            for (List<TextPosition> article : getCharactersByArticle()) {
                int start = 0;
                for (int i = 1; i <= article.size(); i++) {
                    if (i == article.size() || Math.abs(article.get(i).getYDirAdj() - article.get(start).getYDirAdj()) > SAME_LINE) {
                        List<TextPosition> run = article.subList(start, i);
                        if (stepsBack(run)) {
                            run.sort(Comparator.comparingDouble(TextPosition::getXDirAdj));
                        }
                        start = i;
                    }
                }
            }
            super.writePage();
        }

        private static boolean stepsBack(List<TextPosition> run) {
            for (int i = 1; i < run.size(); i++) {
                TextPosition previous = run.get(i - 1);
                if (run.get(i).getXDirAdj() < previous.getXDirAdj() - Math.max(previous.getWidthDirAdj() / 2, 1f)) {
                    return true;
                }
            }
            return false;
        }
    }

    // ---- hwp (5.0) ----

    private static String hwp(Path file, int max) throws Exception {
        checkHwpSize(file);
        var hwp = HWPReader.fromFile(file.toFile());
        Lines lines = new Lines(max);
        for (var section : hwp.getBodyText().getSectionList()) {
            hwpParagraphs(Arrays.asList(section.getParagraphs()), lines);
        }
        return lines.text();
    }

    /**
     * hwplib 에 넘기기 전에 압축된 흐름을 상한 있는 스트림으로 끝까지 풀어 본다(힙에 담지 않고 센다). 압축 여부는 FileHeader 의
     * 속성 첫 비트이고, 풀리지 않는 흐름(압축 안 한 그림 등)은 그 크기 그대로 센다.
     */
    private static void checkHwpSize(Path file) throws IOException {
        try (NPOIFSFileSystem fs = new NPOIFSFileSystem(file.toFile(), true)) {
            byte[] header;
            try (InputStream in = fs.getRoot().createDocumentInputStream("FileHeader")) {
                header = in.readNBytes(40);
            }
            boolean compressed = header.length >= 37 && (header[36] & 1) != 0;
            long[] total = {0};
            walk(fs.getRoot(), compressed, total);
        }
    }

    private static void walk(DirectoryEntry directory, boolean compressed, long[] total) throws IOException {
        for (var it = directory.getEntries(); it.hasNext(); ) {
            Entry entry = it.next();
            if (entry instanceof DirectoryEntry child) {
                walk(child, compressed, total);
            } else if (entry instanceof DocumentEntry document) {
                total[0] += compressed ? inflatedSize(document) : document.getSize();
                if (total[0] > HWP_MAX_BYTES) throw new Refused("too_large");
            }
        }
    }

    private static long inflatedSize(DocumentEntry document) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        long size = 0;
        try (InputStream in = new InflaterInputStream(new DocumentInputStream(document), new Inflater(true))) {
            int read;
            while ((read = in.read(buffer)) > 0) {
                size += read;
                stopIfInterrupted();
                if (size > HWP_MAX_BYTES) throw new Refused("too_large");
            }
        } catch (ZipException | java.io.EOFException notDeflated) {
            return document.getSize();
        }
        return size;
    }

    private static void hwpParagraphs(Iterable<Paragraph> paragraphs, Lines lines) throws Exception {
        for (Paragraph paragraph : paragraphs) {
            List<Control> controls = paragraph.getControlList();
            int control = 0;
            if (paragraph.getText() != null) {
                StringBuilder normal = new StringBuilder();
                for (HWPChar ch : paragraph.getText().getCharList()) {
                    switch (ch.getType()) {
                        case Normal -> normal.append((char) ch.getCode());
                        case ControlChar -> {
                            if (ch.getCode() == 10) normal.append('\n');
                        }
                        case ControlInline -> {
                            if (ch.getCode() == 9) normal.append('\t');
                        }
                        case ControlExtend -> {
                            // 확장 부호는 문단의 컨트롤 목록과 차례로 짝을 이룬다(구역·단 정의도 하나씩 차지한다).
                            Control at = controls != null && control < controls.size() ? controls.get(control) : null;
                            control++;
                            if (at instanceof ControlTable table) {
                                lines.append(normal.toString());
                                normal.setLength(0);
                                hwpTable(table, lines);
                            }
                        }
                    }
                }
                lines.append(normal.toString());
            }
            lines.paragraphEnd();
        }
    }

    private static void hwpTable(ControlTable table, Lines lines) throws Exception {
        for (Row row : table.getRowList()) {
            lines.rowStart();
            for (Cell cell : row.getCellList()) {
                lines.cellStart();
                hwpParagraphs(cell.getParagraphList(), lines);
            }
            lines.rowEnd();
        }
    }

    // ---- 공통 ----

    /**
     * 문단·표를 줄로 모은다. 표의 행은 칸 둘 이상이면 칸마다 문단을 공백으로 이어 탭으로 가르고, 칸이 하나면 그 문단들을
     * 그대로 줄로 둔다. 표 안의 표는 바깥 칸의 글이 된다.
     */
    private static final class Lines {
        private final int max;
        private final StringBuilder out = new StringBuilder();
        private final List<List<StringBuilder>> rows = new ArrayList<>();
        /** 표 칸에 쌓인 것까지 센 글자 수. 칸은 행이 끝나야 {@code out} 으로 가므로 {@code out} 만 재면 칸이 한도 없이 자란다. */
        private long appended;

        Lines(int max) {
            this.max = max;
        }

        void append(String text) {
            if (text.isEmpty()) return;
            stopIfInterrupted();
            appended += text.length();
            if (appended > 2L * max + 2) throw new Limit();
            target().append(text);
        }

        void paragraphEnd() {
            target().append('\n');
        }

        void rowStart() {
            rows.add(new ArrayList<>());
        }

        void cellStart() {
            if (!rows.isEmpty()) rows.getLast().add(new StringBuilder());
        }

        void rowEnd() {
            if (rows.isEmpty()) return;
            List<StringBuilder> cells = rows.removeLast();
            StringBuilder joined = new StringBuilder();
            if (cells.size() == 1) {
                joined.append(cells.getFirst());
            } else {
                for (int i = 0; i < cells.size(); i++) {
                    if (i > 0) joined.append('\t');
                    joined.append(cells.get(i).toString().replace('\n', ' ').strip());
                }
            }
            if (!joined.isEmpty() && joined.charAt(joined.length() - 1) != '\n') joined.append('\n');
            target().append(joined);
        }

        private StringBuilder target() {
            if (rows.isEmpty()) return out;
            List<StringBuilder> cells = rows.getLast();
            if (cells.isEmpty()) cells.add(new StringBuilder());
            return cells.getLast();
        }

        String text() {
            return out.toString();
        }
    }

    private static boolean startsWith(byte[] bytes, byte[] prefix) {
        return bytes.length >= prefix.length && Arrays.equals(bytes, 0, prefix.length, prefix, 0, prefix.length);
    }

    private static int indexOf(byte[] bytes, byte[] needle) {
        for (int i = 0; i + needle.length <= bytes.length; i++) {
            if (Arrays.equals(bytes, i, i + needle.length, needle, 0, needle.length)) return i;
        }
        return -1;
    }

    /** 시간을 넘겨 부르는 쪽이 끊었다(reading.script 읽기의 시간 상한). */
    private static void stopIfInterrupted() {
        if (Thread.currentThread().isInterrupted()) throw new Refused("interrupted");
    }

    /** 한도를 넘었다. 넘는 순간 읽기를 멈춘다. */
    private static final class Limit extends RuntimeException {
        Limit() {
            super(null, null, false, false);
        }
    }

    /** 이 파일은 읽지 않는다(형식 밖·암호·한글 97). */
    private static final class Refused extends RuntimeException {
        Refused(String cause) {
            super(cause, null, false, false);
        }
    }

    /** 풀린 바이트가 한도를 넘으면 멈추는 스트림. */
    private static final class Bounded extends java.io.FilterInputStream {
        private long left;

        Bounded(InputStream in, long limit) {
            super(in);
            this.left = limit;
        }

        @Override
        public int read() throws IOException {
            int b = super.read();
            if (b >= 0 && --left < 0) throw new Refused("xml_too_large");
            return b;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            stopIfInterrupted();
            int read = super.read(buffer, offset, length);
            if (read > 0 && (left -= read) < 0) throw new Refused("xml_too_large");
            return read;
        }
    }
}
