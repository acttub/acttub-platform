// tests/compress-video.test.mjs 가 registerHooks 로 "mediabunny" 와 "@mediabunny/aac-encoder" 자리에
// 끼우는 대역. compress-video.ts 가 쓰는 표면만 mediabunny 1.50 타입대로 흉내 낸다.
// 테스트는 `fake` 로 입력 트랙과 변환 결과를 정하고, 대역이 받은 값을 `fake.calls` 에서 읽는다.

export const fake = {
  videoTracks: [],
  audioTracks: [],
  canEncodeAudio: true,
  // (initOptions) => Conversion 이 돌려줄 객체의 덮어쓸 필드
  conversion: () => ({}),
  outputBytes: 1,
  calls: null,
  reset() {
    this.videoTracks = [];
    this.audioTracks = [];
    this.canEncodeAudio = true;
    this.conversion = () => ({});
    this.outputBytes = 1;
    this.calls = { canEncodeAudio: [], init: null, videoConfig: null, aacRegistrations: 0, cancels: 0 };
  },
};
fake.reset();

export const MP4 = { name: "MP4" };
export const QTFF = { name: "QTFF" };

export class BlobSource {
  constructor(blob) {
    this.blob = blob;
  }
}

export class Input {
  constructor(options) {
    this.options = options;
  }

  async getVideoTracks() {
    return fake.videoTracks;
  }

  async getAudioTracks() {
    return fake.audioTracks;
  }

  dispose() {}
}

export class BufferTarget {
  buffer = null;
}

export class Mp4OutputFormat {
  constructor(options) {
    this.options = options;
  }
}

export class Output {
  constructor({ format, target }) {
    this.format = format;
    this.target = target;
  }
}

export async function canEncodeAudio(codec, config) {
  fake.calls.canEncodeAudio.push({ codec, ...config });
  return fake.canEncodeAudio;
}

export class Conversion {
  static async init(options) {
    fake.calls.init = options;
    fake.calls.videoConfig = await options.video(fake.videoTracks[0]);
    const utilizedTracks = [fake.videoTracks[0], fake.audioTracks[0]].filter(Boolean);
    return {
      isValid: true,
      utilizedTracks,
      discardedTracks: [],
      onProgress: undefined,
      async execute() {
        options.output.target.buffer = new ArrayBuffer(fake.outputBytes);
      },
      async cancel() {
        fake.calls.cancels += 1;
      },
      ...fake.conversion(options),
    };
  }
}

export function registerAacEncoder() {
  fake.calls.aacRegistrations += 1;
}
