import { useState, useEffect, useCallback } from 'react';
import { api } from './api';

export interface ProjectSummary {
  id: string;
  name: string;
  workingDirectory: string;
}

/**
 * Hook to load the project list and manage a selected project.
 * Used by project-scoped pages (Memories, Webhooks, Tasks).
 */
export function useProjects() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProjects = useCallback(async () => {
    try {
      const data = await api.get<{ projects: ProjectSummary[] }>('/projects');
      setProjects(data.projects);
      // Auto-select first project if none selected
      if (data.projects.length > 0 && !selectedProjectId) {
        setSelectedProjectId(data.projects[0].id);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  return {
    projects,
    selectedProjectId,
    setSelectedProjectId,
    loading,
  };
}
