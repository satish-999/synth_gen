$ErrorActionPreference = 'Stop'
$synthRoot = $PSScriptRoot
$synthPort = 3080
try {
    $health = Invoke-RestMethod "http://127.0.0.1:$synthPort/api/health" -TimeoutSec 2
    if ($health.status -eq 'ok') { Write-Host "SynthGen is running at http://127.0.0.1:$synthPort"; return }
} catch { }
$localPython = Join-Path $synthRoot 'engine/.venv/Scripts/python.exe'
$bundledPython = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
if (Test-Path (Join-Path $synthRoot 'engine/python-packages/faker')) {
    $env:PYTHON_PATH = $bundledPython
    $env:PYTHONPATH = Join-Path $synthRoot 'engine/python-packages'
} elseif (Test-Path $localPython) {
    $env:PYTHON_PATH = $localPython
} else { throw 'Run Install-SynthGen.ps1 first.' }
$env:HOST = '127.0.0.1'
$env:PORT = "$synthPort"
$serverDir = Join-Path $synthRoot 'server'
$logDir = Join-Path $synthRoot 'runs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$nodeCommand = (Get-Command node -ErrorAction Stop).Source
$synthProcess = Start-Process -FilePath $nodeCommand -ArgumentList '--env-file-if-exists=.env','dist/index.js' -WorkingDirectory $serverDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'server.log') -RedirectStandardError (Join-Path $logDir 'server-error.log')
Set-Content -LiteralPath (Join-Path $logDir 'server.pid') -Value $synthProcess.Id
Write-Host "SynthGen is starting at http://127.0.0.1:$synthPort. Logs: $logDir"