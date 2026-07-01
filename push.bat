@echo off
git add .
git commit -m "perf: optimize graph triplet extraction and shrink typescript types using derived typeof const arrays"
for /f "tokens=*" %%i in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%i
git push -u origin %BRANCH%
echo ✅ Successfully pushed to %BRANCH%!
pause
