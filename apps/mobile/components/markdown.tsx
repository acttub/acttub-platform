import { Fragment, useMemo } from 'react';
import {
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
  type TextStyle,
} from 'react-native';

import { parseMarkdown, type MarkdownSpan } from '@/lib/markdown';
import { palette } from '@/constants/palette';

/**
 * 마크다운 원문을 RN 텍스트로 그린다(파싱은 lib/markdown). 쓰는 곳이 동의 문서 본문(동의·설정
 * 화면, 고품질 목소리 동의 시트)뿐이라 빽빽한 작은 글자 크기 하나만 둔다.
 */
export function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  const size = compactSizes;
  const baseColor = palette.textDim;

  /**
   * 굵기는 각 Text가 자기 스타일로 들고 있어야 한다([[global-font]] — 굵기별 폰트 파일을 고르는
   * 방식이라 부모의 fontWeight가 자식에게 상속되지 않는다). 그래서 부모 굵기를 내려준다.
   */
  const renderSpans = (spans: MarkdownSpan[], inherited?: TextStyle['fontWeight']) =>
    spans.map((span, i) => (
      <Text
        key={i}
        style={[
          inherited ? { fontWeight: inherited } : null,
          span.bold && styles.bold,
          span.italic && styles.italic,
          span.code && styles.code,
          span.href && styles.link,
        ]}
        onPress={span.href ? () => void Linking.openURL(span.href!) : undefined}>
        {span.text}
      </Text>
    ));

  return (
    <View>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading':
            return (
              <Text
                key={index}
                style={[
                  styles.heading,
                  size.heading[block.level - 1],
                  { color: baseColor },
                  index > 0 && styles.headingSpaced,
                ]}>
                {renderSpans(block.spans, '800')}
              </Text>
            );
          case 'quote':
            return (
              <View key={index} style={styles.quote}>
                <Text style={[size.text, styles.quoteText]}>
                  {renderSpans(block.spans)}
                </Text>
              </View>
            );
          case 'rule':
            return <View key={index} style={styles.rule} />;
          case 'list':
            return (
              <View key={index} style={styles.list}>
                {block.items.map((item, i) => (
                  <View key={i} style={styles.listItem}>
                    <Text style={[size.text, { color: baseColor }, styles.bullet]}>
                      {block.ordered ? `${i + 1}.` : '•'}
                    </Text>
                    <Text style={[size.text, { color: baseColor }, styles.listText]}>
                      {renderSpans(item)}
                    </Text>
                  </View>
                ))}
              </View>
            );
          default:
            return (
              <Fragment key={index}>
                <Text style={[size.text, { color: baseColor }, styles.paragraph]}>
                  {renderSpans(block.spans)}
                </Text>
              </Fragment>
            );
        }
      })}
    </View>
  );
}

const compactSizes = {
  text: { fontSize: 13, lineHeight: 20 },
  heading: [
    { fontSize: 15, lineHeight: 22 },
    { fontSize: 14, lineHeight: 21 },
    { fontSize: 13, lineHeight: 20 },
  ],
};

const styles = StyleSheet.create({
  bold: { fontWeight: '800' },
  italic: { fontStyle: 'italic' },
  code: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: palette.bgSoft,
    fontSize: 13,
  },
  link: { color: palette.blue, textDecorationLine: 'underline' },
  heading: { fontWeight: '800' },
  headingSpaced: { marginTop: 14 },
  paragraph: { marginTop: 8 },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: palette.border,
    paddingLeft: 12,
    marginTop: 10,
  },
  quoteText: { color: palette.textDim },
  rule: { height: 1, backgroundColor: palette.border, marginVertical: 14 },
  list: { marginTop: 8, gap: 4 },
  listItem: { flexDirection: 'row', gap: 8 },
  bullet: { width: 16 },
  listText: { flex: 1 },
});
