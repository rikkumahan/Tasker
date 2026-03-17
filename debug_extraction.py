
import asyncio
import httpx
import os
import json
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv

load_dotenv()

SARVAM_API_KEY = os.getenv("SARVAM_API_KEY")
IST = timezone(timedelta(hours=5, minutes=30))

async def test_extraction():
    now_ist = datetime.now(IST).strftime("%Y-%m-%dT%H:%M:%S")
    user_profile = "A student taking AI and Physics courses."
    categories = ["academic", "personal", "finance", "career", "other"]
    
    sample_emails = [
        {
            "id": "test_1",
            "subject": "Assignment Due: AI Homework 3",
            "body": "Hi students, please submit your AI homework 3 by tomorrow morning 10 AM. Late submissions will not be accepted."
        },
        {
            "id": "test_2",
            "subject": "Meeting: Physics Lab",
            "body": "Let's meet for the Physics lab today at 4 PM in the main auditorium."
        },
        {
            "id": "test_3",
            "subject": "Past Event: Movie Night",
            "body": "The movie night was great last Saturday! Thanks for coming."
        }
    ]

    async with httpx.AsyncClient() as client:
        for email in sample_emails:
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
            
            print(f"\n[DEBUG] Testing email: {email['subject']}")
            resp = await client.post(
                "https://api.sarvam.ai/v1/chat/completions",
                headers={"Authorization": f"Bearer {SARVAM_API_KEY}", "Content-Type": "application/json"},
                json={"model": "sarvam-105b", "messages": [{"role": "user", "content": prompt}]},
                timeout=30.0
            )
            
            if resp.status_code == 200:
                print(f"[SUCCESS] Response: {resp.json()['choices'][0]['message']['content']}")
            else:
                print(f"[ERROR] {resp.status_code}: {resp.text}")

if __name__ == "__main__":
    asyncio.run(test_extraction())
