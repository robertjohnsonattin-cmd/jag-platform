@echo off
title JAG — Ollama Batch (Run Now)
cd /d "%~dp0"

echo ============================================================
echo  JAG Holdings — Ollama Document Batch
echo  Processes all PENDING document jobs immediately
echo ============================================================
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0run-batch.ps1"

echo.
if %ERRORLEVEL% EQU 0 (
    echo  Batch completed successfully.
) else (
    echo  Batch finished with errors ^(exit code %ERRORLEVEL%^).
    echo  Check run-batch.log and batch-stderr.log for details.
)
echo.
pause
