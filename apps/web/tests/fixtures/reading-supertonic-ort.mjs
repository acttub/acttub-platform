// onnxruntime-web 대역. 실제 추론 대신 테스트가 정한 세션을 돌려주고, 만들어진 텐서와 세션 요청을 남긴다.
export const env = { wasm: {} };

export class Tensor {
  constructor(type, data, dims) {
    this.type = type;
    this.data = data;
    this.dims = dims;
  }
}

export const created = [];

/** 테스트가 바꿔 끼우는 자리. (경로나 바이트, 옵션) → 세션 */
export const sessions = {
  factory: () => {
    throw new Error("세션 대역이 정해지지 않았다");
  },
};

export const InferenceSession = {
  async create(source, options) {
    created.push({ source, options });
    return sessions.factory(source, options);
  },
};
