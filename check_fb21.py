import json
import os

log_path = r'C:\Users\ashjx\.gemini\antigravity\brain\fb21898e-8be6-4059-8801-211129fa057b\.system_generated\logs\transcript_full.jsonl'
content = None
timestamp = None

if os.path.exists(log_path):
    for line in open(log_path, 'r', encoding='utf-8'):
        if 'write_to_file' in line or 'replace_file_content' in line:
            try:
                data = json.loads(line)
                for call in data.get('tool_calls', []):
                    args = call.get('args', {})
                    t = args.get('TargetFile', '')
                    if 'crm/page.tsx' in t.replace('\\', '/'):
                        content = args.get('CodeContent', '') or args.get('ReplacementContent', '')
                        timestamp = data.get('timestamp', 'unknown')
            except Exception:
                pass

if content:
    print(f"FOUND crm/page.tsx in fb21898e (Timestamp: {timestamp})")
    print(f"Length: {len(content)} chars")
    with open('fb21_crm_page.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
else:
    print("NOT FOUND in fb21")
