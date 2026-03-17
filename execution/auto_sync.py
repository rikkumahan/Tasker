"""
auto_sync.py
--------------------------------------------
Serverless Cloud Engine (Designed for GitHub Actions).
PRO SCALING: Parallel multi-tenant sync with error resilience and reporting.
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

LOG_FILE = open("debug_sync.log", "w", encoding="utf-8")
def log_print(msg):
    print(msg)
    LOG_FILE.write(str(msg) + "\n")
    LOG_FILE.flush()

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
# CONCURRENCY CONTROL
# ---------------------------------------------------------------------------
LLM_SEMAPHORE = asyncio.Semaphore(1)  # Limit to 1 concurrent AI call to avoid 429
USER_SEMAPHORE = asyncio.Semaphore(2) # Limit parallel user syncs to 2

# ---------------------------------------------------------------------------
# Gmail Auth
# ---------------------------------------------------------------------------

def authenticate_gmail_stateless(settings_row):
    user_id = settings_row.get('user_id')
    log_print(f"[INFO] Authenticating Gmail for {user_id}...")
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

    log_print(f"[DEBUG] User {user_id} - Valid: {creds.valid}, Expired: {creds.expired}")

    if not creds.valid or creds.expired:
        if creds.refresh_token:
            log_print(f"[INFO] User {user_id} token needs refresh. Attempting...")
            try:
                creds.refresh(Request())
                log_print(f"[SUCCESS] User {user_id} token refreshed.")
                # Update DB with fresh token
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
            except Exception as e:
                log_print(f"[ERROR] User {user_id} refresh failed: {e}")
                raise e
        else:
            raise ValueError(f"User {user_id} token invalid/expired and NO refresh_token available.")

    return creds

# ---------------------------------------------------------------------------
# Helpers
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

async def supabase_execute(query):
    return await asyncio.to_thread(lambda: query.execute())

# ---------------------------------------------------------------------------
# Gmail Async
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

    list_url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages?q={query}&maxResults=25"
    resp = await client.get(list_url, headers={"Authorization": f"Bearer {creds.token}"})
    if resp.status_code != 200:
        raise Exception(f"Gmail API list failed: {resp.status_code} {resp.text}")
    
    messages = resp.json().get("messages", [])
    if not messages: return []

    tasks = [fetch_single_email(client, m["id"], creds.token) for m in messages]
    results = await asyncio.gather(*tasks)
    return [r for r in results if r is not None]

# ---------------------------------------------------------------------------
# AI logic (Persona & Extraction)
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
                content = resp.json()["choices"][0]["message"].get("content")
                if not content:
                    log_print(f"[WARNING] AI returned empty content for persona evolution of {settings_row.get('user_id')}")
                    return settings_row
                parsed = json.loads(content.strip().strip("```json").strip("```").strip())
                if "user_profile" in parsed and "categories" in parsed:
                    await supabase_execute(supabase.table("user_settings").update({
                        "user_profile": parsed["user_profile"],
                        "categories": parsed["categories"]
                    }).eq("id", settings_row["id"]))
                    settings_row["user_profile"] = parsed["user_profile"]
                    settings_row["categories"] = parsed["categories"]
        except Exception as e:
            print(f"[WARNING] Persona evolution failed for {settings_row.get('user_id')}: {e}")
    return settings_row

async def extract_single_email(client: httpx.AsyncClient, email, settings_row):
    user_profile = settings_row.get("user_profile", "A typical student.")
    categories = settings_row.get("categories", [])
    user_id = settings_row.get("user_id")
    now_ist = datetime.now(IST).strftime("%Y-%m-%dT%H:%M:%S")

    prompt = f"""Extract actionable tasks from email. 
CURRENT DATE AND TIME (IST): {now_ist}
Rule: Do NOT extract tasks whose deadline has already passed before {now_ist}.
Profile: {user_profile}. 
Categories: {categories}.

Email: {email['subject']} - {email['body']}

Return ONLY a JSON array of objects:
[
  {{
    "title": "Short descriptive title",
    "course": "University course name if applicable, else null",
    "deadline": "ISO8601 string (e.g. 2026-03-17T15:00:00). Guess if year is missing.",
    "summary": "1-sentence summary of the task",
    "category": "Pick exactly one from: {categories}"
  }}
]
No markdown. No extra text."""

    async with LLM_SEMAPHORE:
        try:
            resp = await client.post(
                "https://api.sarvam.ai/v1/chat/completions",
                headers={"Authorization": f"Bearer {SARVAM_API_KEY}", "Content-Type": "application/json"},
                json={"model": "sarvam-105b", "messages": [{"role": "user", "content": prompt}]},
                timeout=60.0
            )
            if resp.status_code == 200:
                content = resp.json()["choices"][0]["message"].get("content")
                if not content or content.strip() == "":
                    log_print(f"[INFO] AI found no tasks in email {email['id']}")
                    return []
                try:
                    # PRO: Resilient JSON parsing (handles markdown blocks)
                    clean_content = content.strip().strip("```json").strip("```").strip()
                    extracted = json.loads(clean_content)
                    for t in extracted:
                        t["source_email_id"] = email["id"]
                        t["user_id"] = user_id
                    return extracted
                except json.JSONDecodeError:
                    log_print(f"[WARNING] AI returned invalid JSON for {email['id']}")
                    raise Exception(f"AI returned invalid JSON: {content}")
            else:
                log_print(f"[ERROR] LLM API Status {resp.status_code}")
                raise Exception(f"LLM API Error: {resp.status_code}")
        except Exception as e:
            log_print(f"[ERROR] Extraction fail for {email['id']}: {e}")
            raise e
    return []

async def extract_tasks_parallel(client: httpx.AsyncClient, emails, settings_row):
    if not emails: return []
    tasks = [extract_single_email(client, email, settings_row) for email in emails]
    # PRO: return_exceptions=True so one bad email doesn't kill the whole user sync
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    final_tasks = []
    for res in results:
        if isinstance(res, Exception):
            log_print(f"[WARNING] Individual extraction failed: {res}")
        elif res:
            final_tasks.extend(res)
    return final_tasks

# ---------------------------------------------------------------------------
# Sync logic & Multi-User scaling
# ---------------------------------------------------------------------------

async def sync_user_with_error_handling(client: httpx.AsyncClient, user_row):
    """Wraps sync logic to catch errors and report them to the DB."""
    async with USER_SEMAPHORE:
        user_id = user_row.get("user_id")
        try:
            log_print(f"[INFO] Syncing user: {user_id}")
            creds = await asyncio.to_thread(authenticate_gmail_stateless, user_row)
            
            try:
                emails = await fetch_all_emails(client, user_row, creds)
            except Exception as e:
                # PRO: Resilience - If 401 hit, try ONE refresh even if library thought we were valid
                if "401" in str(e) and creds.refresh_token:
                    log_print(f"[WARNING] 401 Unauthorized for {user_id}. Forcing manual refresh...")
                    await asyncio.to_thread(creds.refresh, Request())
                    # Update DB with NEW token
                    supabase.table("user_settings").update({
                        "gmail_token": {
                            "token": creds.token,
                            "refresh_token": creds.refresh_token,
                            "token_uri": creds.token_uri,
                            "client_id": creds.client_id,
                            "client_secret": creds.client_secret,
                            "scopes": list(creds.scopes)
                        }
                    }).eq("id", user_row["id"]).execute()
                    # Retry with new creds
                    emails = await fetch_all_emails(client, user_row, creds)
                else:
                    raise e
            
            if not emails:
                now_iso = datetime.now(timezone.utc).isoformat()
                await supabase_execute(supabase.table("user_settings").update({
                    "last_synced_at": now_iso,
                    "last_sync_error": None
                }).eq("id", user_row["id"]))
                return

            res = await supabase_execute(supabase.table("tasks").select("source_email_id").eq("user_id", user_id))
            processed_ids = {row["source_email_id"] for row in (res.data or [])}
            new_emails = [e for e in emails if e["id"] not in processed_ids]

            evolved_row = await evolve_user_persona(client, new_emails, user_row)
            tasks = await extract_tasks_parallel(client, new_emails, evolved_row)
            
            # Batch upsert
            if tasks:
                email_ids = list({t["source_email_id"] for t in tasks})
                res_tasks = await supabase_execute(supabase.table("tasks").select("source_email_id, id").eq("user_id", user_id).in_("source_email_id", email_ids))
                existing_map = {row["source_email_id"]: row["id"] for row in (res_tasks.data or [])}

                to_insert = []
                for task in tasks:
                    eid = task["source_email_id"]
                    if eid in existing_map:
                        await supabase_execute(supabase.table("tasks").update(task).eq("id", existing_map[eid]))
                    else:
                        to_insert.append(task)
                if to_insert:
                    await supabase_execute(supabase.table("tasks").insert(to_insert))

            now_iso = datetime.now(timezone.utc).isoformat()
            await supabase_execute(supabase.table("user_settings").update({
                "last_synced_at": now_iso,
                "last_sync_error": None
            }).eq("id", user_row["id"]))
            log_print(f"[SUCCESS] {user_id} sync complete.")

        except Exception as e:
            err_msg = str(e)[:255]
            log_print(f"[ERROR] User {user_id} failed: {err_msg}")
            log_print(traceback.format_exc())
            await supabase_execute(supabase.table("user_settings").update({
                "last_sync_error": err_msg
            }).eq("id", user_row["id"]))

async def main():
    log_print("--- Starting Pro Scalable Sync ---")
    res = await supabase_execute(supabase.table("user_settings").select("*"))
    users = [u for u in (res.data or []) if u.get("user_id")]
    
    async with httpx.AsyncClient(timeout=45.0) as client:
        # PARALLEL SYNC ACROSS ALL USERS
        tasks = [sync_user_with_error_handling(client, user_row) for user_row in users if user_row.get("user_id")]
        await asyncio.gather(*tasks)
    log_print("--- Done ---")
    LOG_FILE.close()

if __name__ == "__main__":
    asyncio.run(main())
