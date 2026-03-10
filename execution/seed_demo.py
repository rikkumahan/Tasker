import os
from supabase import create_client, Client
from datetime import datetime, timedelta

# Load from .env if possible, or just hardcode for the demo
SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL", "https://esngoeuhtpdzyfttofyu.supabase.co")
# Note: we need the service role key to insert
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzbmdvZXVodHBkenlmdHRvZnl1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzE2MjM0NCwiZXhwIjoyMDg4NzM4MzQ0fQ.ZudlVLCZZ7TLka86DAZvcIHEzCqWwX1NGvBUTzoFITw")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def seed_database():
    print("Seeding database with demo tasks...")
    
    now = datetime.now()
    
    demo_tasks = [
        {
            "title": "Final Project Submission",
            "course": "CSE301",
            "deadline": (now - timedelta(days=1)).isoformat(), # Overdue (RED)
            "location": "LMS Portal",
            "summary": "Submit the final zip file containing all source code and documentation.",
            "source_email_id": "demo_email_1",
            "category": "academic_project",
            "starred": True
        },
        {
            "title": "Midterm Exam",
            "course": "MAT201",
            "deadline": (now + timedelta(days=1)).isoformat(), # Soon (YELLOW)
            "location": "Room 402",
            "summary": "Covers chapters 1 through 5. Open book.",
            "source_email_id": "demo_email_2",
            "category": "academic_exam",
            "starred": False
        },
        {
            "title": "Weekly Lab Report",
            "course": "PHY101",
            "deadline": (now + timedelta(days=5)).isoformat(), # Upcoming (GREEN)
            "location": "Physics Lab",
            "summary": "Write up the results from Tuesday's pendulum experiment.",
            "source_email_id": "demo_email_3",
            "category": "academic_lab",
            "starred": False
        },
        {
            "title": "Buy Groceries",
            "course": None,
            "deadline": None, # No deadline, but starred so it won't fade
            "location": "Supermarket",
            "summary": "Milk, eggs, bread, and coffee.",
            "source_email_id": "demo_email_4",
            "category": "personal",
            "starred": True
        },
        {
             "title": "Doctor Appointment",
             "course": None,
             "deadline": (now + timedelta(days=2)).isoformat(), # Soon (YELLOW)
             "location": "City Clinic",
             "summary": "Annual checkup",
             "source_email_id": "demo_email_5",
             "category": "health",
             "starred": False
        }
    ]
    
    for task in demo_tasks:
        try:
            # Upsert based on source_email_id
            response = supabase.table("tasks").upsert(task, on_conflict="source_email_id").execute()
            print(f"Inserted: {task['title']}")
        except Exception as e:
            print(f"Error inserting {task['title']}: {e}")
            
    print("Done seeding!")

if __name__ == "__main__":
    seed_database()
