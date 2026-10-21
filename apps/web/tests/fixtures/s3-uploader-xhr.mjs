// 브라우저 업로더(src/lib/media/s3-uploader.ts)가 쓰는 XMLHttpRequest 대역. 보낸 PUT 을 적어 두고
// 정해 둔 상태 코드로 답한다. 설치한 쪽이 끝나면 uninstall 로 걷는다.
export function installXhr({ status = 200 } = {}) {
  const sent = [];
  class FakeXhr {
    upload = {};
    status = 0;
    open(method, url) {
      this.request = { method, url, headers: {} };
    }
    setRequestHeader(name, value) {
      this.request.headers[name] = value;
    }
    send(body) {
      sent.push({ ...this.request, size: body.size });
      queueMicrotask(() => {
        this.status = status;
        this.onload?.();
      });
    }
    abort() {
      this.onabort?.();
    }
  }
  const previous = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = FakeXhr;
  return {
    sent,
    uninstall() {
      if (previous === undefined) delete globalThis.XMLHttpRequest;
      else globalThis.XMLHttpRequest = previous;
    },
  };
}
