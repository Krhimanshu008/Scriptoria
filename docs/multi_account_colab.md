Yes — you can set up a permanent, one-time multi-account pool.[1]
By default, google-colab-cli (--auth=oauth2) only supports one account at a time because it writes your OAuth refresh token into a single global OS keyring slot (service_name="google-colab-cli", username="oauth_token") and tracks sessions in a single ~/.config/colab-cli/sessions.json file[2][3]. Logging into Account 2 overwrites Account 1.
How to Unlock Multi-Account Support (One-Time Setup)
You can bypass the single-account lock by combining two built-in mechanisms in google-colab-cli:
--auth=adc + GOOGLE_APPLICATION_CREDENTIALS: Forces the CLI to ignore the global keyring and read credentials from a specific JSON file per account[2][4].
--config <path>: Gives each account its own isolated sessions.json file so you can switch accounts instantaneously—or even run multiple Colab GPUs in parallel across different accounts[5].
Shared Model Library: Regardless of which Colab account provides the GPU (acc1, acc2, acc3), your colab_bootstrap.py still injects your master Rclone token, meaning all accounts stream from your single 62.74 GB Google Drive model library.
Step 1: One-Time Account Enrollment (No gcloud Required)
You only need to run this once per Google account. It uses google-colab-cli's own authentication flow, grabs the permanent refresh token, converts it into an ADC-compatible JSON file ("type": "authorized_user"), and saves it in ~/.config/colab-pool/<account_name>/adc.json.
Save this as enroll_account.py and run it using the colab CLI's Python environment:
Python
# enroll_account.py
import json, os, sys, subprocess
from pathlib import Path

def enroll(account_alias: str):
    pool_dir = Path.home() / ".config" / "colab-pool" / account_alias
    pool_dir.mkdir(parents=True, exist_ok=True)
    adc_path = pool_dir / "adc.json"
    sessions_path = pool_dir / "sessions.json"

    print(f"🔑 Logging in for account '{account_alias}'...")
    # Clear existing keyring token so colab prompts a fresh browser login
    subprocess.run([
        sys.executable, "-c",
        "import keyring; keyring.delete_password('google-colab-cli', 'oauth_token')"
    ], stderr=subprocess.DEVNULL)

    # Trigger interactive login via colab CLI
    subprocess.run(["colab", "--auth=oauth2", "--config", str(sessions_path), "whoami"], check=True)

    # Extract the stored OAuth token from keyring and save as permanent ADC JSON
    raw_token = subprocess.check_output([
        sys.executable, "-c",
        "import keyring; print(keyring.get_password('google-colab-cli', 'oauth_token') or '')"
    ], text=True).strip()

    if not raw_token:
        raise RuntimeError("Failed to read token from keyring.")

    token_data = json.loads(raw_token)
    # Format as standard Google Application Default Credentials (authorized_user)
    adc_payload = {
        "type": "authorized_user",
        "client_id": token_data["client_id"],
        "client_secret": token_data["client_secret"],
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

    adc_path.write_text(json.dumps(adc_payload, indent=2))
    os.chmod(adc_path, 0o600)
    print(f"✅ Saved permanent credentials for '{account_alias}' -> {adc_path}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python enroll_account.py <acc1|acc2|acc3>")
        sys.exit(1)
    enroll(sys.argv[1])
Enroll all your accounts once:
Bash
# Run using the python inside uv's google-colab-cli environment (or your venv)
~/.local/share/uv/tools/google-colab-cli/bin/python enroll_account.py acc1
~/.local/share/uv/tools/google-colab-cli/bin/python enroll_account.py acc2
~/.local/share/uv/tools/google-colab-cli/bin/python enroll_account.py acc3
(Alternative if you already use gcloud: run gcloud auth application-default login --scopes=openid,https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/colaboratory and copy ~/.config/gcloud/application_default_credentials.json to ~/.config/colab-pool/acc1/adc.json)[6][7].
Step 2: Create a Multi-Account CLI Helper (mcolab)
Drop this function into your ~/.bashrc or ~/.zshrc. It lets you target any account instantaneously from your terminal:
Bash
mcolab() {
    local acc="$1"
    shift
    GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/colab-pool/$acc/adc.json" \
    colab --auth=adc --config "$HOME/.config/colab-pool/$acc/sessions.json" "$@"
}
Now you can run commands against any account with zero re-authentication[3][8]:
Bash
mcolab acc1 whoami          # Prints acc1@gmail.com
mcolab acc2 whoami          # Prints acc2@gmail.com
mcolab acc1 usage           # Checks compute unit balance / GPU quota on acc1
mcolab acc2 new -s comfy-node --gpu T4
Step 3: Multi-Account IDE & SSH Tunneling (~/.ssh/config)
Update your ~/.ssh/config so each account has its own SSH profile. You can either map them to the same local ports (8188/8189) when switching accounts sequentially, or different local ports if you want two GPUs running at the same time:
Sshconfig
# Match any colab-acc* host (e.g., ssh colab-acc1, ssh colab-acc2)
Host colab-acc1
    HostName comfy-node
    User root
    ProxyCommand env GOOGLE_APPLICATION_CREDENTIALS=%d/.config/colab-pool/acc1/adc.json colab --auth=adc --config %d/.config/colab-pool/acc1/sessions.json ssh --proxy-mode -s %h
    LocalForward 8188 127.0.0.1:8188
    LocalForward 8189 127.0.0.1:8189
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    ServerAliveInterval 30

Host colab-acc2
    HostName comfy-node
    User root
    ProxyCommand env GOOGLE_APPLICATION_CREDENTIALS=%d/.config/colab-pool/acc2/adc.json colab --auth=adc --config %d/.config/colab-pool/acc2/sessions.json ssh --proxy-mode -s %h
    LocalForward 8188 127.0.0.1:8188
    LocalForward 8189 127.0.0.1:8189
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    ServerAliveInterval 30

Host colab-acc3
    HostName comfy-node
    User root
    ProxyCommand env GOOGLE_APPLICATION_CREDENTIALS=%d/.config/colab-pool/acc3/adc.json colab --auth=adc --config %d/.config/colab-pool/acc3/sessions.json ssh --proxy-mode -s %h
    LocalForward 8188 127.0.0.1:8188
    LocalForward 8189 127.0.0.1:8189
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    ServerAliveInterval 30
Step 4: Smart Multi-Account Pool Controller (With Auto-Failover)
Upgrade your local FastAPI controller so your Web Dashboard can:
List all enrolled accounts and their current statuses.
Toggle a specific account ("account": "acc2"), OR pass "account": "auto" to automatically failover to the next account when one hits its daily GPU quota limit!
Python
import os
import subprocess
from pathlib import Path
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()
POOL_ROOT = Path.home() / ".config" / "colab-pool"
SESSION_NAME = "comfy-node"

active_state = {
    "account": None,
    "ssh_proc": None
}

class PoolToggleRequest(BaseModel):
    action: str               # "start" or "stop"
    account: str = "auto"     # "auto", "acc1", "acc2", "acc3"
    gpu: str = "T4"           # "T4", "L4", "A100"

def run_colab_for_account(account: str, args: list[str]) -> subprocess.CompletedProcess:
    """Runs colab CLI isolated to a specific enrolled account."""
    acc_dir = POOL_ROOT / account
    adc_file = acc_dir / "adc.json"
    sessions_file = acc_dir / "sessions.json"

    if not adc_file.exists():
        raise FileNotFoundError(f"Account '{account}' is not enrolled at {adc_file}")

    env = os.environ.copy()
    env["GOOGLE_APPLICATION_CREDENTIALS"] = str(adc_file)

    cmd = ["colab", "--auth=adc", "--config", str(sessions_file)] + args
    return subprocess.run(cmd, env=env, capture_output=True, text=True)

def get_enrolled_accounts() -> list[str]:
    if not POOL_ROOT.exists():
        return []
    return sorted([p.name for p in POOL_ROOT.iterdir() if (p / "adc.json").exists()])

@app.get("/colab/accounts")
async def list_accounts():
    """Returns all enrolled accounts and which one is currently active."""
    accounts = []
    for acc in get_enrolled_accounts():
        whoami = run_colab_for_account(acc, ["whoami"])
        accounts.append({
            "alias": acc,
            "active": active_state["account"] == acc,
            "info": whoami.stdout.strip() if whoami.returncode == 0 else "auth_error"
        })
    return {"accounts": accounts}

@app.post("/colab/toggle")
async def toggle_pool(req: PoolToggleRequest):
    if req.action == "start":
        candidates = get_enrolled_accounts() if req.account == "auto" else [req.account]
        if not candidates:
            raise HTTPException(status_code=400, detail="No enrolled accounts found.")

        last_err = ""
        for acc in candidates:
            print(f"🚀 Attempting to provision {req.gpu} on '{acc}'...")
            res = run_colab_for_account(acc, ["new", "-s", SESSION_NAME, "--gpu", req.gpu])
            
            if res.returncode == 0 or "already exists" in res.stderr:
                # Successfully allocated GPU on this account!
                run_colab_for_account(acc, ["upload", "-s", SESSION_NAME, "sidecar.py", "/content/sidecar.py"])
                run_colab_for_account(acc, ["exec", "-s", SESSION_NAME, "-f", "colab_bootstrap.py"])

                # Start SSH port-forward for this specific account
                if active_state["ssh_proc"] and active_state["ssh_proc"].poll() is None:
                    active_state["ssh_proc"].terminate()

                active_state["ssh_proc"] = subprocess.Popen(["ssh", "-N", f"colab-{acc}"])
                active_state["account"] = acc

                return {
                    "status": "online",
                    "account": acc,
                    "gpu": req.gpu,
                    "comfyui_url": "http://localhost:8188",
                    "sidecar_url": "http://localhost:8189"
                }
            else:
                last_err = f"[{acc}] {res.stderr.strip()}"
                print(f"⚠️ Quota/allocation failed on {acc}, trying next... ({last_err})")

        raise HTTPException(status_code=503, detail=f"All accounts exhausted. Last error: {last_err}")

    elif req.action == "stop":
        target_acc = active_state["account"] or (req.account if req.account != "auto" else None)
        if active_state["ssh_proc"] and active_state["ssh_proc"].poll() is None:
            active_state["ssh_proc"].terminate()
            active_state["ssh_proc"] = None

        if target_acc:
            run_colab_for_account(target_acc, ["stop", "-s", SESSION_NAME])
            active_state["account"] = None

        return {"status": "offline", "stopped_account": target_acc}
Summary of What This Gives You
True One-Time Setup: You run enroll_account.py acc1, acc2, acc3 once. Each account's refresh_token is permanently stored in ~/.config/colab-pool/<acc>/adc.json.
Automatic Failover: When you click "Start GPU" on your Web Dashboard with "account": "auto", if acc1 hits Google's GPU quota/cooldown, the controller automatically provisions acc2, runs colab_bootstrap.py, and binds localhost:8188 and localhost:8189 to acc2.
Single Unified Model Storage: All accounts pull models on-demand from your primary Google Drive (NovelVisualizer/ComfyUI_Storage/models/) into /tmp/models via Rclone RC.