@echo off
echo Deleting diagnostics_pii folder...
rmdir /s /q "supabase\functions\diagnostics_pii"
if exist "supabase\functions\diagnostics_pii" (
  echo ❌ Failed to delete diagnostics_pii folder.
) else (
  echo ✅ Successfully deleted diagnostics_pii folder!
)
pause
