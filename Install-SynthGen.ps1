$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    python -m venv engine/.venv
    if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed.' }
    & engine/.venv/Scripts/python.exe -m pip install -r engine/requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
    Push-Location server
    try {
        npm.cmd ci --ignore-scripts
        if ($LASTEXITCODE -ne 0) { throw 'Server dependencies failed.' }
        node node_modules/typescript/bin/tsc
        if ($LASTEXITCODE -ne 0) { throw 'Server compilation failed.' }
    } finally { Pop-Location }
    Push-Location client
    try {
        npm.cmd ci --ignore-scripts
        if ($LASTEXITCODE -ne 0) { throw 'Client dependencies failed.' }
        npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend compilation failed.' }
    } finally { Pop-Location }
    Write-Host 'Installed. Run Start-SynthGen.ps1.'
} finally { Pop-Location }