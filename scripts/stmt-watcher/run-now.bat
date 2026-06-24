@echo off
REM JAG Statement Watcher — manual run
REM Drop PDFs/CSVs into the configured watch folders, then run this.
REM Requires KC_PASSWORD to be set:  set KC_PASSWORD=yourpassword  (or set once per session)

cd /d "%~dp0"
node dist\index.js
