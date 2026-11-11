"""
VM Manager & Orchestrator
Manages the lifecycle (start, stop, toggle, health monitor, logs) of Kaggle and Google Colab VMs.
"""

from __future__ import annotations
import asyncio
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
import time
from typing import Any, Dict, Optional

import httpx

from config import settings
from log_broker import log_broker
from notebook_generator import build_kaggle_kernel_bundle

logger = logging.getLogger("vm_manager")

class VMState:
    def __init__(self, target: str, config: dict):
        self.target = target
        self.name = config.get("name", target)
        self.provider = config.get("provider", "kaggle")
        self.url = config.get("url", "")
        self.slug = config.get("slug", "")
        self.status = "STOPPED"  # STOPPED, STARTING, ONLINE, BUSY, STOPPING
        self.step = 0            # 0: idle, 1: triggered, 2: provisioning, 3: models, 4: tunnel, 5: ready
        self.gpu_name = "None"
        self.vram_free_gb = 0.0
        self.vram_total_gb = 16.0
        self.latency_ms = -1
        self.online_since: Optional[float] = None
        self.last_check = datetime.now(timezone.utc).isoformat()
        self.last_error = ""

    def to_dict(self) -> dict[str, Any]:
        uptime_sec = 0
        if self.online_since and self.status in ("ONLINE", "BUSY"):
            uptime_sec = int(time.time() - self.online_since)

        return {
            "target": self.target,
            "name": self.name,
            "provider": self.provider,
            "url": self.url,
            "slug": self.slug,
            "status": self.status,
            "step": self.step,
            "gpu_name": self.gpu_name,
            "vram_free_gb": self.vram_free_gb,
            "vram_total_gb": self.vram_total_gb,
            "latency_ms": self.latency_ms,
            "uptime_seconds": uptime_sec,
            "last_check": self.last_check,
            "last_error": self.last_error,
        }

class VMManager:
    def __init__(self):
        self.states: Dict[str, VMState] = {
            target: VMState(target, cfg)
            for target, cfg in settings.ENDPOINTS.items()
        }
        self.http_client = httpx.AsyncClient(timeout=10.0, follow_redirects=True)
        self._bg_task: Optional[asyncio.Task] = None

    def start_background_monitoring(self):
        if self._bg_task is None or self._bg_task.done():
            self._bg_task = asyncio.create_task(self._monitor_loop())

    async def get_all_status(self) -> dict[str, Any]:
        return {target: state.to_dict() for target, state in self.states.items()}

    async def toggle(self, target: str) -> dict[str, Any]:
        """Toggles the state of a VM: if online or starting -> stop; if stopped -> start."""
        if target not in self.states:
            raise ValueError(f"Unknown target: {target}")

        state = self.states[target]
        if state.status in ("ONLINE", "BUSY", "STARTING"):
            log_broker.log(f"Toggle requested: STOPPING {target}...", category="ACTION")
            return await self.stop_vm(target)
        else:
            log_broker.log(f"Toggle requested: STARTING {target}...", category="ACTION")
            return await self.start_vm(target)

    async def start_vm(self, target: str) -> dict[str, Any]:
        if target not in self.states:
            raise ValueError(f"Unknown target: {target}")

        state = self.states[target]

        if state.provider == "kaggle":
            account_alias = "acc2" if target in ("gpu2", "gpu3") else "acc1"
            kaggle_targets = [t for t, s in self.states.items() if s.provider == "kaggle" and (("acc2" if t in ("gpu2", "gpu3") else "acc1") == account_alias)]
            if any(self.states[t].status in ("STARTING", "ONLINE", "BUSY") for t in kaggle_targets):
                log_broker.log(f"ℹ️ Kaggle Dual-GPU session ({account_alias}) is already starting or running! (Consumes 1x quota)", category="KAGGLE")
                return state.to_dict()

            for t in kaggle_targets:
                self.states[t].status = "STARTING"
                self.states[t].step = 1
                self.states[t].last_error = ""

            log_broker.log(f"🚀 Initializing Kaggle Dual-GPU session ({account_alias}: 2x T4 GPUs, 1x Quota)...", category="KAGGLE")
            asyncio.create_task(self._run_kaggle_push("kaggle_dual", account_alias=account_alias))
        elif state.provider == "colab":
            state.status = "STARTING"
            state.step = 1
            state.last_error = ""
            account_alias = "acc2" if target == "gcgpu1" else "acc1"
            log_broker.log(f"🚀 Initializing boot sequence for {state.name} ({target}, account: {account_alias})...", category=state.provider)
            asyncio.create_task(self._run_colab_start(target, account_alias=account_alias))

        await self._broadcast_states()
        return state.to_dict()

    async def _run_kaggle_push(self, target: str = "kaggle_dual", account_alias: str = "acc1"):
        kaggle_targets = [t for t, s in self.states.items() if s.provider == "kaggle" and (("acc2" if t in ("gpu2", "gpu3") else "acc1") == account_alias)]
        try:
            log_broker.log(f"📦 Building unified Kaggle Dual-GPU kernel bundle for {account_alias}...", category="KAGGLE")
            bundle_dir = build_kaggle_kernel_bundle("kaggle_dual", account_alias=account_alias)
            for t in kaggle_targets:
                self.states[t].step = 2
            log_broker.log(f"📦 Kernel bundle generated at: {bundle_dir}", category="KAGGLE")

            # Setup Kaggle environment variables for the selected account
            env = os.environ.copy()
            acc_dir = Path.home() / ".config" / "kaggle-pool" / account_alias
            acc_dir.mkdir(parents=True, exist_ok=True)

            if account_alias == "acc2":
                username = settings.KAGGLE_ACC2_USERNAME
                key = settings.KAGGLE_ACC2_KEY
                env.pop("KAGGLE_API_TOKEN", None)
            else:
                username = settings.KAGGLE_ACC1_USERNAME
                key = settings.KAGGLE_ACC1_KEY
                env["KAGGLE_API_TOKEN"] = key

            (acc_dir / "kaggle.json").write_text(json.dumps({"username": username, "key": key}), encoding="utf-8")
            env["KAGGLE_CONFIG_DIR"] = str(acc_dir)
            env["KAGGLE_USERNAME"] = username
            env["KAGGLE_KEY"] = key

            cmd = [sys.executable, "-m", "kaggle", "kernels", "push", "-p", str(bundle_dir)]
            log_broker.log(f"[CLI] Executing: {' '.join(cmd)} (Account: {username})", category="CLI")

            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env
            )

            async def stream_output(stream, is_err=False):
                while True:
                    line = await stream.readline()
                    if not line:
                        break
                    text = line.decode(errors="replace").strip()
                    if text:
                        log_broker.log(text, category="KAGGLE", level="ERROR" if is_err else "INFO")

            await asyncio.gather(
                stream_output(process.stdout, False),
                stream_output(process.stderr, True)
            )

            rc = await process.wait()
            if rc == 0:
                for t in kaggle_targets:
                    self.states[t].step = 3
                log_broker.log(f"✅ Kaggle kernel successfully pushed for {username}! Dual T4 VM provisioning...", category="KAGGLE")
                asyncio.create_task(self._stream_kaggle_kernel_logs(f"{username}/kaggle-dual-gpu-runner"))
            else:
                for t in kaggle_targets:
                    self.states[t].status = "STOPPED"
                    self.states[t].step = 0
                    self.states[t].last_error = f"Kaggle push failed with exit code {rc}"
                log_broker.log(f"❌ Kaggle push exited with code {rc}", category="KAGGLE", level="ERROR")

        except Exception as e:
            for t in kaggle_targets:
                self.states[t].status = "STOPPED"
                self.states[t].step = 0
                self.states[t].last_error = str(e)
            log_broker.log(f"❌ Error during Kaggle boot sequence: {e}", category="KAGGLE", level="ERROR")
        finally:
            await self._broadcast_states()

    async def _stream_kaggle_kernel_logs(self, slug: str):
        """Continuously streams execution logs from Kaggle midtier SSE feed into web terminal."""
        log_broker.log(f"📡 Attaching live log stream for Kaggle kernel: {slug}...", category="KAGGLE")

        def run_stream():
            from kaggle import api
            import re
            try:
                for item in api.kernels_logs_stream(slug):
                    data = item.get("data", "")
                    if data:
                        for raw_line in data.splitlines():
                            line = raw_line.strip()
                            if not line:
                                continue
                            log_broker.log(line, category="KAGGLE")

                            # Detect Cloudflare Quick Tunnel URL
                            m = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
                            if m:
                                live_url = m.group(0)
                                if "GPU 1" in line or "8189" in line:
                                    self.states["gpu1"].url = live_url
                                    self.states["gpu1"].step = 4
                                    log_broker.log(f"🎉 Captured Live Quick Tunnel for GPU 1: {live_url}", category="NETWORK", level="SUCCESS")
                                else:
                                    self.states["gpu0"].url = live_url
                                    self.states["gpu0"].step = 4
                                    log_broker.log(f"🎉 Captured Live Quick Tunnel for GPU 0: {live_url}", category="NETWORK", level="SUCCESS")
            except Exception as ex:
                logger.debug("Kaggle log stream ended: %s", ex)

        await asyncio.to_thread(run_stream)

    async def _run_colab_start(self, target: str, account_alias: str = "acc1"):
        state = self.states[target]
        colab_exe = Path(os.environ.get("USERPROFILE", "")) / "AppData/Roaming/Python/Python312/Scripts/colab.exe"
        if not colab_exe.exists():
            import shutil
            colab_exe = Path(shutil.which("colab") or "")

        port = settings.ENDPOINTS.get(target, {}).get("port", 8188)
        session_name = f"comfy-node-{account_alias}" if account_alias != "acc1" else "comfy-node"

        pool_dir = Path.home() / ".config" / "colab-pool" / account_alias
        adc_path = pool_dir / "adc.json"
        sessions_path = pool_dir / "sessions.json"

        is_authenticated = False
        use_adc = False
        if adc_path.exists():
            is_authenticated = True
            use_adc = True
        else:
            try:
                import keyring
                token = keyring.get_password("google-colab-cli", "oauth_token")
                if token and account_alias == "acc1":
                    is_authenticated = True
            except Exception:
                pass

        try:
            if is_authenticated and colab_exe.exists():
                state.step = 2
                log_broker.log(f"⚡ Google Colab target selected ({target}, port: {port}).", category="COLAB")
                log_broker.log(f"🚀 Provisioning Google Colab T4 GPU via CLI (Session: {session_name}, Account: {account_alias})...", category="COLAB")
                await self._broadcast_states()

                def run_cli_flow():
                    env = os.environ.copy()
                    if use_adc:
                        env["GOOGLE_APPLICATION_CREDENTIALS"] = str(adc_path)
                        auth_args = ["--auth=adc", "--config", str(sessions_path)]
                    else:
                        auth_args = ["--auth=oauth2"]

                    # 1. Provision VM if not already present
                    cmd_new = [str(colab_exe)] + auth_args + ["new", "-s", session_name, "--gpu", "T4"]
                    log_broker.log(f"[CLI] Executing: {' '.join(cmd_new)}", category="CLI")
                    res = subprocess.run(cmd_new, env=env, capture_output=True, text=True)
                    if res.stdout:
                        for line in res.stdout.splitlines():
                            if line.strip():
                                log_broker.log(line.strip(), category="COLAB")
                    if res.stderr and "already exists" not in res.stderr:
                        log_broker.log(res.stderr.strip(), category="COLAB")

                    # 2. Push and execute colab_bootstrap.py with real-time log streaming
                    log_broker.log(f"📦 Uploading & running colab_bootstrap.py remotely on port {port}...", category="COLAB")
                    cmd_exec = [str(colab_exe)] + auth_args + [
                        "exec", "-s", session_name, "-f", "colab_bootstrap.py",
                        "--env", f"COMFY_PORT={port}",
                        "--env", f"CF_TOKEN_GCGPU={settings.CF_TOKEN_GCGPU}",
                        "--env", f"GDRIVE_CLIENT_ID={settings.GDRIVE_CLIENT_ID}",
                        "--env", f"GDRIVE_CLIENT_SECRET={settings.GDRIVE_CLIENT_SECRET}",
                        "--env", f"GDRIVE_REFRESH_TOKEN={settings.GDRIVE_REFRESH_TOKEN}",
                        "--timeout", "0"
                    ]
                    log_broker.log(f"[CLI] Executing: {' '.join(cmd_exec)}", category="CLI")

                    proc = subprocess.Popen(cmd_exec, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
                    for line in iter(proc.stdout.readline, ""):
                        stripped = line.strip()
                        if stripped:
                            log_broker.log(stripped, category="COLAB")
                            if "Step 2" in stripped:
                                state.step = 2
                            elif "Step 3" in stripped:
                                state.step = 3
                            elif "Step 5" in stripped or "Binding Named Tunnel" in stripped:
                                state.step = 4
                    proc.stdout.close()
                    proc.wait()

                await asyncio.to_thread(run_cli_flow)
                state.step = 4
                log_broker.log("⏳ Waiting for Colab VM to bind Cloudflare tunnel...", category="COLAB")
            else:
                from notebook_generator import build_colab_bundle
                nb_path = build_colab_bundle()
                state.step = 1
                log_broker.log(f"⚡ Google Colab target selected ({target}).", category="COLAB")
                log_broker.log(f"ℹ️ Account '{account_alias}' is not enrolled yet. Run this once in PowerShell to enroll:", category="COLAB")
                log_broker.log(f'   python enroll_colab.py {account_alias}', category="CLI")
                log_broker.log(f"👉 Alternatively, 1-click web runner is ready: {nb_path}", category="COLAB")
                log_broker.log("⏳ Waiting for Colab VM to bind Cloudflare tunnel...", category="COLAB")
        except Exception as e:
            state.last_error = str(e)
            log_broker.log(f"❌ Colab start error: {e}", category="COLAB", level="ERROR")
        finally:
            await self._broadcast_states()
            await self._broadcast_states()

    async def stop_vm(self, target: str) -> dict[str, Any]:
        if target not in self.states:
            raise ValueError(f"Unknown target: {target}")

        state = self.states[target]

        if state.provider == "kaggle":
            account_alias = "acc2" if target in ("gpu2", "gpu3") else "acc1"
            kaggle_targets = [t for t, s in self.states.items() if s.provider == "kaggle" and (("acc2" if t in ("gpu2", "gpu3") else "acc1") == account_alias)]
            for t in kaggle_targets:
                self.states[t].status = "STOPPING"
            log_broker.log(f"🛑 Sending shutdown signal to Kaggle Dual-GPU session ({account_alias})...", category="ACTION")
            await self._broadcast_states()

            # Step 1: Send in-band HTTP shutdown to /vm-kill
            for t in kaggle_targets:
                kill_host = self.states[t].url
                try:
                    kill_url = f"{kill_host}/vm-kill"
                    log_broker.log(f"[HTTP] POST {kill_url}", category="CLI")
                    resp = await self.http_client.post(kill_url, timeout=3.0)
                    if resp.status_code == 200:
                        log_broker.log("✅ In-band remote shutdown acknowledged by Kaggle container!", category="SUCCESS")
                        break
                except Exception:
                    pass

            # Step 2: Check Kaggle status via CLI
            if state.slug:
                try:
                    env = os.environ.copy()
                    if account_alias == "acc2":
                        env["KAGGLE_USERNAME"] = settings.KAGGLE_ACC2_USERNAME
                        env["KAGGLE_KEY"] = settings.KAGGLE_ACC2_KEY
                    else:
                        env["KAGGLE_USERNAME"] = settings.KAGGLE_ACC1_USERNAME
                        env["KAGGLE_KEY"] = settings.KAGGLE_ACC1_KEY

                    cmd = [sys.executable, "-m", "kaggle", "kernels", "status", state.slug]
                    log_broker.log(f"[CLI] Checking status: {' '.join(cmd)}", category="CLI")
                    res = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=8)
                    if res.stdout:
                        log_broker.log(f"Kaggle Status: {res.stdout.strip()}", category="KAGGLE")
                except Exception as e:
                    logger.debug("Kaggle CLI status check: %s", e)

            # Mark targets as stopped
            for t in kaggle_targets:
                st = self.states[t]
                st.status = "STOPPED"
                st.step = 0
                st.online_since = None
                st.latency_ms = -1
                st.gpu_name = "None"
                st.vram_free_gb = 0.0

            log_broker.log(f"🔴 Kaggle Dual-GPU Session ({account_alias}) marked as STOPPED.", category="ACTION")
            await self._broadcast_states()
            return state.to_dict()

        state.status = "STOPPING"
        log_broker.log(f"🛑 Sending shutdown termination signal to {state.name}...", category="ACTION")
        await self._broadcast_states()

        kill_url = f"{state.url}/vm-kill"
        try:
            log_broker.log(f"[HTTP] POST {kill_url}", category="CLI")
            resp = await self.http_client.post(kill_url, timeout=4.0)
            if resp.status_code == 200:
                log_broker.log(f"✅ In-band remote shutdown acknowledged by {target}!", category="SUCCESS")
        except Exception as e:
            log_broker.log(f"In-band kill notice: {e} (VM may already be halting)", category="INFO")

        # If Colab, release CLI session if available
        if state.provider == "colab":
            colab_exe = Path(os.environ.get("USERPROFILE", "")) / "AppData/Roaming/Python/Python312/Scripts/colab.exe"
            if colab_exe.exists():
                try:
                    cmd_stop = [str(colab_exe), "--auth=oauth2", "stop", "-s", "comfy-node"]
                    log_broker.log(f"[CLI] Releasing Colab VM: {' '.join(cmd_stop)}", category="CLI")
                    subprocess.run(cmd_stop, capture_output=True, text=True, timeout=8)
                    log_broker.log("✅ Colab session stopped via CLI.", category="SUCCESS")
                except Exception as e:
                    logger.debug("Colab CLI stop notice: %s", e)

        state.status = "STOPPED"
        state.step = 0
        state.online_since = None
        state.latency_ms = -1
        state.gpu_name = "None"
        state.vram_free_gb = 0.0
        log_broker.log(f"🔴 VM {state.name} ({target}) marked as STOPPED.", category="ACTION")
        await self._broadcast_states()
        return state.to_dict()

    async def _monitor_loop(self):
        """Continuous background poller checking /system_stats for each VM every 5 seconds."""
        while True:
            try:
                await asyncio.sleep(5.0)
                tasks = [self._check_vm_health(target) for target in self.states]
                await asyncio.gather(*tasks)
                await self._broadcast_states()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug("Monitor loop exception: %s", e)

    async def _check_vm_health(self, target: str):
        state = self.states[target]
        url = f"{state.url}/system_stats"
        t0 = time.time()
        try:
            resp = await self.http_client.get(url, timeout=4.0)
            latency = int((time.time() - t0) * 1000)
            if resp.status_code == 200:
                data = resp.json()
                devices = data.get("devices", [])
                state.latency_ms = latency
                state.last_check = datetime.now(timezone.utc).isoformat()
                state.step = 5  # Ready & online

                if devices:
                    state.gpu_name = devices[0].get("name", "NVIDIA GPU")
                    vram_free = devices[0].get("vram_free", 0) / (1024**3)
                    vram_total = devices[0].get("vram_total", 16 * (1024**3)) / (1024**3)
                    state.vram_free_gb = round(vram_free, 2)
                    state.vram_total_gb = round(vram_total, 2)

                if state.status != "BUSY":
                    if state.status != "ONLINE":
                        state.online_since = time.time()
                        log_broker.log(f"🟢 {state.name} ({target}) is ONLINE! Latency: {latency}ms, GPU: {state.gpu_name} ({state.vram_free_gb} GB VRAM free)", category="HEALTH", level="SUCCESS")
                    state.status = "ONLINE"
                return

            # Error code 1033 / 502 means Cloudflare tunnel is not connected
            self._handle_unreachable(state, f"HTTP {resp.status_code}")
        except Exception as e:
            self._handle_unreachable(state, str(e))

    def _handle_unreachable(self, state: VMState, reason: str):
        state.latency_ms = -1
        state.last_check = datetime.now(timezone.utc).isoformat()
        if state.status == "ONLINE":
            log_broker.log(f"⚪ {state.name} went offline ({reason})", category="HEALTH")
            state.status = "STOPPED"
            state.step = 0
            state.online_since = None
        elif state.status == "STARTING":
            # Still waiting for boot
            pass
        elif state.status == "STOPPING":
            state.status = "STOPPED"
            state.step = 0

    async def _broadcast_states(self):
        payload = {target: state.to_dict() for target, state in self.states.items()}
        await log_broker.broadcast_status(payload)

vm_manager = VMManager()

