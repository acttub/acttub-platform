// 랜딩의 공유 카드를 그대로 쓴다. `/app`이 자기 openGraph 를 export 하는 순간 루트의
// 파일 기반 이미지가 딸려오지 않아 og:image 없는 카드가 나가는데, 이 페이지는 인스타그램
// 프로필 링크라 공유가 잦다. 문구를 새로 쓰지 않는 이유는 카드 폰트가 필요한 글자만 담은
// subset(`src/lib/seo/fonts/og-font-subset.ttf`)이라 새 문장은 글자가 비기 때문이다.
export { default, alt, size, contentType } from "../opengraph-image";

export const dynamic = "force-static";
