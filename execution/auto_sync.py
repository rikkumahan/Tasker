"""
auto_sync.py
--------------------------------------------
Serverless Cloud Engine (Designed for GitHub Actions).
Phase 10: Full async rewrite for parallel Gmail fetching + concurrent LLM calls.
"""

import os
import json
import base64
import asyncio
from datetime import datetime, timezone, timedelta
import httpx
from dotenv import load_dotenv
import traceback

IST = timezone(timedelta(hours=5, minutes=30))

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
SARVAM_API_KEY = os.getenv("SARVAM_API_KEY")
GMAIL_CLIENT_ID = os.getenv("GMAIL_CLIENT_ID")
GMAIL_CLIENT_SECRET = os.getenv("GMAIL_CLIENT_SECRET")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing Supabase credentials in environment.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ---------------------------------------------------------------------------
# Gmail Auth (sync — only happens once per user, fast)
# ---------------------------------------------------------------------------

def authenticate_gmail_stateless(settings_row):
    print("[INFO] Authenticating Gmail...")
    token_data = settings_row.get("gmail_token")
    if not token_data:
        raise ValueError("No gmail_token found in Supabase user_settings.")

    creds = Credentials(
        token=token_data.get("token"),
        refresh_token=token_data.get("refresh_token") or "",
        token_uri=token_data.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=GMAIL_CLIENT_ID or token_data.get("client_id"),
        client_secret=GMAIL_CLIENT_SECRET or token_data.get("client_secret"),
        scopes=token_data.get("scopes", ["https://www.googleapis.com/auth/gmail.readonly"])
    )

    if not creds.valid:
        if creds.expired and creds.refresh_token:
            print("[INFO] Token expired. Refreshing...")
            creds.refresh(Request())
            supabase.table("user_settings").update({
                "gmail_token": {
                    "token": creds.token,
                    "refresh_token": creds.refresh_token,
                    "token_uri": creds.token_uri,
                    "client_id": creds.client_id,
                    "client_secret": creds.client_secret,
                    "scopes": list(creds.scopes)
                }
            }).eq("id", settings_row["id"]).execute()
            print("[SUCCESS] Refreshed token saved.")
        else:
            raise ValueError("Gmail credentials invalid and cannot be refreshed.")

    return build("gmail", "v1", credentials=creds)

# ---------------------------------------------------------------------------
# Email body decoding
# ---------------------------------------------------------------------------

def decode_body(payload):
    body = ""
    mime = payload.get("mimeType", "")
    if mime == "text/plain":
        data = payload.get("body", {}).get("data", "")
        if data:
            body = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
    elif mime.startswith("multipart/"):
        for part in payload.get("parts", []):
            body = decode_body(part)
            if body:
                break
    return body.strip()

# ---------------------------------------------------------------------------
# PHASE 10 OPTIMIZATION 1: Parallel Gmail body fetching
# Gmail API is blocking — run each fetch in a thread via asyncio.to_thread
# This turns 25 sequential calls (~25s) into ~3-5s of parallel execution
# ---------------------------------------------------------------------------

async def fetch_single_email(service, msg_id):
    """Fetch one email body in a thread pool (non-blocking to asyncio event loop)."""
    try:
        full_msg = await asyncio.to_thread(
            lambda: service.users().messages().get(
                userId="me", id=msg_id, format="full"
            ).execute()
        )
        headers = {h["name"]: h["value"] for h in full_msg["payload"].get("headers", [])}
        body = decode_body(full_msg["payload"])
        body = body[:1500].replace("\n", " ").strip() if body else ""
        return {
            "id": msg_id,
            "subject": headers.get("Subject", "(no subject)"),
            "sender": headers.get("From", "unknown"),
            "date": headers.get("Date", ""),
            "body": body
        }
    except Exception as e:
        print(f"[WARNING] Failed to fetch email {msg_id}: {e}")
        return None

async def fetch_all_emails(service, settings_row):
    """Fetch email list then all bodies in PARALLEL."""
    last_synced_str = settings_row.get("last_synced_at")
    if last_synced_str:
        try:
            last_synced_dt = datetime.fromisoformat(last_synced_str.replace('Z', '+00:00'))
            epoch = int(last_synced_dt.timestamp())
            query = f"after:{epoch}"
            print(f"[INFO] Incremental sync from epoch {epoch}")
        except Exception as e:
            print(f"[WARNING] Failed to parse last_synced_at: {e}. Falling back to 48h.")
            epoch = int((datetime.now(timezone.utc) - timedelta(hours=48)).timestamp())
            query = f"after:{epoch}"
    else:
        epoch = int((datetime.now(timezone.utc) - timedelta(hours=48)).timestamp())
        query = f"after:{epoch}"
        print("[INFO] No last_synced_at. Using 48h fallback.")

    print(f"[INFO] Querying Gmail: {query}")
    result = await asyncio.to_thread(
        lambda: service.users().messages().list(userId="me", q=query, maxResults=25).execute()
    )
    messages = result.get("messages", [])
    if not messages:
        return []

    print(f"[INFO] Fetching {len(messages)} email bodies in parallel...")
    # PARALLEL: fire all body-fetch coroutines at once
    tasks = [fetch_single_email(service, m["id"]) for m in messages]
    results = await asyncio.gather(*tasks)
    return [r for r in results if r is not None]

# ---------------------------------------------------------------------------
# PHASE 10 OPTIMIZATION 2: Batch duplicate detection (1 DB query vs N queries)
# ---------------------------------------------------------------------------

def get_processed_email_ids(user_id):
    """One single DB call to get all already-processed email IDs for this user."""
    res = supabase.table("tasks") \
        .select("source_email_id") \
        .eq("user_id", user_id) \
        .execute()
    return {row["source_email_id"] for row in (res.data or [])}

# ---------------------------------------------------------------------------
# Persona Evolution (single LLM call, now async)
# ---------------------------------------------------------------------------

async def evolve_user_persona(client: httpx.AsyncClient, emails, settings_row):
    if not emails:
        return settings_row

    print(f"[INFO] Evolving persona based on {len(emails)} emails...")
    old_profile = settings_row.get("user_profile", "A college student who wants to organize academic and personal responsibilities.")
    old_categories = settings_row.get("categories", [])

    email_block = "\n---\n".join(
        f"Subject: {e['subject']}\nBody: {e['body'][:500]}"
        for e in emails[:10]
    )

    prompt = f"""You are an AI building a hyper-personalized task manager for a user.

CURRENT USER PROFILE:
"{old_profile}"

CURRENT CATEGORIES:
{old_categories}

NEW EMAILS:
{email_block}

1. Write a 3-4 sentence `user_profile` evolving the current one with new insights.
2. Define EXACTLY 5 broad categories (snake_case strings).

Return ONLY valid JSON:
{{
  "user_profile": "...",
  "categories": ["cat_1", "cat_2", "cat_3", "cat_4", "cat_5"]
}}"""

    try:
        resp = await client.post(
            "https://api.sarvam.ai/v1/chat/completions",
            headers={"Authorization": f"Bearer {SARVAM_API_KEY}", "Content-Type": "application/json"},
            json={"model": "sarvam-105b", "messages": [{"role": "user", "content": prompt}]},
            timeout=60.0
        )
        if resp.status_code == 200:
            reply = resp.json()["choices"][0]["message"]["content"]
            cleaned = reply.strip().strip("```json").strip("```").strip()
            parsed = json.loads(cleaned)
            if "user_profile" in parsed and "categories" in parsed:
                supabase.table("user_settings").update({
                    "user_profile": parsed["user_profile"],
                    "categories": parsed["categories"]
                }).eq("id", settings_row["id"]).execute()
                settings_row["user_profile"] = parsed["user_profile"]
                settings_row["categories"] = parsed["categories"]
                print("[SUCCESS] Persona evolved.")
    except Exception as e:
        print(f"[WARNING] Persona evolution failed: {e}")

    return settings_row

# ---------------------------------------------------------------------------
# PHASE 10 OPTIMIZATION 3: Parallel LLM extraction calls
# All emails fire their LLM requests concurrently via asyncio.gather
# ---------------------------------------------------------------------------

async def extract_single_email(client: httpx.AsyncClient, email, settings_row):
    """Extract tasks from ONE email — designed to run in parallel."""
    user_profile = settings_row.get("user_profile", "A typical student.")
    categories = settings_row.get("categories", [])
    user_id = settings_row.get("user_id")
    now_ist = datetime.now(IST).strftime("%Y-%m-%dT%H:%M:%S")

    prompt = f"""You are a productivity assistant extracting tasks from an email.

CURRENT DATE AND TIME (IST): {now_ist}
Do NOT extract tasks whose deadline has already passed before this time.

USER PROFILE:
"{user_profile}"

EMAIL:
From: {email['sender']}
Date: {email['date']}
Subject: {email['subject']}
Body: {email['body']}

Return ONLY a valid JSON array. Each element is one actionable task:
[
  {{
    "title": "short task name",
    "course": "course name or null",
    "deadline": "ISO 8601 without timezone suffix e.g. '2026-03-14T17:00:00'. If no time stated, use midnight. If no date at all, return null.",
    "end_time": "ISO 8601 end time if explicitly mentioned, else null",
    "location": "room/venue or null",
    "summary": "1-2 sentence summary",
    "category": "Pick ONE from: {categories}. If none fit, invent a concise snake_case label."
  }}
]

Rules:
- If purely informational with no deadline, use category "Check_Out_Mail".
- If spam or irrelevant to the user profile, return [].
- NO markdown fences. Only the raw JSON array.
"""

    try:
        resp = await client.post(
            "https://api.sarvam.ai/v1/chat/completions",
            headers={"Authorization": f"Bearer {SARVAM_API_KEY}", "Content-Type": "application/json"},
            json={"model": "sarvam-105b", "messages": [{"role": "user", "content": prompt}]},
            timeout=60.0
        )
        if resp.status_code != 200:
            print(f"[ERROR] Sarvam {resp.status_code} for email {email['id']}: {resp.text[:200]}")
            return []

        reply = resp.json()["choices"][0]["message"]["content"]
        if not reply:
            return []

        cleaned = reply.strip().strip("```json").strip("```").strip()
        extracted = json.loads(cleaned)

        results = []
        for t in extracted:
            t["source_email_id"] = email["id"]
            t["user_id"] = user_id
            t.pop("id", None)  # strip any hallucinated id key
            # Sanitize "null" strings
            if isinstance(t.get("deadline"), str) and t["deadline"].strip().lower() == "null":
                t["deadline"] = None
            if isinstance(t.get("end_time"), str) and t["end_time"].strip().lower() == "null":
                t["end_time"] = None
            results.append(t)
        return results

    except json.JSONDecodeError as e:
        print(f"[WARNING] JSON parse failed for email {email['id']}: {e}")
        return []
    except Exception as e:
        print(f"[ERROR] LLM request failed for email {email['id']}: {e}")
        return []


async def extract_tasks_parallel(client: httpx.AsyncClient, emails, settings_row):
    """Fire ALL LLM extraction calls in parallel — the core Phase 10 speedup."""
    if not emails:
        print("[INFO] No new emails to extract tasks from.")
        return []

    print(f"[INFO] Firing {len(emails)} LLM calls in parallel...")
    tasks = [extract_single_email(client, email, settings_row) for email in emails]
    results = await asyncio.gather(*tasks)

    # Flatten list of lists
    all_tasks = [task for email_tasks in results for task in email_tasks]
    print(f"[INFO] Extracted {len(all_tasks)} tasks total across all emails.")
    return all_tasks

# ---------------------------------------------------------------------------
# PHASE 10 OPTIMIZATION 4: Batch upsert instead of row-by-row
# ---------------------------------------------------------------------------

def upsert_tasks_batch(tasks):
    """Smart upsert: check existing in one query, then insert/update in minimal calls."""
    if not tasks:
        return

    print(f"[INFO] Upserting {len(tasks)} tasks...")
    user_id = tasks[0]["user_id"]

    # One query to find all existing tasks for this email batch
    email_ids = list({t["source_email_id"] for t in tasks})
    existing_res = supabase.table("tasks") \
        .select("source_email_id, deadline, id") \
        .eq("user_id", user_id) \
        .in_("source_email_id", email_ids) \
        .execute()

    existing_map = {row["source_email_id"]: row for row in (existing_res.data or [])}

    to_insert = []
    for task in tasks:
        eid = task["source_email_id"]
        if eid in existing_map:
            old = existing_map[eid]
            if str(old.get("deadline")) != str(task.get("deadline")) and task.get("deadline"):
                task["updated"] = True
                task["change_note"] = "Deadline or details updated by a recent email."
            supabase.table("tasks").update(task) \
                .eq("source_email_id", eid) \
                .eq("user_id", user_id) \
                .execute()
        else:
            to_insert.append(task)

    if to_insert:
        supabase.table("tasks").insert(to_insert).execute()
        print(f"[INFO] Inserted {len(to_insert)} new tasks.")

# ---------------------------------------------------------------------------
# Per-user sync (async)
# ---------------------------------------------------------------------------

async def sync_user(client: httpx.AsyncClient, user_row):
    user_id = user_row.get("user_id")
    print(f"\n[INFO] --- Syncing tenant: {user_id} ---")

    # 1. Auth (sync, fast)
    service = await asyncio.to_thread(authenticate_gmail_stateless, user_row)

    # 2. Fetch ALL emails in parallel
    emails = await fetch_all_emails(service, user_row)

    if not emails:
        print(f"[INFO] No new emails for {user_id}.")
        # Still update clock
        now_iso = datetime.now(timezone.utc).isoformat()
        supabase.table("user_settings").update({"last_synced_at": now_iso}).eq("id", user_row["id"]).execute()
        return

    # 3. Batch duplicate check (ONE query, not N)
    processed_ids = await asyncio.to_thread(get_processed_email_ids, user_id)
    new_emails = [e for e in emails if e["id"] not in processed_ids]
    print(f"[INFO] {len(emails)} emails fetched, {len(new_emails)} are new (not yet processed).")

    # 4. Evolve persona (concurrent with extraction prep)
    evolved_row = await evolve_user_persona(client, new_emails, user_row)

    # 5. Extract tasks from all new emails in PARALLEL
    tasks = await extract_tasks_parallel(client, new_emails, evolved_row)

    # 6. Batch upsert
    if tasks:
        await asyncio.to_thread(upsert_tasks_batch, tasks)

    # 7. Update sync clock (only on success)
    now_iso = datetime.now(timezone.utc).isoformat()
    supabase.table("user_settings").update({"last_synced_at": now_iso}).eq("id", user_row["id"]).execute()
    print(f"[SUCCESS] Tenant {user_id} synced. Clock → {now_iso}")

# ---------------------------------------------------------------------------
# Main entrypoint (async)
# ---------------------------------------------------------------------------

async def main():
    print("--- Starting Async Multi-Tenant Mail Sync (Phase 10) ---")
    res = supabase.table("user_settings").select("*").execute()
    users = res.data or []

    if not users:
        print("[INFO] No active users found. Exiting.")
        return

    # Single shared AsyncClient for all Sarvam AI calls (connection pooling)
    async with httpx.AsyncClient() as client:
        for user_row in users:
            if not user_row.get("user_id"):
                print(f"[WARNING] Skipping row {user_row.get('id')} — missing user_id.")
                continue
            try:
                await sync_user(client, user_row)
            except Exception as e:
                print(f"[ERROR] Sync failed for user {user_row.get('user_id')}: {e}")
                traceback.print_exc()

    print("\n--- All Tenants Sync Complete ---")


if __name__ == "__main__":
    asyncio.run(main())
