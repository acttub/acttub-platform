/**
 * 첨부한 대본 파일에서 텍스트를 뽑는다 (SOMA-527).
 * TXT는 바로, DOCX는 mammoth로. PDF는 온디바이스 추출이 어려워 붙여넣기 안내.
 */
import { File } from 'expo-file-system';

export class UnsupportedScriptFile extends Error {}

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
      if (!text) throw new Error('빈 문서');
      return text;
    } catch {
      throw new UnsupportedScriptFile('워드(.docx) 파일을 읽지 못했어요. 내용을 복사해 붙여넣어 주세요.');
    }
  }
  if (kind === 'pdf') {
    throw new UnsupportedScriptFile('PDF는 아직 자동 인식이 안 돼요. 대본 내용을 복사해서 붙여넣어 주세요.');
  }
  throw new UnsupportedScriptFile('이 형식은 지원하지 않아요. TXT·DOCX를 올리거나 붙여넣어 주세요.');
}
