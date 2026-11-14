"use client";

import React from "react";
import {
  BookOpen,
  Terminal,
  Database,
  Search,
  Clapperboard,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import { LabStation } from "@/types/lab";

interface LabNavigationProps {
  activeStation: LabStation;
  onSelectStation: (station: LabStation) => void;
}

const STATIONS: Array<{
  id: LabStation;
  label: string;
  icon: React.ElementType;
  color: string;
}> = [
  { id: "ingestion", label: "1. DOM Ingest", icon: BookOpen, color: "text-emerald-400" },
  { id: "extraction", label: "2. Story Brain", icon: Terminal, color: "text-cyan-400" },
  { id: "foundry", label: "3. Foundry Bible", icon: Database, color: "text-amber-400" },
  { id: "rag", label: "4. Vector RAG", icon: Search, color: "text-violet-400" },
  { id: "storyboard", label: "5. Co-Director", icon: Clapperboard, color: "text-indigo-400" },
  { id: "qc", label: "6. 3-Gate QC", icon: ShieldCheck, color: "text-rose-400" },
  { id: "audio_film", label: "7. Film Studio", icon: Volume2, color: "text-purple-400" },
];

export function LabNavigation({ activeStation, onSelectStation }: LabNavigationProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 bg-neutral-900/60 p-2 rounded-xl border border-neutral-800">
      {STATIONS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeStation === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onSelectStation(tab.id)}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-xs font-medium transition-all ${
              isActive
                ? "bg-neutral-800 text-white shadow-lg border border-neutral-700 font-semibold"
                : "text-neutral-400 hover:text-white hover:bg-neutral-800/40"
            }`}
          >
            <Icon className={`w-4 h-4 ${tab.color}`} />
            <span className="truncate">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

