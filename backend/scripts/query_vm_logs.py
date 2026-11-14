import urllib.request
import json
import sys

tunnel = 'https://dawn-largest-quotations-viewer.trycloudflare.com'
headers = {
    'X-VM-Secret': 'aed9f5a1784f677f931fb05cc517c47a08f7a5849878dfaf',
    'X-Target-Port': '9999'
}

req = urllib.request.Request(f'{tunnel}/logs', headers=headers)
try:
    with urllib.request.urlopen(req, timeout=10) as res:
        data = json.loads(res.read().decode())
        logs = data.get('logs', [])
        print(f"Total logs: {len(logs)}")
        for item in logs[-40:]:
            print(f"[{item.get('category')}] {item.get('message')}")
except Exception as e:
    print(f"Error: {e}")
