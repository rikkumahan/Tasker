"""
auto_sync.py
--------------------------------------------
Serverless Cloud Engine (Designed for GitHub Actions).
PRO FIX: Native async httpx for Gmail to avoid Segmentation Fault (Exit 139).
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

LLM_SEMAPHORE = asyncio.Semaphore(5)

# ---------------------------------------------------------------------------
# Gmail Auth (Returns direct credentials object)
# ---------------------------------------------------------------------------

def authenticate_gmail_stateless(settings_row):
    print("[INFO] Authenticating Gmail...")
    token_data = settings_row.get("gmail_token")
    if not token_data:
        raise ValueError("No gmail_token found.")

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
            print("[SUCCESS] Refreshed.")
        else:
            raise ValueError("Invalid Gmail credentials.")

    return creds

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
            if body: break
    return body.strip()

# ---------------------------------------------------------------------------
# Supabase async wrapper
# ---------------------------------------------------------------------------

async def supabase_execute(query):
    return await asyncio.to_thread(lambda: query.execute())

# ---------------------------------------------------------------------------
# Native Async Gmail Fetching (Uses httpx — Thread Safe)
# ---------------------------------------------------------------------------

async def fetch_single_email(client: httpx.AsyncClient, msg_id, access_token):
    try:
        url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}?format=full"
        resp = await client.get(url, headers={"Authorization": f"Bearer {access_token}"})
        if resp.status_code != 200: return None
        
        full_msg = resp.json()
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
        print(f"[WARNING] Fetch fail {msg_id}: {e}")
        return None

async def fetch_all_emails(client: httpx.AsyncClient, settings_row, creds):
    last_synced_str = settings_row.get("last_synced_at")
    if last_synced_str:
        try:
            last_synced_dt = datetime.fromisoformat(last_synced_str.replace('Z', '+00:00'))
            query = f"after:{int(last_synced_dt.timestamp())}"
        except:
            query = f"after:{int((datetime.now(timezone.utc) - timedelta(hours=48)).timestamp())}"
    else:
        query = f"after:{int((datetime.now(timezone.utc) - timedelta(hours=48)).timestamp())}"

    print(f"[INFO] Query: {query}")
    list_url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages?q={query}&maxResults=25"
    resp = await client.get(list_url, headers={"Authorization": f"Bearer {creds.token}"})
    if resp.status_code != 200: return []
    
    messages = resp.json().get("messages", [])
    if not messages: return []

    tasks = [fetch_single_email(client, m["id"], creds.token) for m in messages]
    results = await asyncio.gather(*tasks)
    return [r for r in results if r is not None]

# ---------------------------------------------------------------------------
# Persona Evolution
# ---------------------------------------------------------------------------

async def evolve_user_persona(client: httpx.AsyncClient, emails, settings_row):
    if not emails: return settings_row
    
    old_profile = settings_row.get("user_profile", "A student.")
    old_categories = settings_row.get("categories", [])
    email_block = "\n---\n".join(f"Subject: {e['subject']}\nBody: {e['body'][:500]}" for e in emails[:10])

    prompt = f"""Update user profile (3-4 sentences) and 5 categories based on:
{email_block}
Current Profile: {old_profile}
Current Categories: {old_categories}
Return ONLY valid JSON: {{ "user_profile": "...", "categories": [...] }}"""

    async with LLM_SEMAPHORE:
        try:
            resp = await client.post(
                "https://api.sarvam.ai/v1/chat/completions",
                headers={"Authorization": f"Bearer {SARVAM_API_KEY}", "Content-Type": "application/json"},
                json={"model": "sarvam-105b", "messages": [{"role": "user", "content": prompt}]},
                timeout=60.0
            )
            if resp.status_code == 200:
                content = resp.json()["choices"][0]["message"]["content"]
                parsed = json.loads(content.strip().strip("```json").strip("```").strip())
                if "user_profile" in parsed and "categories" in parsed:
                    await supabase_execute(supabase.table("user_settings").update({
                        "user_profile": parsed["user_profile"],
                        "categories": parsed["categories"]
                    }).eq("id", settings_row["id"]))
                    settings_row["user_profile"] = parsed["user_profile"]
                    settings_row["categories"] = parsed["categories"]
                    print("[SUCCESS] Persona evolved.")
        except Exception as e:
            print(f"[WARNING] Persona evolution failed: {e}")
    return settings_row

# ---------------------------------------------------------------------------
# Task Extraction
# ---------------------------------------------------------------------------

async def extract_single_email(client: httpx.AsyncClient, email, settings_row):
    user_profile = settings_row.get("user_profile", "A typical student.")
    categories = settings_row.get("categories", [])
    user_id = settings_row.get("user_id")
    now_ist = datetime.now(IST).strftime("%Y-%m-%dT%H:%M:%S")

    prompt = f"""Extract tasks from email. Now: {now_ist}. Profile: {user_profile}. Categories: {categories}.
Email: {email['subject']} - {email['body']}
Return raw JSON array only."""

    async with LLM_SEMAPHORE:
        try:
            resp = await client.post(
                "https://api.sarvam.ai/v1/chat/completions",
                headers={"Authorization": f"Bearer {SARVAM_API_KEY}", "Content-Type": "application/json"},
                json={"model": "sarvam-105b", "messages": [{"role": "user", "content": prompt}]},
                timeout=60.0
            )
            if resp.status_code == 200:
                content = resp.json()["choices"][0]["message"]["content"]
                extracted = json.loads(content.strip().strip("```json").strip("```").strip())
                for t in extracted:
                    t["source_email_id"] = email["id"]
                    t["user_id"] = user_id
                return extracted
        except: return []
    return []

async def extract_tasks_parallel(client: httpx.AsyncClient, emails, settings_row):
    if not emails: return []
    tasks = [extract_single_email(client, email, settings_row) for email in emails]
    results = await asyncio.gather(*tasks)
    return [task for email_tasks in results for task in email_tasks]

# ---------------------------------------------------------------------------
# Deduplication & Batch Upsert
# ---------------------------------------------------------------------------

def deduplicate_extracted_tasks(tasks):
    seen = set()
    unique = []
    for t in tasks:
        key = f"{t.get('title','').lower()}|{str(t.get('deadline',''))[:10]}"
        if key not in seen:
            seen.add(key)
            unique.append(t)
    return unique

async def upsert_tasks_batch(tasks):
    if not tasks: return
    user_id = tasks[0]["user_id"]
    email_ids = list({t["source_email_id"] for t in tasks})
    res = await supabase_execute(supabase.table("tasks").select("source_email_id, id").eq("user_id", user_id).in_("source_email_id", email_ids))
    existing_map = {row["source_email_id"]: row["id"] for row in (res.data or [])}

    to_insert = []
    for task in tasks:
        eid = task["source_email_id"]
        if eid in existing_map:
            await supabase_execute(supabase.table("tasks").update(task).eq("id", existing_map[eid]))
        else:
            to_insert.append(task)
    if to_insert:
        await supabase_execute(supabase.table("tasks").insert(to_insert))

# ---------------------------------------------------------------------------
# Multi-Tenant Sync
# ---------------------------------------------------------------------------

async def sync_user(client: httpx.AsyncClient, user_row):
    user_id = user_row.get("user_id")
    print(f"\n[INFO] --- Syncing: {user_id} ---")
    
    # Auth
    creds = await asyncio.to_thread(authenticate_gmail_stateless, user_row)
    
    # Fetch
    emails = await fetch_all_emails(client, user_row, creds)
    if not emails:
        now_iso = datetime.now(timezone.utc).isoformat()
        await supabase_execute(supabase.table("user_settings").update({"last_synced_at": now_iso}).eq("id", user_row["id"]))
        return

    res = await supabase_execute(supabase.table("tasks").select("source_email_id").eq("user_id", user_id))
    processed_ids = {row["source_email_id"] for row in (res.data or [])}
    new_emails = [e for e in emails if e["id"] not in processed_ids]
    print(f"[INFO] {len(new_emails)} fresh emails.")

    evolved_row = await evolve_user_persona(client, new_emails, user_row)
    tasks = await extract_tasks_parallel(client, new_emails, evolved_row)
    unique_tasks = deduplicate_extracted_tasks(tasks)
    await upsert_tasks_batch(unique_tasks)

    now_iso = datetime.now(timezone.utc).isoformat()
    await supabase_execute(supabase.table("user_settings").update({"last_synced_at": now_iso}).eq("id", user_row["id"]))
    print(f"[SUCCESS] {user_id} synced.")

async def main():
    print("--- Starting Phase 10 Pro Sync (FIXED) ---")
    res = await supabase_execute(supabase.table("user_settings").select("*"))
    users = res.data or []
    async with httpx.AsyncClient(timeout=30.0) as client:
        for user_row in users:
            if not user_row.get("user_id"): continue
            try:
                await sync_user(client, user_row)
            except Exception as e:
                print(f"[ERROR] Sync crashed: {e}")
                traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
