import { create } from 'zustand';
import type { Project } from '../agent/types';

interface ProjectState {
  projects: Project[];
  currentProjectId: string | null;
  isInitialized: boolean;

  // Actions
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  setCurrentProject: (id: string | null) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  setProjects: (projects: Project[]) => void;
  setInitialized: (value: boolean) => void;
}

// Note: We don't use persist middleware here because the backend
// (AgentBridge) is the source of truth for projects.
// Projects are loaded from the backend on app startup via App.tsx.
export const useProjectStore = create<ProjectState>()((set) => ({
  projects: [],
  currentProjectId: null,
  isInitialized: false,

  addProject: (project) =>
    set((state) => ({
      projects: [...state.projects, project],
    })),

  removeProject: (id) =>
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      currentProjectId:
        state.currentProjectId === id ? null : state.currentProjectId,
    })),

  setCurrentProject: (id) => set({ currentProjectId: id }),

  updateProject: (id, updates) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, ...updates } : p
      ),
    })),

  setProjects: (projects) => set({ projects }),

  setInitialized: (value) => set({ isInitialized: value }),
}));

// Selectors
export const selectCurrentProject = (state: ProjectState) =>
  state.projects.find((p) => p.id === state.currentProjectId);

export const selectProjectById = (state: ProjectState, id: string) =>
  state.projects.find((p) => p.id === id);
