@echo off
set "HTTP_PROXY=http://127.0.0.1:33210"
set "HTTPS_PROXY=http://127.0.0.1:33210"
set "NO_PROXY=localhost,127.0.0.1,::1"

codex
