
Model 10:53 AM
ThinkingThoughts
Expand to view model thoughts

Your core instinct—decoupling heavy extraction from downstream RAG/multi-agent work by saving a standardized "checkpoint"—is exactly the right way to build this. Most AI projects fail because they tightly couple ingestion with agent logic, forcing them to re-process entire books every time they tweak a prompt.
However, as you move from idea to implementation, there are four major architectural traps in your current plan that will stall your progress if you don't fix them early. Below is a critique of those traps, followed by an improved architecture, a concrete data protocol for a Book Visualiser, and a step-by-step build plan.
1. Four Traps to Fix Before Writing Code
Trap 1: Using an LLM to extract raw text from PDFs/EPUBs
Why it breaks: Feeding raw PDF pages or messy HTML into Qwen to "extract" text burns your GPU quota, hits context limits, and introduces silent hallucinations (LLMs occasionally skip sentences or paraphrase dialogue).
The Fix: Split extraction into Deterministic Parsing (code extracts clean text/chapters) and Semantic Extraction (Qwen reads clean chapters and outputs structured visual/narrative metadata).
Trap 2: Storing all preprocessed book data inside Cloudflare D1
Why it breaks: D1 has a 2 MB maximum row/string limit[1], a 500 MB database cap on the free tier (10 GB on paid)[1], and a 50 MB maximum query result limit[1][2]. Storing full book text, verbose scene JSONs, and chunk payloads in D1 will hit row/query limits quickly. Furthermore, Kaggle VMs can't talk to D1 over native SQLite sockets—only via HTTP APIs.
The Fix: Use a Metadata + Artifact split. Store heavy JSON checkpoints and chapter texts in R2, and use D1 strictly as your relational index, state tracker, and entity graph (pointing to R2 object keys).
Trap 3: Treating Kaggle VMs like persistent servers
Why it breaks: Kaggle provides T4 x2 GPUs (two 16 GB VRAM cards, 30 hrs/week quota, 12-hour max session)[3][4]. If a job disconnects mid-book without granular checkpoints, you lose compute. Also, T4s are Turing architecture (no native bfloat16), meaning running unquantized models or wrong dtypes will crawl or OOM.
The Fix: Run inference using vLLM in float16 with 4-bit AWQ/GPTQ quantization split across both T4s, and checkpoint after every single chapter.
Trap 4: Generic text chunking for a "Visualiser"
Why it breaks: Standard RAG (splitting every 500 tokens) cuts scenes in half and loses track of who is in the room, what they are wearing, and what the lighting is. For a Book Visualiser, consistency is everything.
The Fix: Your extraction protocol must divide books into Narrative Scenes / Visual Beats and maintain a Stateful Entity Registry (tracking characters, locations, and props across chapters).
2. The Improved Architecture
Text
[Raw EPUB / PDF] ──► Cloudflare R2 (/raw/{book_id}.epub)
                          │
                          ▼
             (Stage 1: Deterministic Parser - CPU)
             ebooklib / PyMuPDF / Docling
             Outputs clean Chapter Markdown + Image Assets
                          │
                          ▼
             Cloudflare R2 (/parsed/{book_id}/ch_{n}.md)
                          │
                          ▼
             (Stage 2: Kaggle T4x2 GPU Worker)
             vLLM + Qwen (4-bit AWQ, Guided JSON Schema)
             Sliding Context: [Prev Scene State] + [Current Chapter]
                          │
                          ▼
        (Stage 3: Cloudflare Worker Ingestion API)
        Validates JSON against Protocol Schema ──┬──► R2 (/checkpoints/{book_id}/...) [Heavy JSON/Text]
                                                 └──► D1 (Metadata, Scene Index, Entities, Status)
                          │
                          ▼
        (Stage 4: Future Downstream - Decoupled!)
        ├──► Vector DB (Cloudflare Vectorize / Qdrant) for RAG
        └──► Multi-Agent Pipeline (Art Director, Continuity, Prompt Gen)
3. Designing Your Protocol: The "Book Canonical Standard"
Since you want to set a strict standard at this checkpoint, define a versioned JSON Schema (using Pydantic in Python and Zod in TypeScript). Every book processed by your pipeline must conform to this structure before it is allowed into D1/R2.
Divide the protocol into 3 strict layers:
Layer A: Verbatim & Structural Anchor (No LLM modification)
Never let the LLM rewrite the book's prose. Keep exact pointers so your future agents can always quote the source.
JSON
{
  "schema_version": "1.0.0",
  "book_id": "uuid",
  "chapter_index": 3,
  "chapter_title": "The Glass Forge",
  "raw_text_r2_key": "parsed/uuid/ch_03.md"
}
Layer B: Visual Scene Breakdown (LLM Extracted)
Instead of arbitrary token chunks, instruct Qwen to segment each chapter into Scenes (changes in location, time, or dramatic beat):
JSON
{
  "scene_id": "ch03_sc02",
  "start_char_offset": 1420,
  "end_char_offset": 4890,
  "verbatim_excerpt_summary": "Mira enters the abandoned forge at dusk and discovers the cracked lens.",
  "setting": {
    "location_id": "loc_glass_forge",
    "time_of_day": "dusk",
    "weather_atmosphere": "ash-filled air, humid",
    "lighting": "dim orange embers from a dying furnace, long shadows",
    "color_palette": ["#2B1B17", "#E65C00", "#4A5568"]
  },
  "characters_present": [
    {
      "entity_id": "char_mira",
      "action": "kneeling near the anvil, holding a brass lantern",
      "emotional_state": "guarded, tense",
      "visual_changes": "soot smudge on left cheek, torn cloak hem"
    }
  ],
  "key_visual_beats": [
    {
      "beat_order": 1,
      "shot_suggestion": "Wide establishing shot of cavernous forge with glowing floor cracks",
      "focal_elements": ["shattered stained-glass skylight", "central stone anvil"],
      "quote_anchor": "She stepped over the threshold..."
    }
  ]
}
Layer C: Entity Continuity Registry (Cross-Chapter Memory)
For a visualiser, if a character gets a scar in Chapter 2 or changes into a red coat in Chapter 4, the agents in Chapter 5 need to know.
JSON
{
  "entity_id": "char_mira",
  "canonical_name": "Mira Vance",
  "aliases": ["the apprentice", "she (when sole female in scene)"],
  "type": "CHARACTER",
  "static_traits": "mid-20s, sharp jaw, dark braided hair, amber eyes",
  "chapter_state_delta": {
    "clothing": "charred leather apron over grey wool tunic",
    "accessories": ["cracked brass lantern"],
    "physical_condition": "bandaged right forearm"
  }
}
4. How to Run Qwen Efficiently on Kaggle (T4 x2)
Model & Engine Choice:
Kaggle's T4 x2 gives you 2 × 16 GB VRAM (32 GB total across two cards)[4].
Engine: Use vLLM (not raw HuggingFace transformers). Run with tensor parallelism across both cards and explicit float16 precision:
Bash
--tensor-parallel-size 2 --dtype float16 --gpu-memory-utilization 0.90
Model: A Qwen 14B–32B 4-bit AWQ model or a Mixture-of-Experts variant like Qwen3-30B-A3B (only ~3.3B active parameters, very fast on T4s)[5] fits comfortably across dual 16 GB T4s while leaving enough VRAM for a 16K–32K KV-cache context window.
Enforce Your Protocol at Token Generation Time (Guided Decoding):
Never rely on "Please output valid JSON" in the prompt alone—LLMs still break brackets on long outputs.
Use vLLM's Guided Decoding / Structured Outputs (response_format with a Pydantic JSON Schema). This masks invalid tokens at the logits level so Qwen is mathematically guaranteed to return valid JSON matching your protocol.
Solve the "Long Book Continuity" Problem (Rolling State Pattern):
Do not feed the whole book at once, and do not process chapters in isolation.
Process sequentially:
Prompt = [Global Entity Glossary so far] + [Last 200 words of previous chapter] + [Current Chapter/Chunk].
After Qwen extracts Chapter 
N
N
, merge any new characters/traits into your Entity Glossary before processing Chapter 
N
+
1
N+1
.
5. Cloudflare Storage Design (D1 + R2)
Instead of connecting Kaggle directly to D1 credentials, deploy a tiny Cloudflare Worker API (protected with an API Secret Header). Your Kaggle script simply POSTs the validated Pydantic JSON to this Worker. The Worker stores heavy text/JSON in R2 and updates D1 atomically.
Suggested D1 Schema (Lightweight, Fast, Queryable):
SQL
Look how clean this makes your Phase 2 (RAG + Multi-Agent) work later:
Need all scenes where Mira and the Brass Lantern appear together? Instant SQL query in D1.
Need the full prompt context to generate an illustration for Chapter 3, Scene 2? D1 gives you the entity visual baseline + the R2 key for the exact prose.
6. Recommended Step-by-Step Build Approach
Do not build the RAG or multi-agent visualizer yet. Execute in these 4 tight milestones:
Milestone 1: Lock the Protocol & Deterministic Parser (Local / CPU)
Pick 2 test books (1 clean EPUB, 1 tricky PDF).
Build a Python script using ebooklib + BeautifulSoup (for EPUBs) and PyMuPDF or Docling (for PDFs) to cleanly split them into ch_01.md, ch_02.md, etc.
Write your Pydantic schema (BookCheckpointProtocol) and test serializing/validating sample JSONs.
Milestone 2: Build the Cloudflare Checkpoint API (D1 + R2)
Create the D1 tables above and an R2 bucket.
Write a lightweight Cloudflare Worker with 3 endpoints:
GET /books/{id}/resume-state (returns last_completed_chapter and current entities glossary).
POST /books/{id}/chapters/{idx}/checkpoint (saves raw/JSON to R2 and upserts chapters, scenes, entities in D1).
POST /books/{id}/complete
Milestone 3: Build the Kaggle Qwen Worker Notebook
Load Qwen (4-bit AWQ) via vLLM on T4 x2 (--dtype float16 --tensor-parallel-size 2).
Write the extraction loop:
Fetch book status from your Cloudflare Worker (resume-state).
Pull the next unprocessed chapter from R2.
Run Qwen with vLLM Guided JSON using your Pydantic schema + rolling Entity Glossary.
POST the result back to your Worker API immediately.
Test killing the Kaggle session mid-book and restarting it to verify it resumes cleanly from the exact next chapter.
Milestone 4: Validate Data Quality Before RAG
Manually inspect the D1 tables and R2 JSONs for those 2 test books.
Check: Did Qwen duplicate characters under different names (e.g., "John" vs "Mr. Doe")? Did it miss subtle visual descriptions?
Fix those prompt/schema edge cases now while you only have 2 books, before processing a library or building your RAG/agent layers.
(Once Milestone 4 passes, your D1 + R2 checkpoint is rock-solid, and you can immediately plug in Cloudflare Vectorize/Qdrant for embeddings and spin up your Art Director / Continuity / Image-Gen agents on top of clean, structured data.)
Sources
cloudflare.com
cloudflare.com
fastero.com
substack.com
openrouter.ai
Google Search Suggestions
Display of Search Suggestions is required when using Grounding with Google Search. Learn more
Model 11:13 AM
ThinkingThoughts
Expand to view model thoughts

The Short Answer: When Should You Build This?
Build it in two distinct stages: Extract Signals during preprocessing, and build the Knowledge Graph right AFTER preprocessing finishes (at your checkpoint).
Do not try to calculate importance scores, finalize a world map, or merge character identities while Qwen is reading Chapter 1. Here is why:
Incomplete Information: A random innkeeper in Chapter 1 might turn out to be the main villain in Chapter 18. A room called "the cellar" in Chapter 2 might only be revealed as "underneath Redkeep Castle" in Chapter 9. An LLM cannot score global importance or stitch a full world tree mid-book.
Alias Confusion: Authors introduce characters as "the hooded stranger" in Chapter 1 and reveal their name ("Lord Vane") in Chapter 7. You can only resolve that cleanly once the full book's observations are collected.
The Winning Pattern (Map-Reduce / ETL):
Stage 1 (During Kaggle Qwen Extraction — "Raw Event Logging"): Extract local, scene-anchored observations (who appeared, what they wore here, what item changed hands here, any spatial clue mentioned here like "kitchen -> Vance Manor"). Save this to your R2/D1 checkpoint.
Stage 2 (Post-Preprocessing — "Graph Compilation Pass"): Once all chapters of a book are in your checkpoint, run a dedicated Book Compiler Job (fast Python/SQL math + a few cheap targeted LLM calls for ambiguity resolution) to merge aliases, calculate importance scores, stitch the World Tree, and build the final Timeline Graph.
Deep Dive: Improving Each of Your 4 Systems (+ What's Missing)
1. Character System & Importance Scoring
My thought on scoring: Having an importance score is essential for a Book Visualiser because it controls your image generation budget and consistency strategy. You shouldn't waste time/money generating a 4-angle character reference sheet for "Tavern Guard #2" who speaks one line.
Don't ask the LLM to guess "rate importance 1–10." Instead, compute an objective Composite Score (0.0 to 1.0) in Stage 2 using data from your D1 checkpoint:
Scene Presence (35%): % of total scenes where the character is physically present.
Active Agency (25%): Dialogue lines / active actions vs. just being mentioned in passing.
Graph Centrality (25%): PageRank/degree score in the character co-occurrence network (characters who frequently interact with protagonists score higher).
Visual Detail Density (15%): How many distinct physical/visual descriptors the author wrote about them (authors rarely describe throwaway extras in detail).
Turn that score into 3 actionable Visual Tiers:
Tier 1 — Core Cast (Score ≥ 0.70, usually 3–8 characters): Generate full multi-angle Reference Sheets (front/side/expression sheet). Track every injury, age change, and outfit change strictly across the timeline.
Tier 2 — Supporting Cast (0.30 – 0.69): Generate 1 canonical portrait anchor + basic outfit tracking.
Tier 3 — Extras (< 0.30): No saved reference images; generate dynamically from scene text when needed.
2. Location System ("World Map" + Multi-Image Tagging)
Books rarely give GPS coordinates, so avoid rigid Google Maps lat/lng grids. Instead, use a Flexible Hierarchical Tree + Spatial Travel Graph.
The Tree (World -> Country -> City -> Building -> Room):
Crucial practical rule: Make intermediate levels skippable/nullable! Many books jump straight from Country: The North → Region: Whispering Woods → Structure: Witch's Hut (there is no City or Town).
Store every location in a single self-referencing locations table (parent_location_id + location_level + materialized_path like /loc_world/loc_north/loc_woods/loc_hut). SQLite/D1 handles trees effortlessly using WITH RECURSIVE queries or LIKE '/loc_world/loc_north/%'.
The "Map" Connections (location_edges):
Add a lightweight edge table for relative geography when the book mentions travel or proximity:
(from_location_id, to_location_id, relation: 'NORTH_OF' | 'CONNECTED_BY_ROAD' | 'ADJACENT_TO', travel_time: '2 days ride').
This gives you a "Google Maps-lite" topological map without needing fake coordinates.
Multiple Tagged Images per Location:
Separate visual assets into a visual_assets table linked to location_id. Tag each image with (shot_type, time_of_day, weather, timeline_state).
Example for "Vance Manor": establishing_exterior | day | clear, courtyard | night | rain, main_hall | dusk | post_fire_ch14.
Location Importance Score: Compute (scenes_hosted * 0.6) + (key_plot_beats * 0.4). Only pre-generate multi-angle set-design sheets for high-scoring recurring locations!
3. Clothing System (Decouple from Character Identity!)
The #1 mistake in AI story visualisers: Baking clothing into the character's permanent description (e.g., "Mira has braided dark hair and wears a red cloak"). Later, when Mira puts on royal armor in Chapter 12, the image generator hallucinates a red cloak over her armor.
Practical Design:
Split Character Anatomy from Wardrobe:
characters.base_anatomy: Face, eyes, hair, height, skin tone, permanent scars/tattoos.
outfits table: Reusable clothing ensembles (outfit_id, name, visual_description, era_style).
Use "Carry-Forward State Inheritance" on the Timeline:
Authors don't repeat what characters wear in every single scene.
Your Stage 2 Compiler walks chronologically through scenes: "If Mira wore Black Leather Tunic in Scene 4, carry that forward into Scenes 5, 6, 7 until Scene 8 explicitly mentions a wardrobe change, time skip, or sleep."
Track Condition Deltas per scene on top of the outfit: condition: "clean" -> "mud-splattered" -> "torn right sleeve".
4. Items / Accessories / Tools / Artifacts System
Don't log every fork and wooden chair into your Knowledge Graph—it will flood your database with noise. Split items into 2 classes:
Tracked Entities (Entity_Item): Named artifacts, weapons, signature accessories, key plot tools (e.g., The Cracked Brass Lantern, King's Signet Ring).
Tracked in the graph with their own visual_description, magical_or_physical_effects (e.g., "emits faint blue glow"), and a Custody Timeline (held_by_character_id OR located_at_location_id, plus state: intact/broken/hidden).
Ephemeral Scene Props: Generic objects used once (a pewter mug, a parchment scroll). Keep these purely inside the Scene JSON in R2, not in the global Knowledge Graph.
5. What Else Is Missing? (3 Crucial Pillars for a Book Visualiser)
If you want your downstream multi-agent pipeline to produce truly coherent visuals, add these three layers to your Knowledge Graph:
Dual Timeline (narrative_order vs. chronological_order):
Books frequently use flashbacks, dreams, and parallel POV chapters (Chapter 5 happens before Chapter 1, or at the exact same hour as Chapter 4 in another city).
Give every scene both a narrative_seq (reading order) and a story_time_tick (chronological order + time_type: 'PRESENT' | 'FLASHBACK' | 'DREAM'). Your clothing/injury carry-forward logic MUST follow story_time_tick, otherwise a flashback will accidentally reset a character's scar or outfit!
Relationships & Factions (relationships + factions):
Factions/Cultures: Store uniforms, emblems, heraldry, and architectural motifs once at the faction level (e.g., "Iron Guild: dark bronze armor, gear-shaped sigils"), so every member automatically inherits those visual cues.
Character Dynamics Over Time: (Mira, Vane, 'DISTRUSTFUL_ALLIES', start_tick=10, end_tick=45) -> ('ENEMIES', start_tick=46). An Art Director agent uses this to decide camera framing (wide cold gap vs. warm close-up).
Global "Visual Style Bible" (World Rules):
A top-level book document capturing genre aesthetic, magic/tech visual rules, and non-human anatomy rules (e.g., "In this book, magic looks like inked geometric smoke, NOT glowing fireballs"). Every downstream image prompt agent reads this first.
Practical D1 Schema Blueprint (Connecting Everything to the Timeline)
You do not need Neo4j or a separate graph database yet. SQLite / Cloudflare D1 handles this relational-temporal graph cleanly:
SQL
How to Approach Building This Step-by-Step
Step 1 (During Kaggle Extraction — Keep it Light):
Update your Pydantic extraction schema so Qwen outputs raw observations per scene:
characters_present (with any new physical traits, clothing mentions, or injuries)
location_clue (e.g., "Sitting room inside Vance Manor, which is in Oakhaven")
items_interacted (only notable/named items)
time_clue ("3 days later" or "Flashback to 10 years ago").
Step 2 (Checkpoint Complete): Save all raw chapter/scene outputs to R2 + initial D1 rows.
Step 3 (Build the Stage 2 "Book Compiler" Script — Local Python or Cloud Worker):
Run this once per book after extraction finishes:
Pass 3a (Alias & Entity Resolution): Group similar character/location names (e.g., fuzzy matching + 1 Qwen pass over the master entity list to confirm "The Stranger" == "Lord Vane").
Pass 3b (Timeline Ordering): Assign story_time_tick (detecting flashback blocks).
Pass 3c (Stitch Location Tree): Build parent_location_id links from the spatial clues collected across all chapters.
Pass 3d (Carry-Forward State Machine): Populate character_scene_states and item_custody_timeline chronologically so no character randomly loses their outfit between chapters.
Pass 3e (Compute Importance Scores): Run the SQL/Python scoring math and assign visual_tier = 1, 2, 3.
Step 4 (Ready for Production / Multi-Agent & RAG):
Now, before generating a single final scene illustration, your Art Director Agent can query D1 in milliseconds for: Tier 1 Character reference images + Current carried-forward Outfit + Location interior image (night) + World Style Bible, and feed a rock-solid context packet to your image model.
Model 11:52 AM
ThinkingThoughts
Expand to view model thoughts

You do not need four separate databases (like Neo4j + Pinecone + Postgres + Redis) to run Relational, Hybrid RAG, Graph RAG, and Agentic RAG. With your Turso and Supabase free tiers (plus Cloudflare R2), you can run all four paradigms cleanly in SQL—if you assign each database the exact role it is built for and avoid the free-tier traps.
1. Know Your Free-Tier Constraints First
Before designing schemas, look at the hard ceilings of what you currently have:
Platform	Engine	Free Tier Limits	Sweet Spot	The Trap to Avoid
Turso	libSQL (SQLite)	5 GB total storage, 100 databases, 500M reads/mo, 10M writes/mo, native DiskANN Vector Search + FTS[1][2][3][4][5]	Per-book / Per-series isolated Knowledge DBs, vectors, Graph RAG, Agent working memory[6]	Don't exceed 100 DBs on free tier (group standalone books or series if >100)[4]
Supabase	PostgreSQL	500 MB DB/project, 2 active projects, ~500 MB shared RAM, pauses after 7 days idle[7][8]	User Auth, App Control Plane, Master Catalog, Job Queue, complex SQL/RLS[7][9][10]	Never dump thousands of heavy float32 vectors here—500 MB storage & RAM for HNSW fills up fast[8][11]
Cloudflare R2	Object Storage	10 GB/month free, zero egress	Raw EPUB/PDFs, Full Chapter Prose, Heavy Scene JSONs, Generated Images	Don't store raw book prose or base64 images inside SQL rows
Architectural Cleanup: Since you already have Turso, you can drop Cloudflare D1 from your plan. Both are edge SQLite, but Turso gives you 10× more free storage (5 GB vs 500 MB), native DiskANN vector indexing, and direct Python/local SQLite syncing from your Kaggle VM[1][2][3][6].
2. The Recommended Hybrid Architecture: "Role-Separated 3-Tier Stack"
Split your system cleanly so Supabase handles your Platform/App, Turso handles your Book Knowledge Graphs & RAG, and R2 handles Heavy Blobs:
Text
┌───────────────────────────────────────┐
                       │     CLOUDFLARE R2 (Blob Lake)         │
                       │  • Raw EPUB/PDFs & Chapter Markdown   │
                       │  • Full Scene JSONs (Verbal Anchor)   │
                       │  • Character/Location/Scene Images    │
                       └──────────────────┬────────────────────┘
                                          │ (stores R2 keys)
         ┌────────────────────────────────┴────────────────────────────────┐
         ▼                                                                 ▼
┌──────────────────────────────────────────┐   ┌──────────────────────────────────────────┐
│    SUPABASE (Postgres — Control Plane)   │   │  TURSO (libSQL — Book Knowledge Engine)  │
│    "Lightweight, Multi-User App State"   │   │  "1 DB per Book/Series — Heavy AI Data"  │
│                                          │   │                                          │
│ • Users, Auth, Projects, Permissions     │   │ • Relational Timeline (Scenes, Outfits)  │
│ • Master Book Registry & Turso DB URLs   │   │ • Hybrid RAG (DiskANN Vectors + FTS5/BM25│
│ • Kaggle Ingestion Checkpoints & Jobs    │   │ • Graph RAG (Nodes + Temporal Edges)     │
│ • Visual Asset Index (pointing to R2)    │   │ • Agentic RAG Scratchpad / Storyboards   │
└──────────────────────────────────────────┘   └──────────────────────────────────────────┘
Why "1 Book (or Series) = 1 Turso Database" is a Superpower Here:
Zero Vector Noise: Searching Book A never accidentally retrieves characters or lore from Book B (and you can handle trilogies by putting Books 1–3 into one series_{id}.db)[6].
Protects Supabase's 500 MB Limit: All heavy chunks, embeddings, and graph edges live inside Turso's 5 GB quota[3][12], keeping Supabase tiny (< 50 MB) and fast.
Kaggle-Friendly Workflow: Your Kaggle Stage-2 Compiler script can build a local book_42.db SQLite file at full speed, generate embeddings + vector indexes locally, and push/sync it directly to Turso!
3. How to Design the Database for All 4 Paradigms (Inside Turso / SQL)
You don't need separate engines for Relational, Hybrid RAG, Graph RAG, and Agentic RAG. Here is the exact schema pattern inside each book's database:
Paradigm 1: Relational Layer (The Timeline & State Spine)
Stores structured facts with strict foreign keys (characters, locations, outfits, tracked_items, timeline_scenes, character_scene_states, item_custody_timeline from the previous blueprint).
Rule: Keep long prose out of hot relational tables—store only concise summaries + r2_key pointers[13].
Paradigm 2: Hybrid RAG Layer (Dense Vectors + Keyword BM25 + RRF)
Pure vector search fails on fantasy names and exact props (e.g., searching "Vane's obsidian dagger" might return generic "dark blade" passages). Hybrid RAG fixes this by combining Semantic Search + Exact Keyword Search + Metadata Filtering.
SQL
How Hybrid Retrieval runs: Your retrieval service executes Vector Top-20 + FTS5 Top-20 (both filtered by narrative_seq <= target_seq if doing sequential visual continuity) and fuses them using Reciprocal Rank Fusion (RRF):
RRF Score
=
1
60
+
rank
vector
+
1
60
+
rank
fts
RRF Score= 
60+rank 
vector
​
 
1
​
 + 
60+rank 
fts
​
 
1
​
 
Storage Math Tip: On Kaggle, run an open-weight 768-dim or 1024-dim embedding model (like BAAI/bge-m3 or Qwen3-Embedding-0.6B) stored as 16-bit (F16_BLOB in Turso or halfvec in Postgres)[14]. A 400-page novel (~1,500 chunks) takes only ~2.5 MB for vectors + index—meaning Turso's 5 GB free tier easily holds hundreds of full books!
Paradigm 3: Graph RAG Layer (Native SQL Temporal Graph — No Neo4j Needed)
A novel typically has 500–5,000 entities and 5,000–30,000 edges. SQLite/Postgres traverses graphs of this size in < 5 milliseconds using Recursive CTEs (WITH RECURSIVE).
SQL
-- 1. Graph Nodes (Entities + High-Level Story Arc / Community Summaries!)
CREATE TABLE kg_nodes (
  id TEXT PRIMARY KEY,
  node_type TEXT NOT NULL,           -- 'CHARACTER', 'LOCATION', 'ITEM', 'FACTION', 'COMMUNITY_ARC'
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  importance_score REAL DEFAULT 0.0,
  summary_emb F16_BLOB(768)          -- Lets you vector-search graph nodes directly!
);

CREATE INDEX idx_kg_nodes_vec ON kg_nodes (
  libsql_vector_idx(summary_emb, 'metric=cosine')
);

-- 2. Temporal Directed Edges (Interconnected with Timeline!)
CREATE TABLE kg_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,       -- 'LOCATED_IN', 'OWNS', 'ALLIED_WITH', 'ENEMY_OF', 'WEARS'
  weight REAL DEFAULT 1.0,
  valid_from_tick INTEGER NOT NULL,  -- When relationship starts on timeline
  valid_to_tick INTEGER,             -- NULL = still active
  evidence_scene_id TEXT NOT NULL
);

CREATE INDEX idx_edges_src ON kg_edges(source_id, valid_from_tick);
CREATE INDEX idx_edges_tgt ON kg_edges(target_id, valid_from_tick);
How Graph RAG executes (2-Hop Temporal Traversal):
When an agent asks "What factions or dangerous artifacts are connected to Vance Manor around Tick 40?":
SQL
WITH RECURSIVE graph_hop AS (
  -- Seed: Start at Vance Manor (hop 0)
  SELECT id AS node_id, 0 AS depth, CAST(id AS TEXT) AS path
  FROM kg_nodes WHERE id = 'loc_vance_manor'
  UNION ALL
  -- Expand 1-2 hops along edges active at story_time_tick = 40
  SELECT e.target_id, g.depth + 1, g.path || ' -> ' || e.target_id
  FROM graph_hop g
  JOIN kg_edges e ON g.node_id = e.source_id
  WHERE g.depth < 2
    AND e.valid_from_tick <= 40
    AND (e.valid_to_tick IS NULL OR e.valid_to_tick >= 40)
)
SELECT DISTINCT n.name, n.node_type, n.summary, g.path
FROM graph_hop g
JOIN kg_nodes n ON g.node_id = n.id;
Notice how COMMUNITY_ARC nodes give you Microsoft-style Global Graph RAG ("summarize Act 1 themes across the Northern Kingdom") alongside Local 2-hop Graph RAG!
Paradigm 4: Agentic RAG Layer (Tool Router + Working Memory)
Agentic RAG isn't a separate database—it is an Agent Execution & Scratchpad Layer sitting on top of the 3 schemas above:
SQL
Your multi-agent system accesses the DB through 4 strictly typed Python/TS tools:
query_timeline_state(character_ids, tick) → Hits Relational Layer (exact outfit, injuries, held items).
hybrid_search_prose(query, max_tick) → Hits Hybrid RAG Layer (exact quotes + semantic atmosphere).
traverse_knowledge_graph(entity_id, hops, tick) → Hits Graph RAG Layer (faction politics, location hierarchy, hidden connections).
fetch_r2_verbatim(r2_key) → Hits R2 (pulls raw source prose when exact visual details are ambiguous).
4. Practical Implementation Roadmap (Don't Over-Build Day 1)
If you try to wire Supabase + Turso + R2 + Kaggle all in Week 1, integration bugs will slow you down. Build in this order:
Phase 1 (Right Now — Ingestion & Compiler):
Use Cloudflare R2 + Turso (or even local SQLite synced to Turso) for your book checkpoints.
Keep Supabase minimal at first: just books_catalog and processing_jobs (plus ping it once every few days via a cron/Worker so the free project doesn't auto-pause after 7 days idle[12]).
Phase 2 (Populate Hybrid + Graph Tables during Stage-2 Compilation):
After Qwen finishes extracting all chapters of a test book into R2, run your Stage-2 Python Compiler (on Kaggle or locally) to:
Resolve aliases & build kg_nodes / kg_edges + locations tree.
Compute character & location importance scores.
Chunk scenes (by Scene/Visual Beat, not arbitrary 500-token splits!), embed them with a 768-dim model in float16, and insert into rag_chunks + rag_chunks_fts.
Push the finalized book database to Turso.
Phase 3 (Wire the Agentic Retrieval API):
Expose the 4 typed retrieval tools (query_timeline_state, hybrid_search_prose, traverse_knowledge_graph, fetch_r2_verbatim) behind a single Python FastAPI or TypeScript service.
Build your Art Director + Continuity Critic agents against those 4 tools and log their iterations into agent_workspace.
Phase 4 (Frontend & User Auth):
Turn on Supabase Auth + RLS and connect your web UI to query the Supabase catalog (which points to the right Turso DB + R2 image assets for each book).
Sources
turso.tech
turso.tech
sadiqalam.com
devtoolreviews.com
turso.tech
turso.tech
aiagencyplus.com
uibakery.io
makerkit.dev
stackcook.dev
supabase.com
supabase.com
dev.to
supabase.com
Google Search Suggestions
Display of Search Suggestions is required when using Grounding with Google Search. Learn more
Model 12:15 PM
ThinkingThoughts
Expand to view model thoughts

This is the smartest way to build an AI pipeline: build in gates, freeze each stage, and try to break it with ugly inputs before moving forward.
Below is a 5-Checkpoint Engineering Playbook for your initial stage (from raw files in R2 up to a validated, queryable Hybrid + Graph RAG checkpoint in Turso/Supabase). At every checkpoint, you stop, run the specific Edge-Case Tests, and only proceed once every check passes.
Before Checkpoint 1: Build Your "Torture Test Corpus" (Day 1)
Do not test on one clean novel. Upload 4 small test files (3–6 chapters each) to Cloudflare R2 under /raw/test_corpus/ right now so every checkpoint is battle-tested against real-world chaos:
test_clean.epub: Standard fiction EPUB with italics, dialogue, and * * * scene breaks.
test_ugly.pdf: A multi-column or tricky PDF with running headers/footers ("Title | Page 14"), hyphenated line-wraps (moon-\nlight), and ligatures (ﬁ, ﬂ).
test_narrative_hell.epub: A curated excerpt containing a flashback chapter, two simultaneous POVs, a character with a secret alias revealed later, and a wardrobe change + injury mid-chapter.
test_giant_chapter.epub: One massive chapter (~20,000+ tokens) plus a 2-line epigraph/poem chapter.
Checkpoint 0: Contracts, Keys & Empty Plumbing
Goal: Lock your data contracts and prove Kaggle, R2, Supabase, and Turso can talk to each other before writing extraction logic.
What to Build:
R2 Folder Standard:
/raw/{book_id}/source.(epub|pdf)
/parsed/{book_id}/manifest.json & /parsed/{book_id}/ch_{001}.md
/extracted/{book_id}/ch_{001}_obs.json (Stage 1 Qwen raw observations)
/compiled/{book_id}/book.db (Backup snapshot of the final SQLite DB)
Supabase Control Plane Tables: books_catalog (book metadata, turso_db_url, status), ingestion_jobs (book_id, last_completed_chapter, glossary_r2_key).
Pydantic Schema (schemas.py v1.0.0): Strict data models for ChapterObservation, SceneObservation, EntityMention, LocationClue, TimeClue.
🛑 STOP & TEST (Edge Cases):
EC-0.1 (Contract Rejection): Feed a deliberately broken JSON (missing scene_id, bad data type) into schemas.py and confirm Pydantic rejects it loudly.
EC-0.2 (Cross-Cloud Smoke Test): From a Kaggle CPU notebook, upload a 1 KB dummy file to R2, write a row to Supabase, and create + write + query a dummy database in Turso.
EC-0.3 (Supabase Idle Guard): Set up a tiny GitHub Action or Cloudflare Cron Worker to SELECT 1 on Supabase every 3 days so your free project never auto-pauses.
Checkpoint 1: Deterministic Parsing Engine (Zero LLM)
Goal: Convert raw EPUBs/PDFs into clean, offset-indexed Chapter Markdown files with normalized scene breaks—zero GPU cost.
What to Build:
Python parser (ebooklib + BeautifulSoup for EPUB; PyMuPDF / Docling for PDF).
Text normalizer that strips headers/footers, fixes PDF line-wrap hyphens, extracts embedded images (if any) to R2, and converts all scene breaks into a unified <SCENE_BREAK /> token.
Deterministic Safe-Chunker: If a chapter exceeds 6,000 tokens, split it only at <SCENE_BREAK /> (or paragraph boundaries as fallback), producing ch_001_part_01.md, ch_001_part_02.md.
🛑 STOP & TEST (Edge Cases against your 4 test files):
EC-1.1 (PDF Noise Pollution): Inspect test_ugly.pdf output. Verify running headers, page numbers, and footnotes are NOT sitting inside the middle of sentences.
EC-1.2 (Hyphen & Unicode Preservation): Verify moon-\nlight becomes moonlight, ﬁre becomes fire, while genuine hyphens like well-dressed stay intact.
EC-1.3 (Frontmatter Trap): Verify Copyright, Dedication, and Table of Contents in test_clean.epub are tagged as type: FRONTMATTER (skipped by extraction) rather than mislabeled Chapter 1.
EC-1.4 (Silent CSS Scene Breaks): Many EPUBs use <p class="space-break"></p> or <hr/> instead of * * *. Verify your parser detects these and injects <SCENE_BREAK />.
EC-1.5 (Giant Chapter Split): Run test_giant_chapter.epub and verify the 20K-token chapter splits cleanly at scene boundaries with zero mid-sentence cuts, and that the 2-line poem chapter doesn't throw an empty-text exception.
Checkpoint 2: Kaggle T4 x2 Qwen Extraction & Resume Loop
Goal: Feed parsed chapters into Qwen on Kaggle with vLLM Guided JSON Decoding, maintain a rolling Entity Glossary, and save Stage-1 raw observations per chapter.
What to Build:
Kaggle Notebook running vLLM across both T4s:
--tensor-parallel-size 2 --dtype float16 --gpu-memory-utilization 0.90
(Use a 4-bit AWQ model like Qwen 14B/32B-AWQ or Qwen3-30B-A3B).
Pass vLLM response_format using the JSON schema generated directly from your ChapterObservation Pydantic model.
Rolling Prompt Input:
[Current Entity Glossary (IDs + known names)] + [Last 200 words of previous chunk] + [Current Chapter Markdown].
After every single chapter: validate JSON → save to R2 (/extracted/.../ch_001_obs.json) → update last_completed_chapter & updated glossary in Supabase/R2.
🛑 STOP & TEST (Edge Cases):
EC-2.1 (100% Schema Compliance): Run all 4 test books. Pass criteria: 0 JSON parse failures across dense dialogue, action, and poetry.
EC-2.2 (Anti-Hallucination Anchor Check): Write a Python verifier script that checks every extracted quote_anchor against the source ch_XXX.md. Pass criteria: ≥ 95% exact/near-exact substring match (proves Qwen isn't rewriting or inventing prose).
EC-2.3 (Sudden Death / Resume Test): Manually click "Stop Session" in Kaggle right after Chapter 2 completes. Start a fresh Kaggle session, run the script, and verify:
Chapters 1–2 are skipped.
The rolling Entity Glossary from Chapter 2 is loaded cleanly.
Extraction resumes seamlessly at Chapter 3 with zero duplicate files.
EC-2.4 (Empty / Transition Chapter): Verify the 2-line poem chapter outputs valid schema JSON (scenes: [] or 1 minimal scene) without hallucinating fake characters.
EC-2.5 (Glossary Bloat Control): Check token size of the rolling Entity Glossary after 6 chapters. Ensure you only pass {entity_id, canonical_name, aliases, short_tag} in the rolling prompt (not full descriptions!), otherwise prompt tokens will balloon on 50-chapter books.
Checkpoint 3: Stage-2 "Book Compiler" (Knowledge Graph, Timeline & Scoring)
Goal: Run once per completed book (CPU or lightweight LLM pass) to transform raw Stage-1 chapter observations into a coherent, resolved Temporal Knowledge Graph.
What to Build (Python Compiler Script):
Alias Resolver: Cluster candidate names ("The Hooded Man", "Stranger", "Vane") using fuzzy matching + 1 Qwen verification call over the book's master entity list.
Dual Timeline Builder: Assign narrative_seq (1..N) AND story_time_tick (detecting flashback/dream tags from TimeClue).
Location Tree Stitcher: Build parent_location_id + materialized_path + location_edges, with cycle detection.
Carry-Forward State Machine: Walk chronologically along story_time_tick to populate character_scene_states (outfits + physical condition) and item_custody_timeline.
Importance Scorer: Compute 0.0–1.0 composite scores for Characters & Locations and assign visual_tier (1, 2, 3).
🛑 STOP & TEST (Edge Cases on test_narrative_hell.epub):
EC-3.1 (The Flashback Corruption Test): In the flashback chapter, Character A is wearing old clothes and has no scar. In the present timeline (before & after the flashback), Character A has a facial scar. Verify your state machine walked story_time_tick—meaning the flashback did not erase Character A's scar in the present scenes!
EC-3.2 (Late Alias Reveal Remapping): "The Hooded Stranger" appears in Ch 1, and in Ch 4 is revealed to be "Lord Vane". Verify all Ch 1 scene links and graph edges now point to char_lord_vane, while preserving Ch 1's scene-specific outfit (dark hooded cloak).
EC-3.3 (Skipped Location Levels): Test "Witch's Cabin" inside "Whispering Woods" inside "Northern Reach" (no City/Town). Verify materialized_path (/loc_north/loc_woods/loc_cabin) and WITH RECURSIVE descendant queries return "Witch's Cabin" when querying "Northern Reach".
EC-3.4 (Location Cycle Defense): Feed a deliberate bad clue ("Room A is inside Manor B" and "Manor B is inside Room A"). Verify your cycle detector breaks the loop cleanly instead of crashing Python with RecursionError.
EC-3.5 (Carry-Forward Time-Skip Reset): When a scene starts with "Six months later...", verify your state machine marks carried outfits as confidence: STALE_TIME_SKIP instead of assuming someone wore the exact same muddy shirt for 6 months!
EC-3.6 (Importance Tier Sanity Check): Inspect top Tier-1 characters and locations. Confirm protagonists rank ≥ 0.70 and one-line extras rank < 0.30.
Checkpoint 4: Hybrid RAG + Graph RAG Packaging & Turso Sync
Goal: Embed scene chunks, build FTS5 + DiskANN + Temporal Graph tables inside a local SQLite .db, push it to Turso, register it in Supabase, and run live retrieval queries.
What to Build:
On Kaggle (or local GPU/CPU), run a 768-dim embedding model (e.g., BAAI/bge-m3 or Qwen3-Embedding-0.6B) on Scene/Beat chunks (enriched with a short header: [Chapter 3 | Vance Manor | Present: Mira, Vane]).
Store embeddings as F16_BLOB(768) in rag_chunks, sync rag_chunks_fts (FTS5), populate kg_nodes & kg_edges, and create agent_workspace.
Push the finished .db to Turso (1 DB per test book) and update books_catalog in Supabase with the Turso DB URL and status READY.
🛑 STOP & TEST (Edge Cases via Retrieval Queries):
EC-4.1 (Hybrid Exact vs. Semantic Query):
Query A (Rare proper noun): "Cracked Brass Lantern" → Confirm FTS5 + RRF ranks the exact chunk #1.
Query B (Pure visual mood): "warm firelight shadows across tense faces" → Confirm DiskANN Vector + RRF finds relevant atmospheric scenes even if those exact words aren't used.
EC-4.2 (Spoiler-Barrier Isolation): Query "Who betrayed the king?" with hard filter narrative_seq <= 3 (before the Chapter 5 betrayal). Confirm zero chunks or graph edges from Chapters 4+ appear in the result!
EC-4.3 (Temporal 2-Hop Graph Traversal): At story_time_tick = 10, Mira holds the Brass Lantern inside Vance Manor. At tick = 25, Vane steals it and moves to the Docks. Run your WITH RECURSIVE query at tick = 10 vs tick = 25 and confirm ownership & location flip accurately.
EC-4.4 (Scale & Quota Audit): Measure the .db file size for a 5-chapter test book and extrapolate to a full 400-page novel (~1,500 chunks). Verify it sits comfortably around 3–8 MB per book (meaning Turso's 5 GB free tier holds hundreds of books, while Supabase stays < 5 MB).
Golden Rule Before Moving to Production / Multi-Agent Work
Do not write a single line of Art Director agent code or Image Generation code until all 4 test books pass Checkpoints 1–4 cleanly. Once Checkpoint 4 passes, you can process an entire library of books with confidence, knowing your RAG, Graph, Timeline, and Cloud Checkpoints are rock-solid.
38.7s
Google AI models may make mistakes, so double-check outputs.
Use Arrow Up and Arrow Down to select a turn, Enter to jump to it, and Escape to return to the chat.
Start typing a prompt to see what our models can do


Code execution

Grounding with Google Search

