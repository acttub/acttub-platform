# 원본 프로젝트 -> deploy repo 동기화 스크립트
# 사용: 이 repo 루트에서 .\sync_deploy.ps1  ->  git diff 확인  ->  commit/push하면 Render 자동 재배포
$src = "C:\Users\RJS\Desktop\project"
$dst = $PSScriptRoot

foreach ($d in "acting-api", "acting-summary", "acting-report", "acting_agent") {
    robocopy "$src\$d" "$dst\$d" /E /PURGE `
        /XD .git .venv .pytest_cache .ruff_cache __pycache__ .cache .superpowers batch_summaries data transcripts `
        /XF .env *.log *.html *.tmp gradio_stdout.txt gradio_stderr.txt /NFL /NDL /NJH /NJS
    if ($LASTEXITCODE -ge 8) { Write-Error "robocopy 실패: $d (code $LASTEXITCODE)"; exit 1 }
}
Write-Host "동기화 완료. git status로 변경 확인 후 commit/push."
git -C $dst status --short
