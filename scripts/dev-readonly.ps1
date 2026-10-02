# 로컬 테스트 서버를 "읽기 전용" KV 키로 실행한다.
# .env.local 에 쓰기용 KV_REST_API_TOKEN 이 있어도 읽기 전용 키로 덮어써서,
# 로컬에서 테스트하는 동안 실제 공유 학습 데이터·통계에는 절대 쓰지 않는다.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$ro = $null
if (Test-Path "$repo\.env.local") {
  foreach ($line in Get-Content "$repo\.env.local" -Encoding utf8) {
    if ($line -match '^\s*KV_REST_API_READ_ONLY_TOKEN\s*=\s*(.*)$') { $ro = $Matches[1].Trim().Trim('"') }
  }
}
if ($ro) {
  # Next.js 는 이미 설정된 환경변수를 .env.local 보다 우선한다.
  $env:KV_REST_API_TOKEN = $ro
} else {
  # 읽기 전용 키가 없으면 KV 를 아예 끄고 메모리 저장으로만 동작한다.
  $env:KV_REST_API_URL = ''
  $env:KV_REST_API_TOKEN = ''
}
Set-Location $repo
npx next dev -p 3000
