/**
 * 브라우저에서 `fs` 자리에 놓는 빈 모듈.
 *
 * hwp.js 는 파일 경로로도 읽을 수 있게 만들어져 있어 `fs` 를 부른다. 우리는 이미
 * 읽어 둔 바이트를 넘기므로 그 길로 가지 않는다 — 부르는 일이 없으니 비워 둔다.
 */
const notAvailable = () => {
  throw new Error("브라우저에서는 파일 경로로 읽을 수 없다. 바이트를 넘겨라.");
};

export const readFileSync = notAvailable;
export const writeFileSync = notAvailable;
export const readFile = notAvailable;
export const writeFile = notAvailable;

const stub = { readFileSync, writeFileSync, readFile, writeFile };

export default stub;
