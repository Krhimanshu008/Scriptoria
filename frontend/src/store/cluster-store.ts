import { create } from "zustand";

interface ActiveStreamState {
  target: string;
  modelName: string;
  category: string;
  percentage: number;
  speedText: string;
  active: boolean;
}

interface ClusterUiState {
  selectedTarget: string;
  setSelectedTarget: (target: string) => void;
  activeStream: ActiveStreamState | null;
  setActiveStream: (stream: ActiveStreamState | null) => void;
}

export const useClusterStore = create<ClusterUiState>((set) => ({
  selectedTarget: "gpu0",
  setSelectedTarget: (selectedTarget) => set({ selectedTarget }),
  activeStream: null,
  setActiveStream: (activeStream) => set({ activeStream }),
}));

