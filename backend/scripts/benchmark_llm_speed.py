import urllib.request
import json
import time
import sys

tunnel = 'https://chelsea-powerseller-beverly-carries.trycloudflare.com'
secret = 'eeb288702cd3eb78f228691342fd46319ee50a94ddcdc54e'

headers = {
    'X-VM-Secret': secret,
    'X-Target-Port': '8191',
    'Content-Type': 'application/json'
}

prompt = '<|im_start|>system\nYou are an expert narrative analyst.<|im_end|>\n<|im_start|>user\nIn two sentences, describe Santiago traveling across the desert with his flock.<|im_end|>\n<|im_start|>assistant\n'
payload = {
    'prompt': prompt,
    'n_predict': 100,
    'temperature': 0.7,
    'stream': False
}

print("Sending request to Qwen 3.5-4B Extractor (:8191)...")
t0 = time.time()
req = urllib.request.Request(f'{tunnel}/completion', data=json.dumps(payload).encode('utf-8'), headers=headers, method='POST')
try:
    with urllib.request.urlopen(req, timeout=30) as res:
        dur = time.time() - t0
        data = json.loads(res.read().decode('utf-8'))
        content = data.get('content', '')
        tokens = data.get('tokens_predicted', 0)
        speed = round(tokens / max(0.01, dur), 1)
        print(f"\n==========================================")
        print(f"BENCHMARK RESULTS (Qwen 3.5-4B Extractor):")
        print(f"Total Latency: {round(dur, 2)}s")
        print(f"Completion Tokens: {tokens}")
        print(f"Generation Speed: {speed} tokens/second")
        print(f"==========================================")
        print(f"Generated Text:\n{content.strip()}\n")
except Exception as e:
    print(f"Error: {e}")
