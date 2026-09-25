/**
 * 첨부한 대본 파일에서 텍스트를 뽑는다 (SOMA-527).
 * TXT는 바로, DOCX는 mammoth로. PDF는 Hermes에서 pdf.js가 안 돌아 숨김 WebView
 * (components/pdf-text-extractor)가 등록한 추출기로 넘긴다 — 등록된 화면에서만 된다.
 */
import { File } from 'expo-file-system';
import { checkScriptFile, type PickedScriptFile } from './file-input.ts';
import { translate as t } from '../i18n.ts';

export class UnsupportedScriptFile extends Error {}

type PdfExtractor = (uri: string) => Promise<string>;
let pdfExtractor: PdfExtractor | null = null;

/** WebView 추출기가 마운트되며 등록한다. 돌려주는 함수로 해제. */
export function registerPdfExtractor(fn: PdfExtractor): () => void {
  pdfExtractor = fn;
  return () => {
    if (pdfExtractor === fn) pdfExtractor = null;
  };
}

export interface PickedFile extends PickedScriptFile {
  uri: string;
}

/**
 * 파일 검사 실패의 안내 문구. 크기(20,000,000바이트)는 글자를 뽑기 전에 거르고, hwp·hwpx 는 앱이 열지
 * 않는다(1.0.0이 받아들인 한계). 어느 쪽도 서버에는 아무것도 남지 않는다.
 */
export function scriptFileRejection(f: PickedScriptFile): string | null {
  const check = checkScriptFile(f);
  if (check.ok) return null;
  if (check.reason === 'too_large') return t('reading.fileTooLarge');
  if (check.reason === 'hwp') return t('reading.hwpUnsupported');
  return t('reading.unsupported');
}

export async function extractScriptText(f: PickedFile): Promise<string> {
  const check = checkScriptFile(f);
  if (!check.ok) throw new UnsupportedScriptFile(scriptFileRejection(f) ?? t('reading.unsupported'));
  const kind = check.kind;
  if (kind === 'txt') {
    return (await new File(f.uri).text()).trim();
  }
  if (kind === 'docx') {
    try {
      const bytes = await new File(f.uri).bytes();
      // mammoth는 arrayBuffer를 받는다.
      const mammoth = await import('mammoth');
      const { value } = await mammoth.extractRawText({
        arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      });
      const text = (value ?? '').trim();
      if (!text) throw new Error(t('reading.emptyDoc'));
      return text;
    } catch {
      throw new UnsupportedScriptFile(t('reading.docxFail'));
    }
  }
  if (kind === 'pdf') {
    if (!pdfExtractor) {
      throw new UnsupportedScriptFile(t('reading.pdfNotReady'));
    }
    try {
      const text = (await pdfExtractor(f.uri)).trim();
      if (!text) throw new Error(t('reading.emptyDoc'));
      return text;
    } catch {
      throw new UnsupportedScriptFile(t('reading.pdfNoText'));
    }
  }
  throw new UnsupportedScriptFile(t('reading.unsupported'));
}
