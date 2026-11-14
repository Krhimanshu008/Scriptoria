// Visualiser Lab Station and DOM Walker Contracts
import { StagedScene } from "./staging";

export type LabStation =
  | "ingestion"
  | "extraction"
  | "foundry"
  | "rag"
  | "storyboard"
  | "qc"
  | "audio_film";

export type IngestionMode =
  | "epub_upload"
  | "lotm_vol1"
  | "shadow_slave"
  | "paste_html";

export interface DomParagraphAtom {
  index: number;
  text: string;
  wordCount: number;
  hasDialogue: boolean;
  kineticScore: number;
  dialogueDensity: number;
  isTemporalShift: boolean;
  isFlashback: boolean;
}

export interface IngestionChapterMeta {
  chapterIndex: number;
  title: string;
  wordCount: number;
  sceneCountEstimated: number;
  rawText: string;
  atoms: DomParagraphAtom[];
}

export interface ExtractionStationState {
  scenes: StagedScene[];
  selectedSceneId: string | null;
  filterEntityCategory: "all" | "characters" | "costumes" | "locations" | "environments";
  isExtracting: boolean;
  extractionModel: string;
}

