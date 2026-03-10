---
name: onboarding_categories
description: Script to fetch recent emails and use Sarvam.ai to generate personalized categories for the user during initial setup.
---

# Generate Personalized Categories

## Goal
Upon first-time setup, the system should analyze the user's organic email inbox to categorize the *types* of tasks they typically receive. This replaces hardcoded categories with personalized ones (e.g., `Academic_Deadline`, `Opportunity`, `Admin_Notice`).

## Trigger
- **Manual / Setup Script:** Ran once by the user or the AI agent during the initial repository configuration.

## Inputs
- Gmail account (OAuth via `credentials.json` and `token.json`)
- Sarvam.ai API key (read from `.env`)
- Supabase URL + service role key (read from `.env`)

## Execution (Python Script)
Save this script to: `execution/generate_categories.py`

### 1. Fetch Organic Emails
- Authenticate with Gmail API locally.
- Use `messages().list()` with no query/filters (or very broad ones like `is:unread` if preferenced, but no subject keywords).
- Fetch the last 50-100 emails.
- Extract `subject`, `from`, and a `body_preview` (first ~1000 characters).

### 2. Prepare LLM Input
Construct a prompt that feeds a subset of the extracted emails (or the distinct subjects/senders to save tokens) to the Sarvam.ai API (`https://api.sarvam.ai/v1/chat/completions`).

```text
You are an AI assistant helping a student organize their tasks.
Look at the following sample of recent emails from their inbox.

Emails:
{{email_samples}}

Based on this content, define EXACTLY 5 broad categories that these emails can be grouped into for a task manager dashboard.
Categories should be single snake_case strings (e.g., academic_deadline, club_event, internship_opportunity).

Return ONLY a JSON array of 5 strings.
["category_1", "category_2", "category_3", "category_4", "category_5"]
```

### 3. Call Sarvam.ai Model
- Use `sarvam-m` model (or fallback to OpenAI if Sarvam is unavailable).
- Request JSON formatting.

### 4. Supabase Upsert
- Connect to Supabase using the Python `supabase` client.
- Insert the generated array of 5 strings into the `user_settings` table.
- Since this is a single-user system, you can either clear the table first and insert one row, or just rely on a `default` user ID.

```python
# Example Supabase update
supabase.table("user_settings").insert({"categories": generated_categories}).execute()
```

## Outputs
- `user_settings` table in Supabase contains a single row with the `categories` array populated.
- Console output confirming the 5 generated categories.

## Edge Cases
- If Sarvam.ai fails to return a valid JSON array, fallback to a sensible default array `["Academic", "Administrative", "Opportunities", "Events", "Other"]`.
- Ensure `.env` is loaded using `python-dotenv`.
