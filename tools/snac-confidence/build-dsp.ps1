param(
    [Parameter(Mandatory = $true)][string] $DspRel,
    [string] $OutExe = "dsp_cli_conf.exe"
)

$ErrorActionPreference = "Stop"
$repo = "C:\dev\mc-420"
$cliDir = Join-Path $repo "tools\dsp-cli"
$gen = Join-Path $cliDir "dsp_generated.cpp"

Set-Location $repo
& "C:\Faust\bin\faust.exe" -lang cpp -vec -fun -dfs -vs 32 -nvi -ct 0 -cn AloopEffectDsp `
    -I dsp -I effects/home/faust $DspRel -o $gen
if ($LASTEXITCODE -ne 0) { throw "faust codegen failed ($LASTEXITCODE)" }

$vcvars = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
$cl = "cl.exe /nologo /O2 /std:c++17 /EHsc /I `"$repo\effects\home\faust`" dsp_cli.cpp /Fe:$OutExe"
Set-Location $cliDir
$prev = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& cmd.exe /c "`"$vcvars`" >nul && $cl" 2>&1 | Out-Null
$rc = $LASTEXITCODE
$ErrorActionPreference = $prev
if ($rc -ne 0) { throw "msvc compile failed ($rc)" }

Write-Output "OK: $OutExe"
