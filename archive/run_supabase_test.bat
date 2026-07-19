@echo off
echo Starting local Supabase Edge Function server for test_pii...
echo Press Ctrl+C in this terminal window to stop the server when done.
npx supabase functions serve test_pii --no-verify-jwt
pause
