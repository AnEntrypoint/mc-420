@echo off
REM build.bat <repo_root> <path\to\effect.dsp relative to repo_root> [faust extra args]
REM Compiles any mc-420 Faust DSP file to dsp_cli.exe -- pure CLI,
REM no GUI, no PortAudio/JACK/ALSA/libsndfile. Just faust.exe + MSVC.
REM
REM repo_root is required (not guessed) because component("effects/home/
REM faust/...") paths inside this repo's own .dsp files are only valid
REM relative to the repo's own root -- faust resolves them by combining
REM -I dirs with the literal path string, not by stripping a matching
REM prefix.
setlocal
if "%~2"=="" (
    echo usage: build.bat ^<repo_root^> ^<dsp_file_relative_to_repo_root^> [faust extra args like -I includedir]
    echo example: build.bat C:\dev\mc-420 effects\home\faust\multitranspose.dsp -I dsp -I effects\home\faust
    exit /b 1
)
set REPO_ROOT=%~1
set DSP_REL=%~2
shift
shift
set EXTRA_ARGS=
:collectargs
if "%~1"=="" goto doneargs
set EXTRA_ARGS=%EXTRA_ARGS% %1
shift
goto collectargs
:doneargs

set TOOL_DIR=%CD%
set OUTFILE=%TOOL_DIR%\dsp_generated.cpp

echo Compiling %DSP_REL% (repo root: %REPO_ROOT%) via faust...
pushd "%REPO_ROOT%"
"C:\Faust\bin\faust.exe" -lang cpp -cn AloopEffectDsp %EXTRA_ARGS% "%DSP_REL%" -o "%OUTFILE%"
set FAUST_RC=%errorlevel%
popd
if not %FAUST_RC%==0 (
    echo faust compile failed.
    exit /b 1
)

echo Building dsp_cli.exe...
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
REM Some effect stages (e.g. pitch.dsp, pitch_poly.dsp) ffunction-import a
REM companion C++ header (pitch_ffi.h / pitch_poly_ffi.h) that faust's own
REM codegen references by #include but never copies alongside the
REM generated .cpp -- point MSVC at the ORIGINAL repo's effects/home/faust
REM dir (where those headers actually live) so it resolves. Both are
REM header-only (static/static inline), so no separate link step is
REM needed beyond this include path. Harmless /I if the current .dsp
REM doesn't need it.
cl.exe /nologo /O2 /std:c++17 /EHsc /I "%REPO_ROOT%\effects\home\faust" dsp_cli.cpp /Fe:dsp_cli.exe
if errorlevel 1 (
    echo build failed.
    exit /b 1
)

echo.
echo Done: dsp_cli.exe
echo.
echo Try:
echo   dsp_cli --list-zones
echo   dsp_cli --gen sine:440:2.0 out.wav HPCUT=0.3
echo   dsp_cli --stats out.wav
