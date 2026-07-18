# acting-api 서버 + 외부 터널 기동 스크립트
# 사용: .\start_server.ps1          (서버만)
#       .\start_server.ps1 -Tunnel  (서버 + cloudflared 임시 URL)
param([switch]$Tunnel)

$root = $PSScriptRoot

Start-Process -FilePath "py" `
    -ArgumentList "-m","uv","run","uvicorn","acting_api.app:create_app","--factory","--host","127.0.0.1","--port","8000" `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput "$root\server.log" -RedirectStandardError "$root\server.err.log"
Write-Host "uvicorn started on http://127.0.0.1:8000 (logs: server.err.log)"

if ($Tunnel) {
    Start-Process -FilePath "$env:LOCALAPPDATA\cloudflared\cloudflared.exe" `
        -ArgumentList "tunnel","--url","http://localhost:8000" `
        -WindowStyle Hidden `
        -RedirectStandardOutput "$root\tunnel.log" -RedirectStandardError "$root\tunnel.err.log"
    Start-Sleep -Seconds 8
    $m = Select-String -Path "$root\tunnel.err.log" -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
    if ($m) { Write-Host "tunnel URL: $($m.Matches[0].Value)" }
    else { Write-Host "tunnel URL not found yet — check tunnel.err.log" }
}
