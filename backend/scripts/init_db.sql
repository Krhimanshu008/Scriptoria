-- ============================================================================
-- Master DDL: Universal Book-to-Knowledge & Visualisation Studio
-- Compatible with Supabase PostgreSQL 15+ (pgvector, uuid-ossp)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ----------------------------------------------------------------------------
-- 1. SCHEMAS
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS core_sources;
CREATE SCHEMA IF NOT EXISTS core_knowledge;
CREATE SCHEMA IF NOT EXISTS domain_fiction;
CREATE SCHEMA IF NOT EXISTS domain_education;
CREATE SCHEMA IF NOT EXISTS core_production;

-- ----------------------------------------------------------------------------
-- 2. UNIVERSAL ENUMS
-- ----------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE core_sources.workspace_domain AS ENUM (
        'FICTION_UNIVERSE', 'ACADEMIC_SUBJECT', 'RESEARCH_SYNTHESIS', 'TECHNICAL_SYSTEM'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE core_knowledge.node_category AS ENUM (
        'PERSON_OR_CHARACTER', 'LOCATION', 'ITEM_OR_ARTIFACT', 'OUTFIT_OR_ARMOR', 'ENVIRONMENT', 'FACTION',
        'CONCEPT_OR_THEORY', 'MATHEMATICAL_FORMULA', 'SYSTEM_OR_COMPONENT', 'PROCESS_OR_ALGORITHM', 'HISTORICAL_EVENT'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE core_knowledge.epistemic_status AS ENUM (
        'EXPLICIT_SOURCE_FACT',
        'LOGICAL_INFERENCE',
        'CREATIVE_INTERPRETATION',
        'SIMPLIFIED_ASSUMPTION',
        'ALTERNATIVE_FORMULATION',
        'DISPUTED_CLAIM',
        'UNRESOLVED'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE core_production.render_engine_type AS ENUM (
        'COMFYUI_NEURAL_RASTER',
        'MANIM_MATH_ANIMATION',
        'SYMBOLIC_DIAGRAM_SVG',
        'INTERACTIVE_COMPONENT'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ----------------------------------------------------------------------------
-- 3. LAYER 1: UNIVERSAL SOURCE LIBRARY (core_sources)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core_sources.workspaces (
    workspace_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    domain core_sources.workspace_domain NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core_sources.books (
    book_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES core_sources.workspaces(workspace_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    authors TEXT[] DEFAULT '{}',
    edition TEXT,
    publication_year INT,
    book_order_in_workspace INT,
    metadata JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS core_sources.document_units (
    unit_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    book_id UUID NOT NULL REFERENCES core_sources.books(book_id) ON DELETE CASCADE,
    parent_unit_id UUID REFERENCES core_sources.document_units(unit_id) ON DELETE CASCADE,
    unit_type TEXT NOT NULL,
    unit_number INT NOT NULL,
    title TEXT,
    page_start INT,
    page_end INT,
    raw_text TEXT,
    processing_status TEXT DEFAULT 'PENDING'
);

CREATE TABLE IF NOT EXISTS core_sources.source_passages (
    passage_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    unit_id UUID NOT NULL REFERENCES core_sources.document_units(unit_id) ON DELETE CASCADE,
    book_id UUID NOT NULL REFERENCES core_sources.books(book_id) ON DELETE CASCADE,
    passage_order INT NOT NULL,
    page_number INT,
    exact_quote TEXT NOT NULL,
    embedding vector(1536)
);

-- ----------------------------------------------------------------------------
-- 4. LAYER 2: UNIVERSAL KNOWLEDGE GRAPH (core_knowledge)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core_knowledge.nodes (
    node_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES core_sources.workspaces(workspace_id) ON DELETE CASCADE,
    node_code TEXT UNIQUE NOT NULL,
    category core_knowledge.node_category NOT NULL,
    canonical_name TEXT NOT NULL,
    aliases TEXT[] DEFAULT '{}',
    parent_node_id UUID REFERENCES core_knowledge.nodes(node_id),
    canonical_summary TEXT,
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core_knowledge.claims (
    claim_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    node_id UUID NOT NULL REFERENCES core_knowledge.nodes(node_id) ON DELETE CASCADE,
    source_book_id UUID REFERENCES core_sources.books(book_id) ON DELETE SET NULL,
    source_passage_id UUID REFERENCES core_sources.source_passages(passage_id) ON DELETE SET NULL,
    attribute_or_aspect TEXT NOT NULL,
    claim_value TEXT NOT NULL,
    epistemic_status core_knowledge.epistemic_status NOT NULL,
    assumptions_or_context TEXT,
    is_superseded BOOLEAN DEFAULT FALSE,
    superseded_by_claim_id UUID REFERENCES core_knowledge.claims(claim_id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core_knowledge.edges (
    edge_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES core_sources.workspaces(workspace_id) ON DELETE CASCADE,
    source_node_id UUID NOT NULL REFERENCES core_knowledge.nodes(node_id) ON DELETE CASCADE,
    target_node_id UUID NOT NULL REFERENCES core_knowledge.nodes(node_id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL,
    context_note TEXT,
    source_book_id UUID REFERENCES core_sources.books(book_id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core_knowledge.node_states (
    state_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    node_id UUID NOT NULL REFERENCES core_knowledge.nodes(node_id) ON DELETE CASCADE,
    state_code TEXT NOT NULL,
    valid_from_tick BIGINT NOT NULL,
    valid_to_tick BIGINT,
    revealed_at_tick BIGINT NOT NULL,
    state_description TEXT,
    state_dna JSONB DEFAULT '{}'
);

-- ----------------------------------------------------------------------------
-- 5. DOMAIN PLUGIN: FICTION (domain_fiction)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS domain_fiction.arcs (
    arc_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES core_sources.workspaces(workspace_id) ON DELETE CASCADE,
    arc_number INT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT
);

CREATE TABLE IF NOT EXISTS domain_fiction.story_threads (
    thread_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    arc_id UUID NOT NULL REFERENCES domain_fiction.arcs(arc_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    importance_tier TEXT DEFAULT 'MAIN'
);

CREATE TABLE IF NOT EXISTS domain_fiction.scenes (
    scene_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES core_sources.workspaces(workspace_id) ON DELETE CASCADE,
    chapter_unit_id UUID REFERENCES core_sources.document_units(unit_id) ON DELETE SET NULL,
    scene_number INT NOT NULL,
    location_node_id UUID REFERENCES core_knowledge.nodes(node_id),
    scene_start_tick BIGINT NOT NULL,
    scene_end_tick BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS domain_fiction.shots (
    shot_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scene_id UUID NOT NULL REFERENCES domain_fiction.scenes(scene_id) ON DELETE CASCADE,
    shot_number INT NOT NULL,
    shot_tick BIGINT NOT NULL,
    camera_framing TEXT,
    lighting_and_atmosphere TEXT,
    action_description TEXT NOT NULL,
    audio_ambience TEXT
);

CREATE TABLE IF NOT EXISTS domain_fiction.state_loadouts (
    loadout_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    holder_state_id UUID NOT NULL REFERENCES core_knowledge.node_states(state_id) ON DELETE CASCADE,
    slot TEXT NOT NULL,
    equipped_node_id UUID NOT NULL REFERENCES core_knowledge.nodes(node_id) ON DELETE CASCADE,
    equipped_state_id UUID REFERENCES core_knowledge.node_states(state_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS domain_fiction.shot_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shot_id UUID NOT NULL REFERENCES domain_fiction.shots(shot_id) ON DELETE CASCADE,
    participant_node_id UUID NOT NULL REFERENCES core_knowledge.nodes(node_id) ON DELETE CASCADE,
    participant_state_id UUID REFERENCES core_knowledge.node_states(state_id),
    current_action_in_shot TEXT,
    spatial_position TEXT
);

-- ----------------------------------------------------------------------------
-- 6. DOMAIN PLUGIN: EDUCATION & TECHNICAL (domain_education)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS domain_education.curriculum_nodes (
    curriculum_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES core_sources.workspaces(workspace_id) ON DELETE CASCADE,
    concept_node_id UUID NOT NULL REFERENCES core_knowledge.nodes(node_id) ON DELETE CASCADE,
    pedagogical_order INT NOT NULL,
    difficulty_level TEXT DEFAULT 'INTERMEDIATE'
);

CREATE TABLE IF NOT EXISTS domain_education.concept_lessons (
    lesson_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    concept_node_id UUID NOT NULL REFERENCES core_knowledge.nodes(node_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    learning_objectives TEXT[],
    canonical_explanation TEXT NOT NULL,
    latex_formulas JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS domain_education.worked_sequences (
    sequence_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    concept_node_id UUID NOT NULL REFERENCES core_knowledge.nodes(node_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    sequence_type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS domain_education.sequence_steps (
    step_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sequence_id UUID NOT NULL REFERENCES domain_education.worked_sequences(sequence_id) ON DELETE CASCADE,
    step_number INT NOT NULL,
    step_instruction TEXT NOT NULL,
    step_formula_latex TEXT,
    visual_diagram_spec JSONB
);

-- ----------------------------------------------------------------------------
-- 7. LAYER 3: UNIVERSAL VISUAL & LEARNING PRODUCTION (core_production)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core_production.production_specs (
    spec_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES core_sources.workspaces(workspace_id) ON DELETE CASCADE,
    fiction_shot_id UUID REFERENCES domain_fiction.shots(shot_id) ON DELETE CASCADE,
    edu_concept_node_id UUID REFERENCES core_knowledge.nodes(node_id) ON DELETE CASCADE,
    edu_sequence_step_id UUID REFERENCES domain_education.sequence_steps(step_id) ON DELETE CASCADE,
    render_engine core_production.render_engine_type NOT NULL,
    compiled_payload JSONB NOT NULL,
    source_book_ids UUID[] DEFAULT '{}',
    output_asset_url TEXT,
    qa_status TEXT DEFAULT 'PENDING'
);

-- ----------------------------------------------------------------------------
-- 8. RECURSIVE SQL FUNCTION: PREREQUISITE LEARNING PATH DAG
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core_knowledge.get_prerequisite_learning_path(
    p_target_node_id UUID,
    p_max_depth INT DEFAULT 6
)
RETURNS TABLE (
    node_id UUID,
    node_code TEXT,
    canonical_name TEXT,
    dependency_depth INT,
    learning_path_codes TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE prereq_dag AS (
        SELECT 
            n.node_id,
            n.node_code,
            n.canonical_name,
            1 AS depth,
            ARRAY[target_n.node_code, n.node_code] AS path_codes,
            ARRAY[target_n.node_id, n.node_id] AS visited_ids
        FROM core_knowledge.edges e
        JOIN core_knowledge.nodes n ON n.node_id = e.source_node_id
        JOIN core_knowledge.nodes target_n ON target_n.node_id = e.target_node_id
        WHERE e.target_node_id = p_target_node_id
          AND e.relationship_type = 'PREREQUISITE_FOR'

        UNION ALL

        SELECT 
            parent_n.node_id,
            parent_n.node_code,
            parent_n.canonical_name,
            d.depth + 1,
            d.path_codes || parent_n.node_code,
            d.visited_ids || parent_n.node_id
        FROM prereq_dag d
        JOIN core_knowledge.edges e ON e.target_node_id = d.node_id
        JOIN core_knowledge.nodes parent_n ON parent_n.node_id = e.source_node_id
        WHERE e.relationship_type = 'PREREQUISITE_FOR'
          AND d.depth < p_max_depth
          AND NOT (parent_n.node_id = ANY(d.visited_ids))
    )
    SELECT 
        prereq_dag.node_id,
        prereq_dag.node_code,
        prereq_dag.canonical_name,
        MAX(prereq_dag.depth) AS dependency_depth,
        (ARRAY_AGG(prereq_dag.path_codes ORDER BY CARDINALITY(prereq_dag.path_codes) DESC))[1]
    FROM prereq_dag
    GROUP BY prereq_dag.node_id, prereq_dag.node_code, prereq_dag.canonical_name
    ORDER BY dependency_depth DESC;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 9. BI-TEMPORAL STATE RESOLUTION FUNCTION
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core_knowledge.resolve_node_state_at_tick(
    p_node_id UUID,
    p_story_tick BIGINT,
    p_revealed_at_tick BIGINT
)
RETURNS TABLE (
    node_code TEXT,
    canonical_name TEXT,
    active_state_id UUID,
    state_code TEXT,
    state_dna JSONB,
    equipped_loadout JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        n.node_code,
        n.canonical_name,
        ns.state_id AS active_state_id,
        ns.state_code,
        ns.state_dna,
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'slot', sl.slot,
                        'item_code', in_node.node_code,
                        'item_name', in_node.canonical_name,
                        'item_state_code', in_state.state_code,
                        'item_dna', in_state.state_dna
                    )
                )
                FROM domain_fiction.state_loadouts sl
                JOIN core_knowledge.nodes in_node ON in_node.node_id = sl.equipped_node_id
                LEFT JOIN core_knowledge.node_states in_state ON in_state.state_id = sl.equipped_state_id
                WHERE sl.holder_state_id = ns.state_id
            ),
            '[]'::jsonb
        ) AS equipped_loadout
    FROM core_knowledge.nodes n
    JOIN core_knowledge.node_states ns ON ns.node_id = n.node_id
    WHERE n.node_id = p_node_id
      AND ns.valid_from_tick <= p_story_tick
      AND (ns.valid_to_tick IS NULL OR ns.valid_to_tick >= p_story_tick)
      AND ns.revealed_at_tick <= p_revealed_at_tick
    ORDER BY ns.revealed_at_tick DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;
