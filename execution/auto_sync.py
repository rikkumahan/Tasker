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
        refresh_token=token_data.get("refresh_token"),
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

def fetch_recent_emails(service):
    # Fetch emails from the last 24 hours to prevent dropped emails if a schedule skips
    yesterday = (datetime.now() - timedelta(hours=24)).strftime('%Y/%m/%d')
    query = f"is:unread after:{yesterday}"
    print(f"[INFO] Querying Gmail: {query}")
    
    result = service.users().messages().list(userId="me", q=query, maxResults=20).execute()
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

    # Process each email individually to maintain clean JSON structure (Sarvam handles batches poorly sometimes)
    for email in emails:
        prompt = f"""
You are an academic and personal productivity assistant. 
Your goal is to extract new tasks and events from the incoming email WITHOUT duplicating existing tasks.

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
    "deadline": "ISO 8601 datetime or null if unclear",
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
                    # Sanitize the deadline in case the LLM returns the literal string "null" instead of actual JSON null type
                    if isinstance(t.get("deadline"), str) and t["deadline"].strip().lower() == "null":
                        t["deadline"] = None
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
            emails = fetch_recent_emails(service)
            tasks = extract_tasks_with_llm(emails, user_row)
            upsert_tasks(tasks)
            print(f"[SUCCESS] Tenant {user_id} synced successfully.")
        except Exception as e:
            print(f"[ERROR] Sync crashed for user {user_id}. Attempting to safely continue to the next user. Fatal Error: {e}")
            traceback.print_exc()
            
    print("\n--- All Tenants Sync Complete ---")

if __name__ == "__main__":
    main()
