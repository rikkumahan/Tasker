"""
generate_categories.py
--------------------------------------------
First-time setup script. Fetches recent organic emails, 
uses Sarvam.ai (or fallback LLM) to generate personalized categories,
and stores them in Supabase `user_settings`.
"""

import os
import json
import base64
from pathlib import Path
from datetime import datetime

import httpx
from dotenv import load_dotenv

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from supabase import create_client, Client

load_dotenv()

ROOT_DIR = Path(__file__).parent.parent
TOKEN_FILE = ROOT_DIR / "token.json"
SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
MAX_RESULTS = 50

# Supabase setup
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
SARVAM_API_KEY = os.getenv("SARVAM_API_KEY")

def get_gmail_service():
    creds = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                str(ROOT_DIR / "credentials.json"), SCOPES
            )
            creds = flow.run_local_server(port=0)
        TOKEN_FILE.write_text(creds.to_json())
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

def fetch_email_samples(service):
    print(f"[INFO] Fetching last {MAX_RESULTS} emails for category analysis...")
    result = service.users().messages().list(userId="me", maxResults=MAX_RESULTS).execute()
    messages = result.get("messages", [])
    
    samples = []
    for i, msg in enumerate(messages):
        try:
            full_msg = service.users().messages().get(userId="me", id=msg["id"], format="full").execute()
            headers = {h["name"]: h["value"] for h in full_msg["payload"].get("headers", [])}
            subject = headers.get("Subject", "(no subject)")
            sender  = headers.get("From", "unknown")
            body = decode_body(full_msg["payload"])
            
            preview = body[:300].replace("\n", " ").strip() if body else ""
            samples.append(f"From: {sender}\nSubject: {subject}\nBody: {preview}...\n---\n")
        except Exception:
            pass
            
    return "\n".join(samples)

def generate_categories_with_llm(email_text):
    print("[INFO] Passing emails to LLM for category/profile generation...")
    # NOTE: We can use OpenAI fallback if Sarvam is down, but we stick to Sarvam logic here
    # Sarvam acts like OpenAI SDK wrapper. We'll just do a raw HTTPx call.
    
    prompt = f"""
You are an AI assistant helping a student organize their tasks.
Look at the following sample of recent emails from their inbox.

Emails:
{email_text}

Based on this content, perform two tasks:
1. Write a 3 to 4 sentence `user_profile` summarizing who this user is, what their current life state is (e.g., student, job seeker), and what types of deadlines/events they care about.
2. Define EXACTLY 5 broad categories that these emails can be grouped into for a task manager dashboard.
Categories should be single snake_case strings (e.g., academic_deadline, club_event, internship_opportunity).

Return ONLY a JSON object with exactly these two keys:
{{
  "user_profile": "detailed personality description here...",
  "categories": ["category_1", "category_2", "category_3", "category_4", "category_5"]
}}
    """
    
    default_resp = {
        "user_profile": "The user is a student currently organizing their academic and personal tasks.",
        "categories": ["academic_deadline", "admin_notice", "opportunity", "campus_event", "security_warning"]
    }
    
    if not SARVAM_API_KEY:
        print("[WARNING] No SARVAM_API_KEY found. Sticking to default profile.")
        return default_resp

    try:
        headers = {
            "Authorization": f"Bearer {SARVAM_API_KEY}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": "sarvam-105b",
            "messages": [{"role": "user", "content": prompt}]
        }
        resp = httpx.post("https://api.sarvam.ai/v1/chat/completions", headers=headers, json=payload, timeout=30.0)
        
        if resp.status_code != 200:
            print(f"[ERROR] HTTP {resp.status_code} from Sarvam AI: {resp.text}")
            resp.raise_for_status()
        
        reply = resp.json()["choices"][0]["message"]["content"]
        # Basic JSON parsing cleanup
        cleaned = reply.strip().strip("```json").strip("```").strip()
        data = json.loads(cleaned)
        
        if "categories" in data and "user_profile" in data:
            print(f"[SUCCESS] Generated Profile & Categories!")
            return data
    except Exception as e:
        print(f"[ERROR] LLM Failed: {e}. Using defaults.")
        
    return default_resp

def save_to_supabase(data):
    print("[INFO] Saving profile & categories to Supabase user_settings table...")
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[ERROR] Missing Supabase credentials in .env. Cannot save.")
        return

    try:
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        # Assuming single user for now. Clean table to hold just 1 row of settings.
        supabase.table("user_settings").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
        
        # Insert both columns
        res = supabase.table("user_settings").insert({
            "categories": data["categories"],
            "user_profile": data["user_profile"]
        }).execute()
        
        print(f"[SUCCESS] Saved to Supabase. ID: {res.data[0]['id']}")
        print("\n--- Generated Profile ---")
        print(data["user_profile"])
        print("\n--- Generated Categories ---")
        print(data["categories"])
    except Exception as e:
        print(f"[ERROR] Supabase Insert Failed: {e}")

def main():
    service = get_gmail_service()
    email_text = fetch_email_samples(service)
    data = generate_categories_with_llm(email_text)
    save_to_supabase(data)
    print("\n[DONE] Onboarding complete.")

if __name__ == "__main__":
    main()
