# og-font-subset.ttf

OG 이미지(`src/app/opengraph-image.tsx`) 빌드타임 렌더 전용 폰트. Noto Sans KR Bold(wght=700)를 ASCII printable + 태그라인 한글(`질문으로다시보는연기연습`) + `—`·`·` 글리프로 서브셋한 파일이다(150 글리프, 약 20KB). 라이선스는 동봉된 `OFL.txt`(SIL Open Font License 1.1).

OG 이미지 문구를 바꾸면 새 글자가 이 서브셋에 없어 렌더가 깨진다. 그 경우 재생성:

```bash
curl -sL -o notosanskr-var.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf"
uvx --from fonttools fonttools varLib.instancer notosanskr-var.ttf wght=700 -o notosanskr-bold.ttf
python3 -c "print(''.join(chr(c) for c in range(0x20,0x7F)) + '<새 문구의 한글> + —·', end='')" > glyphs.txt
uvx --from fonttools pyftsubset notosanskr-bold.ttf --text-file=glyphs.txt --output-file=og-font-subset.ttf --no-hinting
```
