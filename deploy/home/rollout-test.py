"""실제 deploy.sh·nginx로 롤백 중 긴 요청과 같은 태그 재빌드를 검증한다.

python3 deploy/home/rollout-test.py <Node가 있는 웹 이미지>
API·웹·DB는 격리된 모형이며 운영 접속·외부 모델 호출은 없다.
"""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import uuid


ROOT = Path(__file__).resolve().parents[2]
APP = r"""
const http = require('node:http');
http.createServer((req, res) => {
  if (process.env.ROLE === 'web') {
    if (req.url === '/') { res.end(process.env.REVIEW_MARKER); return; }
    const up = http.request('http://api:8080' + req.url, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    up.on('error', error => { res.statusCode = 502; res.end(error.code); });
    req.pipe(up); return;
  }
  if (req.url === '/slow') {
    setTimeout(() => res.end('completed ' + (process.env.WRONG_COMMIT || 'original')), 30000);
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({commit: process.env.WRONG_COMMIT || process.env.RENDER_GIT_COMMIT.slice(0, 7), marker: process.env.REVIEW_MARKER}));
}).listen(process.env.ROLE === 'web' ? 3000 : 8080, '0.0.0.0');
"""
COMPOSE = """
name: ${COMPOSE_PROJECT_NAME}
services:
  db:
    image: nginx:1.30.5-alpine
    healthcheck:
      test: [CMD, wget, -q, -O, /dev/null, 'http://127.0.0.1/']
      interval: 1s
      timeout: 1s
      retries: 3
  api:
    image: ${API_IMAGE}
    entrypoint: [node, /review/app.cjs]
    volumes: ['./app.cjs:/review/app.cjs:ro']
    env_file: [.env, release.env]
    environment: {ROLE: api}
    networks: [default]
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
      interval: 1s
      timeout: 2s
      retries: 3
  web:
    image: ${WEB_IMAGE}
    entrypoint: [node, /review/app.cjs]
    volumes: ['./app.cjs:/review/app.cjs:ro']
    environment: {ROLE: web}
    networks: [front]
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
      interval: 1s
      timeout: 2s
      retries: 3
  proxy:
    image: nginx:1.30.5-alpine
    command: [nginx, -c, /etc/nginx/acttub/nginx.conf, -g, 'daemon off;']
    volumes: ['./proxy:/etc/nginx/acttub:ro']
    networks:
      default: {}
      front: {aliases: [api]}
      edge: {aliases: [web]}
    healthcheck:
      test: [CMD, wget, -q, -O, /dev/null, 'http://127.0.0.1:8081/ping']
      interval: 1s
      timeout: 1s
      retries: 3
networks:
  default: {}
  front: {}
  edge: {}
"""


def main() -> None:
    base = sys.argv[1]
    project = "rollout-test-" + uuid.uuid4().hex[:10]
    image, bad_web = project + ":same-sha", project + ":bad-web"
    with tempfile.TemporaryDirectory(prefix=project) as directory:
        work = Path(directory)

        def run(*args: str) -> str:
            return subprocess.check_output(args, cwd=work, text=True, stderr=subprocess.STDOUT).strip()

        def compose(*args: str) -> str:
            return run("docker", "compose", "--env-file", ".env", "--env-file", "release.env", *args)

        def deploy(web: str = image) -> subprocess.Popen[str]:
            return subprocess.Popen(
                [str(ROOT / "deploy/home/deploy.sh"), "0123456789abcdef", image, web],
                cwd=work, stdout=log, stderr=subprocess.STDOUT,
                env={**os.environ, "DEPLOY_PULL_POLICY": "missing", "DEPLOY_WAIT_SECONDS": "30"},
                text=True,
            )

        def build(marker: str) -> None:
            (work / "Dockerfile").write_text(f"FROM {base}\nENV REVIEW_MARKER={marker}\n")
            run("docker", "build", "--network=none", "-t", image, str(work))

        def get(path: str) -> str:
            return compose("exec", "-T", "proxy", "wget", "-q", "-O", "-", "http://127.0.0.1:3000" + path)

        (work / "proxy").mkdir()
        shutil.copy(ROOT / "deploy/home/proxy/nginx.conf", work / "proxy/nginx.conf")
        (work / "app.cjs").write_text(APP)
        (work / "compose.yml").write_text(COMPOSE)
        env = "COMPOSE_PROJECT_NAME=" + project + "\n"
        (work / ".env").write_text(env)
        (work / "release.env").write_text(f"API_IMAGE={image}\nWEB_IMAGE={image}\nRENDER_GIT_COMMIT=0123456789abcdef\n")
        active_deploy = None
        client = None
        with (work / "deploy.log").open("w+") as log:
            try:
                build("v1")
                active_deploy = deploy()
                assert active_deploy.wait(timeout=90) == 0, "첫 배포 실패"
                before = {service: compose("ps", "-q", service) for service in ("api", "web")}
                run("docker", "run", "-d", "--rm", "--name", project + "-client", "--network", project + "_edge",
                    "--entrypoint", "node", base, "-e", "setInterval(()=>{},1000)")
                run("docker", "tag", image, bad_web)
                (work / ".env").write_text(env + "WRONG_COMMIT=fffffff\n")
                active_deploy = deploy(bad_web)
                deadline = time.monotonic() + 45
                while time.monotonic() < deadline:
                    if json.loads(get("/health"))["commit"] == "fffffff":
                        break
                    time.sleep(0.1)
                else:
                    raise AssertionError("새 판으로 전환되지 않았다")
                client = subprocess.Popen(
                    ["docker", "exec", project + "-client", "node", "-e",
                     "fetch('http://web:3000/slow').then(async r=>console.log(JSON.stringify({status:r.status,body:await r.text()}))).catch(e=>{console.error(e);process.exit(1)})"],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                )
                assert active_deploy.wait(timeout=90) == 1, "commit 불일치 배포를 허용했다"
                stdout, stderr = client.communicate(timeout=40)
                response = json.loads(stdout) if stdout else {"error": stderr}
                rollback_health = json.loads(get("/health"))
                after_rollback = {service: compose("ps", "-q", service) for service in before}
                (work / ".env").write_text(env)
                build("v2")
                desired = run("docker", "image", "inspect", "-f", "{{.Id}}", image)
                active_deploy = deploy()
                assert active_deploy.wait(timeout=90) == 0, "같은 태그 재빌드 배포 실패"
                after_rebuild = {service: compose("ps", "-q", service) for service in before}
                actual = {service: run("docker", "inspect", "-f", "{{.Image}}", container)
                          for service, container in after_rebuild.items()}
                rebuilt_health, rebuilt_web = json.loads(get("/health")), get("/")
                active_deploy = deploy()
                assert active_deploy.wait(timeout=90) == 0, "같은 이미지 재실행 실패"
                repeated = {service: compose("ps", "-q", service) for service in before}
                print(json.dumps({"rollback_response": response, "after_rollback": rollback_health,
                                  "rebuilt_api": rebuilt_health, "rebuilt_web": rebuilt_web,
                                  "running_images": actual, "desired_image": desired}, ensure_ascii=False))
                assert response == {"status": 200, "body": "completed fffffff"}, "새 판이 받았던 요청을 롤백이 끊었다"
                assert after_rollback == before, "롤백 후 기존 컨테이너가 보존되지 않았다"
                assert rollback_health == {"commit": "0123456", "marker": "v1"}
                assert rebuilt_health == {"commit": "0123456", "marker": "v2"}
                assert rebuilt_web == "v2", "같은 태그의 새 웹 이미지가 반영되지 않았다"
                assert all(actual[service] == desired for service in before), "실행 이미지가 새 이미지와 다르다"
                assert repeated == after_rebuild, "같은 이미지 재실행이 컨테이너를 교체했다"
                print("✔ 롤백 중 30초 요청 200 · 기존 판 복구 · 같은 태그 API·웹 v2 반영 · 재실행 무변경")
            except BaseException:
                log.flush()
                print((work / "deploy.log").read_text(), file=sys.stderr)
                raise
            finally:
                if active_deploy is not None and active_deploy.poll() is None:
                    active_deploy.terminate()
                    active_deploy.wait(timeout=10)
                subprocess.run(["docker", "rm", "-f", project + "-client"], capture_output=True)
                if client is not None:
                    client.communicate(timeout=10)
                compose("down", "--remove-orphans", "--volumes")
                run("docker", "image", "rm", image, bad_web)


if __name__ == "__main__":
    main()
