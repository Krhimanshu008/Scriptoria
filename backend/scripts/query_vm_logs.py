import urllib.request
import json
import sys

tunnel = sys.argv[1] if len(sys.argv) > 1 else 'https://dial-assure-currently-trim.trycloudflare.com'
secret = sys.argv[2] if len(sys.argv) > 2 else '2872bbab6fde759256bc595fe1159ed9103515d9e40e1a1b'

headers = {
    'X-VM-Secret': secret,
    'X-Target-Port': '9999'
}

req = urllib.request.Request(f'{tunnel}/logs', headers=headers)
try:
    with urllib.request.urlopen(req, timeout=10) as res:
        data = json.loads(res.read().decode())
        logs = data.get('logs', [])
        print(f"Total logs: {len(logs)}")
        for item in logs[-30:]:
            print(f"[{item.get('category')}] {item.get('message')}")
except Exception as e:
    print(f"Error: {e}")
