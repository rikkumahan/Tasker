@echo off
git add .
git commit -m "perf: optimize action extractor context density and parallelize reconciler db loop"
for /f "tokens=*" %%i in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%i
git push -u origin %BRANCH%
echo ✅ Successfully pushed to %BRANCH%!
pause
