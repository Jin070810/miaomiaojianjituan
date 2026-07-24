param(
  [string]$BackupDirectory = ".\backups"
)

$ErrorActionPreference = "Stop"
$files = Get-ChildItem -LiteralPath $BackupDirectory -Filter "miaomiao-*.dump" -File | Sort-Object LastWriteTime -Descending
if ($files.Count -eq 0) { throw "未找到数据库备份：$BackupDirectory" }

$verified = 0
foreach ($file in $files) {
  $checksumPath = "$($file.FullName).sha256"
  if (-not (Test-Path -LiteralPath $checksumPath)) { throw "缺少校验文件：$checksumPath" }
  $expected = (Get-Content -LiteralPath $checksumPath -Raw).Trim().Split(" ")[0].ToLowerInvariant()
  $actual = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expected -ne $actual) { throw "备份校验失败：$($file.Name)" }
  if (Get-Command pg_restore -ErrorAction SilentlyContinue) {
    & pg_restore --list "$($file.FullName)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "备份归档无法读取：$($file.Name)" }
  }
  $verified += 1
}
Write-Output "已验证 $verified 个备份文件"
