/**
 * 첨부한 대본 파일에서 텍스트를 뽑는다 (SOMA-527).
 * TXT는 바로, DOCX는 mammoth로. PDF는 Hermes에서 pdf.js가 안 돌아 숨김 WebView
 * (components/pdf-text-extractor)가 등록한 추출기로 넘긴다 — 등록된 화면에서만 된다.
 */
import { File } from 'expo-file-system';
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

export interface PickedFile {
  uri: string;
  name: string;
  mimeType?: string;
}

function kindOf(f: PickedFile): 'txt' | 'docx' | 'pdf' | 'unknown' {
  const ext = (f.name.split('.').pop() ?? '').toLowerCase();
  const mt = f.mimeType ?? '';
  if (ext === 'txt' || mt.startsWith('text/')) return 'txt';
  if (ext === 'docx' || mt.includes('wordprocessingml')) return 'docx';
  if (ext === 'pdf' || mt.includes('pdf')) return 'pdf';
  return 'unknown';
}

export async function extractScriptText(f: PickedFile): Promise<string> {
  const kind = kindOf(f);
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
