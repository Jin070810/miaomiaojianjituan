param(
  [string]$OutputDirectory = ".\backups",
  [string]$ContainerName = $(if ($env:POSTGRES_CONTAINER) { $env:POSTGRES_CONTAINER } else { "miaomiao-points-postgres-1" })
)

$ErrorActionPreference = "Stop"
if (-not $env:DATABASE_URL) {
  throw "请先设置 DATABASE_URL"
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $OutputDirectory "miaomiao-$stamp.dump"
if (Get-Command pg_dump -ErrorAction SilentlyContinue) {
  pg_dump --format=custom --no-owner --no-privileges --file="$target" "$env:DATABASE_URL"
} else {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "未找到 pg_dump 或 Docker，无法执行备份"
  }
  $dbUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "postgres" }
  $dbName = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "miaomiao" }
  $remote = "/tmp/miaomiao-$stamp.dump"
  docker exec $ContainerName pg_dump --format=custom --no-owner --no-privileges --file=$remote -U $dbUser $dbName
  if ($LASTEXITCODE -ne 0) { throw "容器内 pg_dump 执行失败" }
  docker cp "${ContainerName}:$remote" $target
  docker exec $ContainerName rm -f $remote | Out-Null
}
$hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumFile = "$target.sha256"
Set-Content -LiteralPath $checksumFile -Value "$hash  $([System.IO.Path]::GetFileName($target))" -Encoding ascii
Write-Output "备份完成：$target"
Write-Output "校验文件：$checksumFile"
