param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [string]$ContainerName = $(if ($env:POSTGRES_CONTAINER) { $env:POSTGRES_CONTAINER } else { "miaomiao-points-postgres-1" })
)

$ErrorActionPreference = "Stop"
if (-not $env:DATABASE_URL) {
  throw "请先设置 DATABASE_URL"
}
if (-not (Test-Path -LiteralPath $BackupFile)) {
  throw "备份文件不存在：$BackupFile"
}
$checksumFile = "$BackupFile.sha256"
if (Test-Path -LiteralPath $checksumFile) {
  $expectedHash = ((Get-Content -LiteralPath $checksumFile -Raw).Trim() -split "\s+")[0].ToLowerInvariant()
  $actualHash = (Get-FileHash -LiteralPath $BackupFile -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expectedHash -ne $actualHash) {
    throw "备份文件 SHA-256 校验失败，已停止恢复"
  }
}

if (Get-Command pg_restore -ErrorAction SilentlyContinue) {
  pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$env:DATABASE_URL" "$BackupFile"
} else {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "未找到 pg_restore 或 Docker，无法执行恢复"
  }
  $remote = "/tmp/miaomiao-restore-$([guid]::NewGuid().ToString('N')).dump"
  docker cp $BackupFile "${ContainerName}:$remote"
  if ($LASTEXITCODE -ne 0) { throw "备份文件复制到数据库容器失败" }
  $dbUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "postgres" }
  $dbName = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "miaomiao" }
  docker exec $ContainerName pg_restore --clean --if-exists --no-owner --no-privileges -U $dbUser -d $dbName $remote
  $restoreExit = $LASTEXITCODE
  docker exec $ContainerName rm -f $remote | Out-Null
  if ($restoreExit -ne 0) { throw "容器内 pg_restore 执行失败" }
}
Write-Output "恢复完成：$BackupFile"
