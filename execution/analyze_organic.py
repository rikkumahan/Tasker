"""
analyze_emails.py
--------------------------------------------
Fetches the last N emails from Gmail WITHOUT filtering by keywords.
Saves them to .tmp/recent_emails.json for the AI agent to personally
read and analyze the organic categories.
"""

import os
import json
import base64
from pathlib import Path
from datetime import datetime

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

ROOT_DIR = Path(__file__).parent.parent
TOKEN_FILE = ROOT_DIR / "token.json"
TMP_DIR = ROOT_DIR / ".tmp"

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
MAX_RESULTS = 100

def get_gmail_service():
    creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
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

def process_message(service, msg_id):
    msg = service.users().messages().get(userId="me", id=msg_id, format="full").execute()
    headers = {h["name"]: h["value"] for h in msg["payload"].get("headers", [])}
    subject = headers.get("Subject", "(no subject)")
    sender  = headers.get("From", "unknown")
    date_str = headers.get("Date", "")
    body     = decode_body(msg["payload"])
    
    return {
        "email_id": msg_id,
        "subject": subject,
        "from": sender,
        "date": date_str,
        "body_preview": body[:1000].replace("\n", " ").strip() if body else "(no body)"
    }

def main():
    print(f"\n[INFO] Authenticating...")
    service = get_gmail_service()
    
    print(f"[INFO] Fetching last {MAX_RESULTS} emails...")
    # Fetch all recent messages - no subject filters
    result = service.users().messages().list(userId="me", maxResults=MAX_RESULTS).execute()
    messages = result.get("messages", [])
    
    if not messages:
        print("[INFO] No emails found.")
        return

    emails = []
    for i, msg in enumerate(messages):
        print(f"  Fetching {i+1}/{len(messages)}...", end="\r")
        try:
            emails.append(process_message(service, msg["id"]))
        except Exception:
            pass

    print()
    
    TMP_DIR.mkdir(exist_ok=True)
    out_path = TMP_DIR / "organic_emails.json"
    
    output = {
        "scanned_at": datetime.now().isoformat(),
        "total_emails": len(emails),
        "emails": emails,
    }
    out_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n[SUCCESS] Saved {len(emails)} emails to {out_path}\n")

if __name__ == "__main__":
    main()
