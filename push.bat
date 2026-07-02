@echo off
git add .
git commit -m "chore: remove unused diagnostics_pii edge function"
for /f "tokens=*" %%i in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%i
git push -u origin %BRANCH%
echo ✅ Successfully pushed to %BRANCH%!
pause
