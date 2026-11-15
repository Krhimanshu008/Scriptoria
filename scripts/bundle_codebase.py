"""
Scriptoria Codebase Bundler for Google AI Studio
Bundles tracked source code into a single Markdown file accepted natively by Google AI Studio.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_BUNDLE = BASE_DIR / "docs" / "ai_studio" / "Scriptoria_Source_Bundle.md"

INCLUDE_EXTENSIONS = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".sql", ".prisma", ".toml", ".yml", ".yaml", ".css"
}

IGNORE_DIRS = {
    "node_modules", ".next", ".git", ".venv", "venv", "__pycache__", "dist", "build", 
    ".turbo", "coverage", ".pytest_cache", "r2_lake", "output"
}

IGNORE_FILES = {
    "package-lock.json", "pnpm-lock.yaml", "yarn.lock", ".env", ".env.local"
}

def bundle_codebase():
    OUTPUT_BUNDLE.parent.mkdir(parents=True, exist_ok=True)
    file_count = 0
    total_lines = 0

    with open(OUTPUT_BUNDLE, "w", encoding="utf-8") as out:
        out.write("# Scriptoria Repository Codebase Bundle\n")
        out.write(f"# Generated for Google AI Studio / Gemini 4 Hydrogen\n\n")

        for root, dirs, files in os.walk(BASE_DIR):
            # Prune ignored directories
            dirs[:] = [d for d in dirs if d not in IGNORE_DIRS and not d.startswith(".")]

            for file in sorted(files):
                if file in IGNORE_FILES:
                    continue
                ext = Path(file).suffix.lower()
                if ext not in INCLUDE_EXTENSIONS:
                    continue

                full_path = Path(root) / file
                rel_path = full_path.relative_to(BASE_DIR).as_posix()

                # Skip large generated bundles or the output bundle itself
                if rel_path.startswith("docs/ai_studio/Scriptoria_Source_Bundle"):
                    continue

                try:
                    with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                        content = f.read()
                except Exception:
                    continue

                lines = content.count("\n")
                total_lines += lines
                file_count += 1

                lang = ext.lstrip(".")
                if lang in ("tsx", "ts", "jsx", "js"):
                    lang = "typescript"
                elif lang == "py":
                    lang = "python"
                elif lang == "md":
                    lang = "markdown"

                out.write(f"\n\n---\n## File: `{rel_path}`\n\n```{lang}\n")
                out.write(content.rstrip())
                out.write("\n```\n")

    size_kb = OUTPUT_BUNDLE.stat().st_size / 1024
    print(f"Bundled {file_count} files ({total_lines} lines, {size_kb:.1f} KB) into {OUTPUT_BUNDLE}")

if __name__ == "__main__":
    bundle_codebase()
