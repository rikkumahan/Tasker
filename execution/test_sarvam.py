import os
import httpx
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("SARVAM_API_KEY")

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}
payload = {
    "model": "sarvam-2b-v0.5",
    "messages": [{"role": "user", "content": "hello"}]
}

try:
    resp = httpx.post("https://api.sarvam.ai/v1/chat/completions", headers=headers, json=payload)
    print("Status:", resp.status_code)
    print("Body:", resp.text)
except Exception as e:
    print(e)
