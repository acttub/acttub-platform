import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { registerPdfExtractor } from '@/lib/reading/extract-file';

/**
 * PDF 텍스트 추출기 — 숨긴 WebView 안에서 pdf.js(assets/pdfjs/extractor.html)를 돌린다.
 *
 * Hermes에선 pdf.js가 안 돌아 WebView를 빌린다. 웹(apps/web)과 같은 줄 재정렬·겹침 제거
 * 로직이 HTML 안에 들어 있어 결과가 웹과 같다. 파일은 base64로 넘기고 결과는 postMessage로
 * 받는다. 이 컴포넌트가 마운트된 화면에서만 extractScriptText 의 PDF 분기가 동작한다.
 */
export function PdfTextExtractor() {
  const [html, setHtml] = useState<string | null>(null);
  const webviewRef = useRef<WebView>(null);
  const readyRef = useRef<Promise<void> | null>(null);
  const resolveReadyRef = useRef<(() => void) | null>(null);
  const pendingRef = useRef<{ resolve: (t: string) => void; reject: (e: Error) => void } | null>(null);

  // HTML(약 1.7MB)은 번들 자산에서 한 번만 읽는다.
  useEffect(() => {
    let alive = true;
    readyRef.current = new Promise<void>((resolve) => {
      resolveReadyRef.current = resolve;
    });
    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const asset = Asset.fromModule(require('@/assets/pdfjs/extractor.html'));
        await asset.downloadAsync();
        const text = await new File(asset.localUri ?? asset.uri).text();
        if (alive) setHtml(text);
      } catch {
        // 자산을 못 읽으면 추출기는 등록되지 않은 채로 둔다(붙여넣기 안내로 떨어진다).
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!html) return;
    return registerPdfExtractor(async (uri) => {
      await readyRef.current;
      if (pendingRef.current) throw new Error('busy');
      const b64 = await new File(uri).base64();
      return new Promise<string>((resolve, reject) => {
        pendingRef.current = { resolve, reject };
        webviewRef.current?.injectJavaScript(`window.__extractPdf(${JSON.stringify(b64)}); true;`);
      });
    });
  }, [html]);

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: { ready?: boolean; ok?: boolean; text?: string; error?: string };
    try {
      msg = JSON.parse(e.nativeEvent.data) as typeof msg;
    } catch {
      return;
    }
    if (msg.ready) {
      resolveReadyRef.current?.();
      return;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    if (msg.ok) pending.resolve(msg.text ?? '');
    else pending.reject(new Error(msg.error ?? 'pdf'));
  };

  if (!html) return null;
  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={webviewRef}
        originWhitelist={['*']}
        // blob: 워커를 만들려면 불투명 오리진이 아니어야 해서 가짜 https 베이스를 준다.
        source={{ html, baseUrl: 'https://pdf.acttub.local/' }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled={false}
        allowFileAccess={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10 },
});
