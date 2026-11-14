// Scriptoria & Book Graph: Canonical Staging Data Contracts
// Holds structured pre-processed entity & scene data before downstream multi-agent dispatch

export type ProcessingStatus =
  | "EXTRACTED"
  | "VALIDATED"
  | "IN_RESEARCH"
  | "IN_CINEMATOGRAPHY"
  | "READY_FOR_RENDER"
  | "FLAGGED_FOR_REVIEW";

export type EntityApprovalStatus =
  | "DISCOVERED"
  | "APPROVED"
  | "SUPERSEDED"
  | "REJECTED";

export interface StagedBeat {
  id: string;
  sceneId: string;
  passageOrder: number;
  narrativeTick: number;
  rawText: string;
  wordCount: number;
  kineticIntensity: number; // 0.0 to 1.0
  dialogueDensity: number;  // 0.0 to 1.0
  isFlashback: boolean;
  timeOfDayHint?: "Dawn" | "Morning" | "Noon" | "Dusk" | "Night";
}

export interface StagedCostume {
  id: string;
  characterMentionId: string;
  headwear?: string;
  upperBody?: string;
  lowerBody?: string;
  footwear?: string;
  accessoriesAndJewelry?: string[];
  equippedWeapon?: string;
  equippedShield?: string;
  colorPalette?: string[];
  wearTearLevel: "PRISTINE" | "SOILED" | "BATTLE_DAMAGED" | "TORN";
}

export interface StagedCharacter {
  id: string;
  sceneId: string;
  rawName: string;
  canonicalName?: string;
  tier: "MAIN" | "SUPPORTING" | "BACKGROUND";
  emotionalState?: string;
  physicalCondition?: string;
  activePosture?: string;
  dialogueSnippets: string[];
  costumes: StagedCostume[];
  status: EntityApprovalStatus;
}

export interface StagedLocation {
  id: string;
  sceneId: string;
  locationName: string;
  category: "INTERIOR" | "EXTERIOR" | "SUBTERRANEAN" | "URBAN" | "WILDERNESS" | "ASTRAL";
  architecturalStyle?: string;
  spatialDimensions?: string;
  keyLandmarks: string[];
  floorSurface?: string;
  status: EntityApprovalStatus;
}

export interface StagedEnvironment {
  id: string;
  sceneId: string;
  primaryLightSource?: string;
  lightingQuality?: string;
  colorCast?: string;
  weather?: string;
  atmosphericParticles?: string;
  windIntensity?: string;
  audioAmbience?: string;
}

export interface StagedScene {
  id: string;
  sourceId: string;
  bookId?: string;
  chapterNumber: number;
  sceneOrderInChapter: number;
  temporalTickStart: number;
  temporalTickEnd: number;
  timeOfDay?: string;
  sceneType: "DIALOGUE" | "ACTION" | "TRANSITION" | "INTROSPECTION";
  sceneHeading: string;
  rawTextChunk: string;
  wordCount: number;
  processingStatus: ProcessingStatus;
  createdAt: string;

  // Staged Child Entities
  beats: StagedBeat[];
  characters: StagedCharacter[];
  locations: StagedLocation[];
  environment?: StagedEnvironment;
}

