@echo off
echo Adding modified files to Git...
git add supabase/migrations/021_queue_debounce.sql supabase/functions/webhook_ingest/index.ts supabase/functions/background_worker/index.ts AGENTS.md

echo Committing changes...
git commit -m "feat(queue): Implement pure queue-state debounce for webhooks" -m "Optimize webhook ingestion and background worker invocation during burst periods to reduce Edge Function invocations and eliminate database lock collisions." -m "Co-Authored-By: Antigravity <antigravity@gemini.google>"

echo Pushing to GitHub...
git push

echo Done!
pause
