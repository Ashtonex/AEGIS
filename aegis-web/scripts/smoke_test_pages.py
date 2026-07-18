import time
import sys
import os
import httpx

PAGES_TO_TEST = [
    "/",
    "/about",
    "/about/leadership",
    "/about/story",
    "/capabilities",
    "/careers",
    "/contact",
    "/industries",
    "/knowledge",
    "/login",
    "/news",
    "/privacy",
    "/projects",
    "/suppliers",
    "/suppliers/register",
    "/tenders",
    "/terms"
]

def main():
    base_url = "http://127.0.0.1:3000"
    if len(sys.argv) > 1:
        base_url = sys.argv[1]
        
    print(f"[INFO] Targeting base URL: {base_url}")
    # Set a very generous timeout (60 seconds) to allow Next.js on-demand compilation during dev mode
    client = httpx.Client(timeout=60.0)
    
    passed_count = 0
    failed_count = 0
    report = []
    
    print("\n[INFO] Starting page-by-page smoke test of the front-end facing website:\n")
    print("[INFO] Generous 60s timeouts allowed for on-demand page compilation.\n")
    
    for page in PAGES_TO_TEST:
        url = f"{base_url}{page}"
        start_time = time.time()
        try:
            # Let's perform a GET request
            response = client.get(url)
            latency = (time.time() - start_time) * 1000
            
            # Simple content checking to verify it didn't render a fallback crash screen
            has_error_text = "Internal Server Error" in response.text or "Application error" in response.text
            
            if response.status_code == 200 and not has_error_text:
                print(f"[OK]   {page:<28} | Code: {response.status_code} | Latency: {latency:.2f}ms")
                passed_count += 1
                report.append({
                    "page": page,
                    "status": "PASSED",
                    "code": response.status_code,
                    "latency_ms": f"{latency:.1f}ms",
                    "notes": "Page hydrated and loaded successfully."
                })
            else:
                err_detail = "Server Error Content detected" if has_error_text else f"Status Code: {response.status_code}"
                print(f"[FAIL] {page:<28} | {err_detail} | Latency: {latency:.2f}ms")
                failed_count += 1
                report.append({
                    "page": page,
                    "status": "FAILED",
                    "code": response.status_code,
                    "latency_ms": f"{latency:.1f}ms",
                    "notes": f"Error: {err_detail}"
                })
        except Exception as e:
            latency = (time.time() - start_time) * 1000
            print(f"[FAIL] {page:<28} | Connection Failed: {str(e)[:40]}... | Latency: {latency:.2f}ms")
            failed_count += 1
            report.append({
                "page": page,
                "status": "FAILED",
                "code": "N/A",
                "latency_ms": f"{latency:.1f}ms",
                "notes": f"Connection Failed: {str(e)}"
            })
            
    print("\n[INFO] Test Execution Complete.")
    print(f"Passed: {passed_count} | Failed: {failed_count}\n")
    
    # Write report file
    aegis_web_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    report_file_path = os.path.join(aegis_web_dir, "smoke_test_report.md")
    with open(report_file_path, "w", encoding="utf-8") as rf:
        rf.write("# SNC AEGIS - Front-End Facing Pages Smoke Test Report\n\n")
        rf.write(f"- **Execution Time**: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        rf.write(f"- **Target URL**: {base_url}\n")
        rf.write(f"- **Total Pages Tested**: {len(PAGES_TO_TEST)}\n")
        rf.write(f"- **Passed**: {passed_count}\n")
        rf.write(f"- **Failed**: {failed_count}\n\n")
        rf.write("## Detailed Page Breakdown\n\n")
        rf.write("| Page Path | Status | Response Code | Load Latency | Description |\n")
        rf.write("|-----------|--------|---------------|--------------|-------------|\n")
        for item in report:
            status_emoji = "PASSED" if item["status"] == "PASSED" else "FAILED"
            rf.write(f"| `{item['page']}` | {status_emoji} | {item['code']} | {item['latency_ms']} | {item['notes']} |\n")
            
    print(f"[INFO] Saved test execution details to: {report_file_path}")
    
    if failed_count > 0:
        sys.exit(1)
    else:
        sys.exit(0)

if __name__ == "__main__":
    main()
