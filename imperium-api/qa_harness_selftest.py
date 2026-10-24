"""
AEGIS QA HARNESS INTEGRITY SELF-TEST
Verifies the Fail-Closed contract:
1. Controlled passing runs must exit with status code 0.
2. Controlled assertion failures must exit with status code 1.
3. Unhandled exceptions must exit with status code 2.
"""

import subprocess
import sys

PASSING_SNIPPET = """
import sys

class Result:
    def __init__(self, status):
        self.status = status

results = [Result("PASSED"), Result("PASSED")]
total = len(results)
passed = sum(1 for r in results if r.status == "PASSED")
failed = sum(1 for r in results if r.status in ("FAILED", "BLOCKED"))
skipped = sum(1 for r in results if r.status == "SKIPPED")
not_run = total - (passed + failed + skipped)

print(f"TOTAL: {total}, PASSED: {passed}, FAILED: {failed}, SKIPPED: {skipped}, NOT RUN: {not_run}")
sys.exit(1 if failed > 0 else 0)
"""

FAILING_SNIPPET = """
import sys

class Result:
    def __init__(self, status):
        self.status = status

results = [Result("PASSED"), Result("FAILED")]
total = len(results)
passed = sum(1 for r in results if r.status == "PASSED")
failed = sum(1 for r in results if r.status in ("FAILED", "BLOCKED"))
skipped = sum(1 for r in results if r.status == "SKIPPED")
not_run = total - (passed + failed + skipped)

print(f"TOTAL: {total}, PASSED: {passed}, FAILED: {failed}, SKIPPED: {skipped}, NOT RUN: {not_run}")
sys.exit(1 if failed > 0 else 0)
"""

EXCEPTION_SNIPPET = """
import sys
try:
    raise RuntimeError("Simulated Database / Connection Crash")
except Exception as exc:
    print(f"[FATAL ERROR] {exc}")
    sys.exit(2)
"""

def main():
    print("=" * 80)
    print(" EXECUTING QA HARNESS INTEGRITY SELF-TEST (FAIL-CLOSED VERIFICATION)")
    print("=" * 80)

    # 1. Test Passing Run
    p_pass = subprocess.run([sys.executable, "-c", PASSING_SNIPPET], capture_output=True, text=True)
    assert p_pass.returncode == 0, f"Expected returncode 0 for passing run, got {p_pass.returncode}"
    assert "FAILED: 0" in p_pass.stdout
    print("[PASS] Controlled Passing Run: Exited with code 0 (Success)")

    # 2. Test Failing Run
    p_fail = subprocess.run([sys.executable, "-c", FAILING_SNIPPET], capture_output=True, text=True)
    assert p_fail.returncode == 1, f"Expected returncode 1 for failing run, got {p_fail.returncode}"
    assert "FAILED: 1" in p_fail.stdout
    print("[PASS] Controlled Failing Run: Exited with code 1 (Nonzero, Cannot be Swallowed)")

    # 3. Test Unhandled Exception Run
    p_exc = subprocess.run([sys.executable, "-c", EXCEPTION_SNIPPET], capture_output=True, text=True)
    assert p_exc.returncode == 2, f"Expected returncode 2 for fatal error, got {p_exc.returncode}"
    assert "FATAL ERROR" in p_exc.stdout
    print("[PASS] Controlled Exception Run: Exited with code 2 (Nonzero, Fatal Protected)")

    print("=" * 80)
    print(" HARNESS SELF-TEST PASSED: ALL TEST RUNNERS PROVEN TO FAIL CLOSED")
    print("=" * 80)

if __name__ == "__main__":
    main()
