@echo off
echo Triggering test_pii on live Supabase...
curl -X POST "https://esngoeuhtpdzyfttofyu.supabase.co/functions/v1/test_pii" -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzbmdvZXVodHBkenlmdHRvZnl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNjIzNDQsImV4cCI6MjA4ODczODM0NH0.cqgKh0m2osCqGDm1eamQF9WLVZXYgLd8opuk2Yo-EN8" -H "Content-Type: application/json"
echo.
pause
