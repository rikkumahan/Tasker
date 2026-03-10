"""
scan_emails.py  —  Option B Research Script
--------------------------------------------
Scans Gmail for academic emails and dumps raw extracted data
to .tmp/email_tasks.json for manual review / category analysis.

Requirements:
    pip install google-auth google-auth-oauthlib google-auth-httplib2 google-api-python-client

Setup:
    1. Place your credentials.json (Google OAuth Desktop App) in the tasker root.
    2. Run this script once — it will open a browser for OAuth consent.
    3. token.json is saved for future runs (no browser needed again).

Output:
    .tmp/email_tasks.json  — all extracted email records
    .tmp/category_summary.json  — task category breakdown
"""

import os
import json
import base64
import re
from pathlib import Path
from datetime import datetime

# ── Google API imports ──────────────────────────────────────────────────────
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

# ── Config ──────────────────────────────────────────────────────────────────
ROOT_DIR        = Path(__file__).parent.parent          # tasker/
CREDENTIALS_FILE = ROOT_DIR / "credentials.json"
TOKEN_FILE       = ROOT_DIR / "token.json"
TMP_DIR          = ROOT_DIR / ".tmp"

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

# Keywords to search for in Gmail (matches directive)
SEARCH_QUERY = (
    "subject:(quiz OR test OR assignment OR lab OR submission "
    "OR deadline OR exam OR report OR project OR viva OR internals)"
)
MAX_RESULTS = 50  # fetch more for research purposes

# ── Category detection keywords ──────────────────────────────────────────────
CATEGORY_PATTERNS = {
    "Quiz":        r"\bquiz\b",
    "Exam":        r"\b(exam|mid.?term|end.?term|final)\b",
    "Assignment":  r"\b(assignment|homework|hw)\b",
    "Lab":         r"\b(lab|practical|experiment)\b",
    "Submission":  r"\b(submit|submission|upload|due)\b",
    "Project":     r"\b(project|capstone|mini.?project)\b",
    "Deadline":    r"\bdeadline\b",
    "Report":      r"\b(report|write.?up|documentation)\b",
    "Viva":        r"\b(viva|oral|defence|defense)\b",
    "Internals":   r"\b(internal|CIA|continuous\s+assessment)\b",
    "Cancelled":   r"\b(cancel|postpone|reschedule)\b",
}

# ── Helpers ─────────────────────────────────────────────────────────────────

def get_gmail_service():
    """Authenticate and return a Gmail API service object."""
    creds = None

    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not CREDENTIALS_FILE.exists():
                raise FileNotFoundError(
                    f"\n[ERROR] credentials.json not found at: {CREDENTIALS_FILE}\n"
                    "  → Go to https://console.cloud.google.com/\n"
                    "  → APIs & Services → Credentials → Create OAuth 2.0 Client (Desktop)\n"
                    "  → Download JSON → rename to credentials.json → place in tasker/\n"
                )
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)

        TOKEN_FILE.write_text(creds.to_json())
        print(f"[AUTH] Token saved to {TOKEN_FILE}")

    return build("gmail", "v1", credentials=creds)


def decode_body(payload):
    """Recursively extract plain text body from a Gmail message payload."""
    body = ""
    mime = payload.get("mimeType", "")

    if mime == "text/plain":
        data = payload.get("body", {}).get("data", "")
        if data:
            body = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")

    elif mime == "multipart/alternative" or mime == "multipart/mixed":
        for part in payload.get("parts", []):
            body = decode_body(part)
            if body:
                break

    return body.strip()


def detect_categories(text):
    """Return list of matching category labels for a given text blob."""
    combined = text.lower()
    found = []
    for category, pattern in CATEGORY_PATTERNS.items():
        if re.search(pattern, combined, re.IGNORECASE):
            found.append(category)
    return found if found else ["Uncategorized"]


def extract_deadline_hints(text):
    """Loosely extract date-like strings as deadline hints."""
    patterns = [
        r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b",            # 12/03/2025
        r"\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4}\b",  # 12 March 2025
        r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s+\d{4}\b",  # March 12, 2025
        r"\b(?:tomorrow|today|this\s+\w+day|next\s+\w+day)\b",  # relative
        r"\bby\s+\d{1,2}(?:st|nd|rd|th)?\s+\w+\b",            # by 15th March
    ]
    hints = []
    for p in patterns:
        matches = re.findall(p, text, re.IGNORECASE)
        hints.extend(matches)
    return list(set(hints))  # deduplicate


def fetch_emails(service):
    """Fetch emails matching the academic search query."""
    print(f"[GMAIL] Searching: {SEARCH_QUERY}")
    result = service.users().messages().list(
        userId="me",
        q=SEARCH_QUERY,
        maxResults=MAX_RESULTS
    ).execute()

    messages = result.get("messages", [])
    print(f"[GMAIL] Found {len(messages)} matching emails")
    return messages


def process_message(service, msg_id):
    """Fetch full message and extract relevant fields."""
    msg = service.users().messages().get(
        userId="me",
        id=msg_id,
        format="full"
    ).execute()

    headers = {h["name"]: h["value"] for h in msg["payload"].get("headers", [])}
    subject = headers.get("Subject", "(no subject)")
    sender  = headers.get("From", "unknown")
    date_str = headers.get("Date", "")
    body     = decode_body(msg["payload"])

    # Combine subject + body for analysis
    combined_text = f"{subject}\n{body}"
    categories    = detect_categories(combined_text)
    deadline_hints = extract_deadline_hints(combined_text)

    return {
        "email_id":       msg_id,
        "subject":        subject,
        "from":           sender,
        "date":           date_str,
        "categories":     categories,
        "deadline_hints": deadline_hints,
        "body_preview":   body[:400].replace("\n", " ").strip() if body else "(no body)",
        "full_body":      body[:2000] if body else "",
    }


def build_category_summary(emails):
    """Count how many emails fall under each category."""
    summary = {}
    for email in emails:
        for cat in email["categories"]:
            summary[cat] = summary.get(cat, 0) + 1
    # Sort by count descending
    return dict(sorted(summary.items(), key=lambda x: x[1], reverse=True))


def save_outputs(emails, summary):
    """Write results to .tmp/"""
    TMP_DIR.mkdir(exist_ok=True)

    tasks_path   = TMP_DIR / "email_tasks.json"
    summary_path = TMP_DIR / "category_summary.json"

    output = {
        "scanned_at": datetime.now().isoformat(),
        "total_emails": len(emails),
        "emails": emails,
    }

    tasks_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    summary_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n[OUTPUT] Saved {len(emails)} emails → {tasks_path}")
    print(f"[OUTPUT] Category summary → {summary_path}")


def print_summary(emails, summary):
    """Print a readable summary to the terminal."""
    print("\n" + "="*60)
    print("  📊  EMAIL RESEARCH SUMMARY")
    print("="*60)
    print(f"  Total emails scanned : {len(emails)}")
    print(f"  Unique categories    : {len(summary)}\n")
    print("  Category breakdown:")
    for cat, count in summary.items():
        bar = "█" * count
        print(f"    {cat:<15} {count:>3}  {bar}")
    print("\n  Top 5 subjects found:")
    for e in emails[:5]:
        cats = ", ".join(e["categories"])
        print(f"    [{cats}] {e['subject'][:70]}")
    if len(emails) > 5:
        print(f"    ... and {len(emails) - 5} more (see .tmp/email_tasks.json)")
    print("="*60 + "\n")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("\n🔍  scan_emails.py  —  Gmail Research Scanner\n")

    service  = get_gmail_service()
    messages = fetch_emails(service)

    if not messages:
        print("[INFO] No academic emails found. Try adjusting SEARCH_QUERY in the script.")
        return

    emails = []
    for i, msg in enumerate(messages):
        print(f"  Processing {i+1}/{len(messages)}: {msg['id']}", end="\r")
        try:
            record = process_message(service, msg["id"])
            emails.append(record)
        except Exception as e:
            print(f"\n  [WARN] Skipped {msg['id']}: {e}")

    print()  # newline after progress

    summary = build_category_summary(emails)
    save_outputs(emails, summary)
    print_summary(emails, summary)


if __name__ == "__main__":
    main()
