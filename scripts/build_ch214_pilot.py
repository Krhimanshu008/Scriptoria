#!/usr/bin/env python3
"""
Builds the structured LOTM Chapter 214 ("Land of Hope") Pilot Test Kit JSON from:
  - Books/LOTM/Faceless - LotM Vol. 2.epub (index_split_005.html, paragraphs 1..70)
  - Others/LOTM/outputs/faceless-volume-2/Faceless Production Plan through Chapter 230.xlsx ('214 shot list')
  - Others/LOTM/outputs/faceless-volume-2/Faceless Reference Images/references.json

Outputs:
  frontend/src/lib/test-kits/lotm_ch214_data.json
"""

import html
import json
import os
import re
import zipfile
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parent.parent
EPUB_PATH = ROOT / "Books" / "LOTM" / "Faceless - LotM Vol. 2.epub"
XLSX_PATH = ROOT / "Others" / "LOTM" / "outputs" / "faceless-volume-2" / "Faceless Production Plan through Chapter 230.xlsx"
REF_DIR = ROOT / "Others" / "LOTM" / "outputs" / "faceless-volume-2" / "Faceless Reference Images"
REFS_JSON = REF_DIR / "references.json"
OUT_JSON = ROOT / "frontend" / "src" / "lib" / "test-kits" / "lotm_ch214_data.json"


def extract_ch214_paragraphs() -> list[dict]:
    with zipfile.ZipFile(EPUB_PATH) as zf:
        raw = zf.read("index_split_005.html").decode("utf-8", errors="ignore")
    blocks = re.findall(r"<(?:p|h[1-6])[^>]*>(.*?)</(?:p|h[1-6])>", raw, flags=re.S | re.I)
    cleaned = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", b))).strip() for b in blocks]
    cleaned = [c for c in cleaned if c]
    if not cleaned or "214" not in cleaned[0]:
        raise RuntimeError(f"Unexpected heading in index_split_005.html: {cleaned[:2]}")
    return [{"index": i, "text": txt} for i, txt in enumerate(cleaned[1:], start=1)]


def parse_para_span(raw_span: str) -> list[int]:
    if not raw_span:
        return []
    nums = set()
    s = str(raw_span).replace("–", "-").replace("—", "-")
    for part in re.split(r"[,;]+", s):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            if a.strip().isdigit() and b.strip().isdigit():
                for k in range(int(a.strip()), int(b.strip()) + 1):
                    nums.add(k)
        elif part.isdigit():
            nums.add(int(part))
    return sorted(nums)


def main():
    paragraphs = extract_ch214_paragraphs()
    para_map = {p["index"]: p["text"] for p in paragraphs}

    with open(REFS_JSON, "r", encoding="utf-8") as f:
        ref_raw = json.load(f)

    ref_dict = {}
    for asset in ref_raw.get("assets", []):
        plate = asset.get("plate", "").replace("\\", "/")
        ref_dict[asset["id"]] = {
            "id": asset["id"],
            "title": asset.get("title", asset["id"]),
            "category": asset.get("category", "General"),
            "plate": plate,
            "refUri": f"ref://ch214/{plate}",
            "sha256": asset.get("sha256", ""),
            "designBrief": asset.get("design_brief", ""),
            "note": asset.get("note", ""),
            "insert": asset.get("insert", ""),
        }
    # Ensure exact typeset WATCH-0639 insert is addressable directly as well
    watch_insert = REF_DIR / "Inserts" / "WATCH-0639.png"
    if watch_insert.exists():
        ref_dict["WATCH-0639"] = {
            "id": "WATCH-0639",
            "title": "Pocket watch dial 6:39 insert",
            "category": "Inserts",
            "plate": "Inserts/WATCH-0639.png",
            "refUri": "ref://ch214/Inserts/WATCH-0639.png",
            "sha256": "",
            "designBrief": "Typeset 12-hour gold watch dial showing 6:39.",
            "note": "Exact time insert for Frame 15.",
            "insert": "Inserts/WATCH-0639.png",
        }

    wb = openpyxl.load_workbook(XLSX_PATH, read_only=True, data_only=True)
    ws = wb["214 shot list"]
    raw_rows = list(ws.iter_rows(values_only=True))[5:]

    beats_ordered = []
    beat_lookup = {}
    shots = []

    for r in raw_rows:
        if not r or not r[0]:
            continue
        frame_num = int(r[0])
        beat_name = str(r[1] or "").strip()
        paras_raw = str(r[2] or "").strip()
        brief = str(r[3] or "").strip()
        ref_str = str(r[4] or "").strip()
        role = str(r[5] or "Coverage").strip()
        is_anchor = role.lower() == "scene anchor"

        if beat_name not in beat_lookup:
            b_idx = len(beats_ordered) + 1
            b_obj = {
                "beatIndex": b_idx,
                "beatName": beat_name,
                "sceneId": f"214.{b_idx:02d}",
                "paragraphNumbers": set(),
                "frameNumbers": [],
                "anchorFrame": None,
                "anchorShotId": None,
                "referenceIds": [],
            }
            beat_lookup[beat_name] = b_idx
            beats_ordered.append(b_obj)
        else:
            b_obj = beats_ordered[beat_lookup[beat_name] - 1]

        p_nums = parse_para_span(paras_raw)
        b_obj["paragraphNumbers"].update(p_nums)
        b_obj["frameNumbers"].append(frame_num)

        shot_id = f"V2-214-{frame_num:03d}"
        if is_anchor and b_obj["anchorFrame"] is None:
            b_obj["anchorFrame"] = frame_num
            b_obj["anchorShotId"] = shot_id

        ref_ids = [x.strip() for x in ref_str.split(",") if x.strip()]
        # For Frame 15 ("Checking the time", 6:39 insert), ensure WATCH-0639 precedes WATCH for exact dial lock
        if frame_num == 15 and "WATCH-0639" in ref_dict and "WATCH-0639" not in ref_ids:
            ref_ids = ["WATCH-0639"] + ref_ids

        for rid in ref_ids:
            if rid not in b_obj["referenceIds"]:
                b_obj["referenceIds"].append(rid)

        ref_bindings = []
        for idx, rid in enumerate(ref_ids[:4], start=1):
            rmeta = ref_dict.get(rid)
            if rmeta:
                ref_bindings.append({
                    "slot": idx,
                    "id": rid,
                    "title": rmeta["title"],
                    "refUri": rmeta["refUri"],
                })

        slot_notes = " ".join(
            f"Image {b['slot']} supplies {b['title']} ({b['id']})."
            for b in ref_bindings[:3]
        )
        para_text = "\n".join(f"[¶{n}] {para_map.get(n, '')}" for n in p_nums if n in para_map)
        style_prefix = (
            "16:9 naturalistic Victorian-industrial period illustration in oil and gouache treatment, "
            "fine precise contours, believable anatomy and tailored cloth, muted Backlund atmosphere. "
        )
        prompt = (
            f"{style_prefix}{brief} "
            f"{slot_notes} "
            "Clean-shaven early-twenties Klein Moretti where present; keep reference sheet labels, grid dividers, and panel borders out of the image. Output one uninterrupted cinematic frame."
        ).strip()

        shots.append({
            "frame": frame_num,
            "shotId": shot_id,
            "beatIndex": b_obj["beatIndex"],
            "beatName": beat_name,
            "sceneId": b_obj["sceneId"],
            "paragraphs": paras_raw,
            "paragraphNumbers": p_nums,
            "paragraphText": para_text,
            "brief": brief,
            "role": role,
            "isAnchor": is_anchor,
            "anchorShotId": b_obj["anchorShotId"],
            "refIds": ref_ids,
            "refBindings": ref_bindings,
            "defaultPrompt": prompt,
        })

    # Finalize beat anchor links on all shots in case beat coverage appeared before anchor row
    anchor_by_beat = {b["beatIndex"]: b["anchorShotId"] for b in beats_ordered}
    for s in shots:
        s["anchorShotId"] = anchor_by_beat.get(s["beatIndex"])

    beats_out = []
    for b in beats_ordered:
        p_sorted = sorted(b["paragraphNumbers"])
        p_range = f"{p_sorted[0]}-{p_sorted[-1]}" if p_sorted else ""
        beat_text = "\n".join(f"[¶{n}] {para_map[n]}" for n in p_sorted if n in para_map)
        beats_out.append({
            "beatIndex": b["beatIndex"],
            "beatName": b["beatName"],
            "sceneId": b["sceneId"],
            "paragraphRange": p_range,
            "paragraphNumbers": p_sorted,
            "beatText": beat_text,
            "frameNumbers": b["frameNumbers"],
            "anchorFrame": b["anchorFrame"],
            "anchorShotId": b["anchorShotId"],
            "referenceIds": b["referenceIds"],
        })

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "kitId": "lotm-ch214",
        "title": "Chapter 214: Land of Hope (Faceless · Vol. 2)",
        "paragraphCount": len(paragraphs),
        "totalShots": len(shots),
        "anchorFrames": [b["anchorFrame"] for b in beats_out if b["anchorFrame"]],
        "pilotFrames": [5, 15, 22, 26, 36, 54, 63, 77, 6, 78],
        "chapterText": "\n\n".join(f"[¶{p['index']}] {p['text']}" for p in paragraphs),
        "paragraphs": paragraphs,
        "beats": beats_out,
        "references": ref_dict,
        "shots": shots,
    }
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(
        f"Wrote {OUT_JSON} -> paragraphs={len(paragraphs)}, beats={len(beats_out)}, "
        f"shots={len(shots)}, anchors={payload['anchorFrames']}"
    )


if __name__ == "__main__":
    main()
