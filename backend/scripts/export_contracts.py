from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_PATH = Path(__file__).resolve()
BACKEND_DIR = SCRIPT_PATH.parents[1]
REPO_ROOT = SCRIPT_PATH.parents[2]
DEFAULT_OUTPUT_DIR = REPO_ROOT / "contracts"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def canonicalize_json_bytes(payload: dict[str, Any]) -> bytes:
    """Serialize payload with recursively sorted dictionary keys and zero whitespace."""
    canonical_str = json.dumps(
        payload,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    )
    return canonical_str.encode("utf-8")


def format_pretty_json(payload: dict[str, Any]) -> str:
    """Serialize payload deterministically for git-tracked contract artifacts."""
    return (
        json.dumps(
            payload,
            sort_keys=True,
            indent=2,
            ensure_ascii=False,
            allow_nan=False,
        )
        + "\n"
    )


def compute_contract_hash(openapi_schema: dict[str, Any]) -> str:
    """Compute deterministic SHA-256 hex digest of the canonicalized OpenAPI schema."""
    return hashlib.sha256(canonicalize_json_bytes(openapi_schema)).hexdigest()


def build_contract_metadata(
    openapi_schema: dict[str, Any],
    contract_hash: str,
    *,
    schema_version: str | None = None,
    include_timestamp: bool = False,
) -> dict[str, Any]:
    """Construct contract_meta.json payload describing the exported OpenAPI contract."""
    info = openapi_schema.get("info", {})
    paths = openapi_schema.get("paths", {})
    components = openapi_schema.get("components", {})
    schemas = components.get("schemas", {})

    resolved_version = schema_version or str(info.get("version") or "0.1.0")

    meta: dict[str, Any] = {
        "contract_hash": contract_hash,
        "hash_algorithm": "sha256",
        "title": str(info.get("title") or "Scriptoria API"),
        "schema_version": resolved_version,
        "openapi_version": str(openapi_schema.get("openapi") or "3.1.0"),
        "paths_count": len(paths),
        "schemas_count": len(schemas),
        "schema_names": sorted(schemas.keys()),
        "artifacts": {
            "openapi": "openapi.json",
        },
    }
    if include_timestamp:
        meta["generated_at"] = datetime.now(timezone.utc).isoformat()
    return meta


def export_contracts(
    *,
    output_dir: Path = DEFAULT_OUTPUT_DIR,
    schema_version: str | None = None,
    include_timestamp: bool = False,
    check_only: bool = False,
) -> tuple[str, Path, Path]:
    """Extract FastAPI OpenAPI schema and write or verify contract artifacts."""
    from app.main import app  # Imported lazily after sys.path bootstrap

    # Reset cached schema if needed to guarantee fresh generation from mounted routes.
    app.openapi_schema = None
    openapi_schema = app.openapi()

    contract_hash = compute_contract_hash(openapi_schema)
    contract_meta = build_contract_metadata(
        openapi_schema,
        contract_hash,
        schema_version=schema_version,
        include_timestamp=include_timestamp,
    )

    openapi_text = format_pretty_json(openapi_schema)
    meta_text = format_pretty_json(contract_meta)

    openapi_path = output_dir / "openapi.json"
    meta_path = output_dir / "contract_meta.json"

    if check_only:
        if not openapi_path.is_file() or not meta_path.is_file():
            raise SystemExit(
                f"Contract drift check failed: missing files in {output_dir}. "
                "Run export_contracts.py without --check to regenerate."
            )
        existing_openapi = openapi_path.read_text(encoding="utf-8")
        existing_meta = meta_path.read_text(encoding="utf-8")
        if existing_openapi != openapi_text or existing_meta != meta_text:
            raise SystemExit(
                "Contract drift detected between FastAPI schema and contracts/ artifacts. "
                "Run backend/scripts/export_contracts.py to update."
            )
        return contract_hash, openapi_path, meta_path

    output_dir.mkdir(parents=True, exist_ok=True)
    openapi_path.write_text(openapi_text, encoding="utf-8")
    meta_path.write_text(meta_text, encoding="utf-8")

    return contract_hash, openapi_path, meta_path


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export deterministic OpenAPI schema and SHA-256 contract metadata."
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Target directory for openapi.json and contract_meta.json (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--schema-version",
        type=str,
        default=None,
        help="Override schema_version written to contract_meta.json.",
    )
    parser.add_argument(
        "--include-timestamp",
        action="store_true",
        help="Include UTC generated_at timestamp in contract_meta.json (non-deterministic).",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify committed contracts/ files match the live FastAPI OpenAPI schema without writing.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    contract_hash, openapi_path, meta_path = export_contracts(
        output_dir=args.output_dir,
        schema_version=args.schema_version,
        include_timestamp=args.include_timestamp,
        check_only=args.check,
    )
    mode = "Verified" if args.check else "Exported"
    print(f"{mode} contracts [sha256={contract_hash}]")
    print(f"  - {openapi_path}")
    print(f"  - {meta_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
