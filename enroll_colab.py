"""
Colab Multi-Account Enrollment Tool
Saves permanent Application Default Credentials (ADC) per Google account
Enables zero-reauth switching and auto-failover across multiple Colab accounts.
Usage:
    python enroll_colab.py acc2
    python enroll_colab.py acc3
"""

import os
import sys
import json
import subprocess
from pathlib import Path

POOL_ROOT = Path.home() / ".config" / "colab-pool"

def enroll_account(account_alias: str):
    account_dir = POOL_ROOT / account_alias
    account_dir.mkdir(parents=True, exist_ok=True)
    adc_path = account_dir / "adc.json"
    sessions_path = account_dir / "sessions.json"

    print(f"============================================================")
    print(f"🔑 Enrolling Google Colab Account: '{account_alias}'")
    print(f"============================================================")

    # 1. Back up current keyring token if any
    old_token = None
    try:
        import keyring
        old_token = keyring.get_password("google-colab-cli", "oauth_token")
        keyring.delete_password("google-colab-cli", "oauth_token")
    except Exception:
        pass

    # 2. Trigger colab CLI OAuth flow
    colab_exe = Path(os.environ.get("USERPROFILE", "")) / "AppData/Roaming/Python/Python312/Scripts/colab.exe"
    if not colab_exe.exists():
        import shutil
        colab_exe = Path(shutil.which("colab") or "colab")

    print("\n👉 Please approve the login in your browser and check all permissions (Colab, Drive, Cloud Platform).")
    try:
        subprocess.run([
            str(colab_exe), "--auth=oauth2", "--config", str(sessions_path), "whoami"
        ], check=True)
    except subprocess.CalledProcessError as e:
        print(f"❌ Login failed or cancelled: {e}")
        # Restore old token if needed
        if old_token:
            import keyring
            keyring.set_password("google-colab-cli", "oauth_token", old_token)
        return False

    # 3. Extract the new token from keyring
    import keyring
    new_token = keyring.get_password("google-colab-cli", "oauth_token")
    if not new_token:
        print("❌ Error: Could not read new token from keyring.")
        return False

    token_data = json.loads(new_token)
    adc_payload = {
        "type": "authorized_user",
        "client_id": token_data["client_id"],
        "client_secret": token_data.get("client_secret", ""),
        "refresh_token": token_data["refresh_token"],
        "scopes": token_data.get("scopes", [
            "openid",
            "https://www.googleapis.com/auth/userinfo.profile",
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/cloud-platform",
            "https://www.googleapis.com/auth/colaboratory",
            "https://www.googleapis.com/auth/drive.file"
        ])
    }

    adc_path.write_text(json.dumps(adc_payload, indent=2), encoding="utf-8")
    if not sessions_path.exists():
        sessions_path.write_text("{}", encoding="utf-8")

    print(f"\n✅ Successfully enrolled '{account_alias}'!")
    print(f"   Credentials saved to: {adc_path}")

    # 4. Verify enrollment with ADC
    env = os.environ.copy()
    env["GOOGLE_APPLICATION_CREDENTIALS"] = str(adc_path)
    res = subprocess.run([
        str(colab_exe), "--auth=adc", "--config", str(sessions_path), "whoami"
    ], env=env, capture_output=True, text=True)
    if res.stdout:
        print("\n--- Verified Account Details ---")
        print(res.stdout.strip())
    print("============================================================\n")
    return True

if __name__ == "__main__":
    alias = sys.argv[1] if len(sys.argv) > 1 else "acc2"
    enroll_account(alias)

