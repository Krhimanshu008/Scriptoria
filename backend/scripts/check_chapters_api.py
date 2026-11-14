import httpx

r = httpx.get("http://127.0.0.1:8000/api/v1/storyboard/chapters", timeout=10.0)
for c in r.json():
    if c["total_shots"] > 0:
        print(f"Chapter {c['chapter_number']}: {c['title']} | Shots: {c['total_shots']} (Completed: {c['completed_shots']}, Pending: {c['pending_shots']})")

