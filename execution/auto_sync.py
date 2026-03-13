"""
auto_sync.py
--------------------------------------------
Serverless Cloud Engine (Designed for GitHub Actions).
Fetches Gmail OAuth token from Supabase, scans for new emails, 
extracts tasks using Sarvam AI, and upserts them into Supabase.
"""

import os
import json
import base64
import time
from datetime import datetime, timezone, timedelta
import httpx
from dotenv import load_dotenv
import traceback

# IST = UTC+5:30 (used for accurate overdue detection in LLM prompt)
IST = timezone(timedelta(hours=5, minutes=30))

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from supabase import create_client, Client

load_dotenv()

# Environment Variables (injected by GitHub Actions secrets)
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
SARVAM_API_KEY = os.getenv("SARVAM_API_KEY")
GMAIL_CLIENT_ID = os.getenv("GMAIL_CLIENT_ID")       # We will ask user to add this to GitHub Secrets
GMAIL_CLIENT_SECRET = os.getenv("GMAIL_CLIENT_SECRET") # We will ask user to add this to GitHub Secrets

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing Supabase credentials in environment.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Settings are now fetched iteratively in main() loop for multi-tenancy

def authenticate_gmail_stateless(settings_row):
    print("[INFO] Authenticating Gmail statelessly...")
    token_data = settings_row.get("gmail_token")
    if not token_data:
        raise ValueError("No gmail_token found in Supabase user_settings.")

    # Reconstruct the Credentials object using the DB token and ENV secrets
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
            print("[INFO] Google Token Expired. Refreshing...")
            creds.refresh(Request())
            
            # IMMEDIATELY save the new token back to Supabase to avoid race conditions!
            new_token_data = {
                "token": creds.token,
                "refresh_token": creds.refresh_token,
                "token_uri": creds.token_uri,
                "client_id": creds.client_id,
                "client_secret": creds.client_secret,
                "scopes": creds.scopes
            }
            supabase.table("user_settings").update({"gmail_token": new_token_data}).eq("id", settings_row["id"]).execute()
            print("[SUCCESS] Refreshed Token securely saved to Supabase Vault.")
        else:
            raise ValueError("Gmail credentials invalid and cannot be refreshed.")
            
    return build("gmail", "v1", credentials=creds)

def decode_body(payload):
    body = ""
    mime = payload.get("mimeType", "")
    if mime == "text/plain":
        data = payload.get("body", {}).get("data", "")
        if data:
            body = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
    elif mime in ("multipart/alternative", "multipart/mixed", "multipart/related"):
        for part in payload.get("parts", []):
            body = decode_body(part)
            if body:
                break
    return body.strip()

def fetch_recent_emails(service, settings_row):
    # Point 3: Incremental Syncing
    last_synced_str = settings_row.get("last_synced_at")
    
    if last_synced_str:
        # Convert ISO 8601 string to datetime, then to Unix Epoch for precise Gmail querying
        try:
            last_synced_dt = datetime.fromisoformat(last_synced_str.replace('Z', '+00:00'))
            epoch = int(last_synced_dt.timestamp())
            query = f"after:{epoch}"  # Removed is:unread — reading on phone should not block extraction
            print(f"[INFO] Incremental Sync from epoch {epoch} ({last_synced_str})")
        except Exception as e:
            print(f"[WARNING] Failed to parse last_synced_at: {e}. Falling back to 48 hours.")
            epoch = int((datetime.now(timezone.utc) - timedelta(hours=48)).timestamp())
            query = f"after:{epoch}"
    else:
        # Fallback for brand new users or missing data — sweep last 48 hours
        print("[INFO] No last_synced_at found. Falling back to 48 hours.")
        epoch = int((datetime.now(timezone.utc) - timedelta(hours=48)).timestamp())
        query = f"after:{epoch}"  # No is:unread — rely purely on timestamp epoch
        
    print(f"[INFO] Querying Gmail: {query}")
    
    result = service.users().messages().list(userId="me", q=query, maxResults=25).execute()
    messages = result.get("messages", [])
    
    parsed_emails = []
    for msg in messages:
        try:
            full_msg = service.users().messages().get(userId="me", id=msg["id"], format="full").execute()
            headers = {h["name"]: h["value"] for h in full_msg["payload"].get("headers", [])}
            subject = headers.get("Subject", "(no subject)")
            sender  = headers.get("From", "unknown")
            date    = headers.get("Date", "")
            body    = decode_body(full_msg["payload"])
            
            # Truncate body to save LLM tokens (bumped to 1500 for better context)
            body = body[:1500].replace("\n", " ").strip() if body else ""
            
            parsed_emails.append({
                "id": msg["id"],
                "subject": subject,
                "sender": sender,
                "date": date,
                "body": body
            })
        except Exception as e:
            print(f"[WARNING] Failed to parse email {msg['id']}: {e}")
            
    return parsed_emails

def evolve_user_persona(emails, settings_row):
    # Point 1, 4, 5: Continuous Profile Evolution
    if not emails:
        return settings_row
        
    print(f"[INFO] Evolving User Persona based on {len(emails)} new emails...")
    
    old_profile = settings_row.get("user_profile", "A person in a college who wants to organize their academic and personal responsibilities efficiently.")
    old_categories = settings_row.get("categories", [])
    
    # Bundle emails into a string block (truncated for tokens)
    email_texts = []
    for e in emails[:10]: # Use up to 10 latest for profile evolution to save tokens
        email_texts.append(f"Subject: {e['subject']}\nBody: {e['body'][:500]}")
    email_block = "\n---\n".join(email_texts)
    
    prompt = f"""
You are an AI tasked with deeply understanding a user so you can build them a hyper-personalized task manager.

CURRENT USER PROFILE:
"{old_profile}"

CURRENT CATEGORIES:
{old_categories}

Look at their newest emails and EVOLVE their profile if necessary:

Emails:
{email_block}

Based on this content:
1. Write a 3 to 4 sentence \`user_profile\` that updates the CURRENT USER PROFILE. Add highly specific details you found in their inbox.
2. Define EXACTLY 5 broad categories for their dashboard. You can keep the old ones or invent new ones if their life is shifting.
Categories should be single snake_case strings.

Return ONLY a JSON object with exactly these two keys:
{{
  "user_profile": "detailed evolved personality description here...",
  "categories": ["category_1", "category_2", "category_3", "category_4", "category_5"]
}}
"""
    headers = {
        "Authorization": f"Bearer {SARVAM_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "sarvam-105b",
        "messages": [{"role": "user", "content": prompt}]
    }
    
    try:
        resp = httpx.post("https://api.sarvam.ai/v1/chat/completions", headers=headers, json=payload, timeout=60.0)
        if resp.status_code == 200:
            reply = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
            cleaned = reply.strip().strip("```json").strip("```").strip()
            parsed = json.loads(cleaned)
            
            if "user_profile" in parsed and "categories" in parsed:
                # Point 10: Zero retention, delete email strings from ram immediately
                del email_block
                del email_texts
                
                print("[SUCCESS] Persona Evolved dynamically.")
                # Update Supabase
                supabase.table("user_settings").update({
                    "user_profile": parsed["user_profile"],
                    "categories": parsed["categories"]
                }).eq("id", settings_row["id"]).execute()
                
                # Update local row memory for task extraction
                settings_row["user_profile"] = parsed["user_profile"]
                settings_row["categories"] = parsed["categories"]
                
    except Exception as e:
        print(f"[WARNING] Failed to evolve persona: {e}")
        
    return settings_row

def extract_tasks_with_llm(emails, settings_row):
    if not emails:
        print("[INFO] No new emails found. Exiting.")
        return []
        
    print(f"[INFO] Passing {len(emails)} emails to Sarvam-105b...")
    
    user_id = settings_row.get("user_id")
    
    # Let's fetch current pending tasks to avoid duplication (limit 100 to save tokens)
    res = supabase.table("tasks").select("title, course, deadline").eq("status", "pending").eq("user_id", user_id).limit(100).execute()
    pending_tasks = json.dumps(res.data) if res.data else "None"
    
    user_profile = settings_row.get("user_profile", "A typical student.")
    categories = settings_row.get("categories", [])
    
    tasks_to_insert = []
    
    headers = {
        "Authorization": f"Bearer {SARVAM_API_KEY}",
        "Content-Type": "application/json"
    }

    # Process each email individually to maintain clean JSON structure
    for email in emails:
        # GAP 2 FIX: Pre-filter by source_email_id BEFORE calling LLM (saves tokens)
        existing_check = supabase.table("tasks").select("id").eq("source_email_id", email["id"]).eq("user_id", user_id).execute()
        if existing_check.data:
            print(f"[INFO] Email {email['id']} already processed. Skipping LLM call.")
            continue

        # GAP 3 FIX: Inject current IST time so LLM can discard overdue tasks accurately
        now_ist = datetime.now(IST).strftime("%Y-%m-%dT%H:%M:%S")
        prompt = f"""
You are an academic and personal productivity assistant. 
Your goal is to extract new tasks and events from the incoming email WITHOUT duplicating existing tasks.

CURRENT DATE AND TIME (Indian Standard Time / IST): {now_ist}
Do NOT extract tasks whose deadline has already passed before this current time.

USER CONTEXT & PERSONALITY PROFILE:
"{user_profile}"
(Use this context to decide if an email is actually relevant/actionable for this specific user, or just generic spam).

CURRENT PENDING TASKS AWAITING THE USER:
{pending_tasks}

Incoming Email:
From: {email['sender']}
Date: {email['date']}
Subject: {email['subject']}
Body: {email['body']}

Return ONLY a JSON array. Each element is one task from the email:
[
  {{
    "title": "short task name e.g. DAA Quiz",
    "course": "course name e.g. DAA",
    "deadline": "The START TIME of the event, or the exact deadline. Convert to ISO 8601 format WITHOUT the 'Z' timezone suffix (e.g. '2026-03-12T16:00:00') to remain in local time. If no exact time is explicitly written, return ONLY the date at midnight (e.g. '2026-03-12T00:00:00'). DO NOT GUESS times.",
    "end_time": "The END TIME of the event, if explicitly mentioned, in ISO 8601 WITHOUT the 'Z' (e.g. '2026-03-12T20:00:00'). If no end time is stated, return null.",
    "location": "room/venue or null",
    "summary": "1-2 sentence plain English summary",
    "category": "String. Pick ONE category from this user list: {categories}. If none fit perfectly, invent a concise new 1-word or 2-word label snake_case."
  }}
]

Rules:
- Do NOT output a task if it is already present in CURRENT PENDING TASKS.
- If the email is purely informational (no deadline), assign category "Check_Out_Mail".
- If it is spam, nonsense, or completely irrelevant to the User Profile, return an empty array: []
- Double check JSON is valid. NO markdown fences.
"""

        payload = {
            "model": "sarvam-105b",
            "messages": [{"role": "user", "content": prompt}]
        }
        
        try:
            resp = httpx.post("https://api.sarvam.ai/v1/chat/completions", headers=headers, json=payload, timeout=60.0)
            if resp.status_code == 200:
                reply = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
                if not reply:
                    print(f"[WARNING] Sarvam AI returned empty content for email {email['id']}. Skipping.")
                    time.sleep(1.5)
                    continue
                    
                cleaned = reply.strip().strip("```json").strip("```").strip()
                extracted = json.loads(cleaned)
                
                for t in extracted:
                    t["source_email_id"] = email["id"]
                    t["user_id"] = user_id
                    # Strip LLM hallucinated 'id' keys so it doesn't break Supabase UUID generation
                    if "id" in t:
                        del t["id"]
                    # Sanitize deadline string 'null'
                    if isinstance(t.get("deadline"), str) and t["deadline"].strip().lower() == "null":
                        t["deadline"] = None
                    # Sanitize end_time string 'null'
                    if isinstance(t.get("end_time"), str) and t["end_time"].strip().lower() == "null":
                        t["end_time"] = None
                    tasks_to_insert.append(t)
            else:
                print(f"[ERROR] Sarvam returned {resp.status_code}: {resp.text}")
        except Exception as e:
            print(f"[ERROR] LLM Request failed for email {email['id']}: {e}")
            
        # Prevent Sarvam AI rate limits when processing multiple emails
        time.sleep(1.5)
            
    return tasks_to_insert

def upsert_tasks(tasks):
    if not tasks:
        return
    print(f"[INFO] Upserting {len(tasks)} tasks to Supabase...")
    for task in tasks:
        try:
            # Check if it exists to handle updates vs inserts
            existing = supabase.table("tasks").select("deadline").eq("source_email_id", task["source_email_id"]).eq("user_id", task["user_id"]).execute()
            
            if existing.data:
                # Update path (checking if deadline changed)
                old_dl = existing.data[0].get("deadline")
                if str(old_dl) != str(task.get("deadline")) and task.get("deadline"):
                    task["updated"] = True
                    task["change_note"] = "Deadline or details were updated by a recent email."
                
                supabase.table("tasks").update(task).eq("source_email_id", task["source_email_id"]).eq("user_id", task["user_id"]).execute()
            else:
                # Insert path
                supabase.table("tasks").insert(task).execute()
        except Exception as e:
            print(f"[ERROR] Failed to upsert task {task.get('title')}: {e}")

def main():
    print("--- Starting Serverless Multi-Tenant Mail Sync ---")
    res = supabase.table("user_settings").select("*").execute()
    users = res.data or []
    
    if not users:
        print("[INFO] No active users with linked Gmail tokens found. Exiting.")
        return
        
    for user_row in users:
        user_id = user_row.get("user_id")
        if not user_id:
            print(f"[WARNING] Skipping legacy user_settings row {user_row.get('id')} because user_id is missing.")
            continue
            
        print(f"\n[INFO] --- Syncing Tenant: {user_id} ---")
        try:
            service = authenticate_gmail_stateless(user_row)
            emails = fetch_recent_emails(service, user_row)
            
            # 1. Evolve Persona first
            evolved_row = evolve_user_persona(emails, user_row)
            
            # 2. Extract Tasks
            tasks = extract_tasks_with_llm(emails, evolved_row)
            
            # 3. Save Tasks
            upsert_tasks(tasks)
            
            # 4. Point 3: Transactional Update of Sync Clock (ONLY on success)
            now_iso = datetime.now(timezone.utc).isoformat()
            supabase.table("user_settings").update({"last_synced_at": now_iso}).eq("id", user_row["id"]).execute()
            
            print(f"[SUCCESS] Tenant {user_id} synced successfully. Clock updated to {now_iso}.")
        except Exception as e:
            print(f"[ERROR] Sync crashed for user {user_id}. Attempting to safely continue to the next user. Fatal Error: {e}")
            traceback.print_exc()
            
    print("\n--- All Tenants Sync Complete ---")

if __name__ == "__main__":
    main()
