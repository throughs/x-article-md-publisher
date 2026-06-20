param(
  [ValidateSet("start", "stop", "restart", "status", "help")]
  [string]$Command = "help",
  [string]$Article = ""
)

$ErrorActionPreference = "Stop"
$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$Port = if ($env:PORT) { [int]$env:PORT } else { 8765 }
$PidFile = Join-Path $RootDir ".xarticle-server.pid"
$LogFile = Join-Path $RootDir ".xarticle-server.log"
$ErrFile = Join-Path $RootDir ".xarticle-server.err.log"
$Server = Join-Path $RootDir "xarticle-server.js"

function Show-Usage {
  Write-Host "X Article Markdown Publisher local server"
  Write-Host ""
  Write-Host "Usage:"
  Write-Host "  .\scripts\xarticle-server.ps1 start               Start dashboard only, then load Markdown in browser"
  Write-Host "  .\scripts\xarticle-server.ps1 start article.md    Start and preload a Markdown file"
  Write-Host "  .\scripts\xarticle-server.ps1 restart             Restart dashboard only"
  Write-Host "  .\scripts\xarticle-server.ps1 restart article.md  Restart and preload a Markdown file"
  Write-Host "  .\scripts\xarticle-server.ps1 status              Show server status and recent log"
  Write-Host "  .\scripts\xarticle-server.ps1 stop                Stop the server started by this script"
  Write-Host "  .\scripts\xarticle-server.ps1 help                Show this help"
  Write-Host ""
  Write-Host "Examples:"
  Write-Host "  .\scripts\xarticle-server.ps1 start"
  Write-Host "  .\scripts\xarticle-server.ps1 start `"C:\Users\you\article.md`""
  Write-Host "  .\scripts\xarticle-server.ps1 status"
  Write-Host "  .\scripts\xarticle-server.ps1 stop"
  Write-Host ""
  Write-Host "Environment:"
  Write-Host "  `$env:PORT=8765               Override the dashboard port"
  Write-Host ""
  Write-Host "Dashboard:"
  Write-Host "  http://localhost:$Port"
}

function Write-StartHint([string]$ArticlePath) {
  Write-Host ""
  Write-Host "Dashboard: http://localhost:$Port"
  Write-Host "Log: $LogFile"
  if ($ArticlePath) {
    Write-Host "Article: $ArticlePath"
    Write-Host "Next: open the dashboard or X Articles editor, then click the extension button."
  } else {
    Write-Host "Article: none loaded"
    Write-Host "Next: open the dashboard and load Markdown by local path, dropped file, or pasted text."
  }
}

function Get-PidFromFile {
  if (Test-Path $PidFile) {
    $raw = (Get-Content $PidFile -Raw).Trim()
    if ($raw -match '^\d+$') { return [int]$raw }
  }
  return $null
}

function Test-PidRunning([Nullable[int]]$ProcessId) {
  if (-not $ProcessId) { return $false }
  return [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Get-PortPid {
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { return [int]$conn.OwningProcess }
  } catch {
    return $null
  }
  return $null
}

function Test-ServerReady {
  try {
    Invoke-WebRequest -Uri "http://localhost:$Port/status" -UseBasicParsing -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Start-XArticleServer([string]$ArticlePath) {
  if ($ArticlePath -and -not (Test-Path $ArticlePath -PathType Leaf)) {
    throw "Markdown file not found: $ArticlePath`nTip: run '.\scripts\xarticle-server.ps1 start' without a file to load Markdown from the dashboard."
  }

  $pidFromFile = Get-PidFromFile
  if (Test-PidRunning $pidFromFile) {
    Write-Host "X Article server is already running. PID: $pidFromFile"
    Write-StartHint $ArticlePath
    return
  }

  $existing = Get-PortPid
  if ($existing) {
    if (Test-ServerReady) {
      Set-Content -Path $PidFile -Value $existing -NoNewline
      Write-Host "X Article server is already running on port $Port. PID: $existing"
      Write-StartHint $ArticlePath
      return
    }
    throw "Port $Port is already used by PID $existing, but it does not look like this server."
  }

  "" | Set-Content -Path $LogFile
  "" | Set-Content -Path $ErrFile
  $nodeArgs = @($Server)
  if ($ArticlePath) { $nodeArgs += $ArticlePath } else { $nodeArgs += "" }
  $nodeArgs += [string]$Port

  $proc = Start-Process -FilePath "node" `
    -ArgumentList $nodeArgs `
    -WorkingDirectory $RootDir `
    -RedirectStandardOutput $LogFile `
    -RedirectStandardError $ErrFile `
    -WindowStyle Hidden `
    -PassThru

  $ready = $false
  for ($i = 0; $i -lt 50; $i++) {
    if (-not (Test-PidRunning $proc.Id)) { break }
    if (Test-ServerReady) { $ready = $true; break }
    Start-Sleep -Milliseconds 200
  }

  if (-not $ready) {
    Write-Host "X Article server failed to start. Recent log:"
    if (Test-Path $LogFile) { Get-Content $LogFile -Tail 40 }
    if (Test-Path $ErrFile) { Get-Content $ErrFile -Tail 40 }
    exit 1
  }

  Set-Content -Path $PidFile -Value $proc.Id -NoNewline
  Write-Host "X Article server started. PID: $($proc.Id)"
  Write-StartHint $ArticlePath
}

function Stop-XArticleServer {
  $pidFromFile = Get-PidFromFile
  if (Test-PidRunning $pidFromFile) {
    Write-Host "Stopping X Article server PID $pidFromFile..."
    Stop-Process -Id $pidFromFile -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    if (Test-PidRunning $pidFromFile) {
      throw "Process did not stop. Leaving it running."
    }
    Remove-Item $PidFile -ErrorAction SilentlyContinue
    Write-Host "Stopped."
    return
  }

  Remove-Item $PidFile -ErrorAction SilentlyContinue
  $existing = Get-PortPid
  if ($existing) {
    throw "No PID file process is running, but port $Port is used by PID $existing. Not killing unknown process."
  }
  Write-Host "X Article server is not running."
}

function Show-Status {
  $pidFromFile = Get-PidFromFile
  if (Test-PidRunning $pidFromFile) {
    Write-Host "X Article server: running"
    Write-Host "PID: $pidFromFile"
    Write-Host "Port: $Port"
    Write-Host "Dashboard: http://localhost:$Port"
  } else {
    Write-Host "X Article server: not running from $PidFile"
    $existing = Get-PortPid
    if ($existing) { Write-Host "Port $Port is occupied by PID $existing" }
  }
  Write-Host "Log: $LogFile"
  if (Test-Path $LogFile) {
    Write-Host "Recent log:"
    Get-Content $LogFile -Tail 20
  }
  if (Test-Path $ErrFile) {
    $err = Get-Content $ErrFile -Tail 20
    if ($err) {
      Write-Host "Recent error log:"
      $err
    }
  }
}

switch ($Command) {
  "start" { Start-XArticleServer $Article }
  "stop" { Stop-XArticleServer }
  "restart" { try { Stop-XArticleServer } catch { Write-Host $_.Exception.Message }; Start-XArticleServer $Article }
  "status" { Show-Status }
  "help" { Show-Usage }
}
