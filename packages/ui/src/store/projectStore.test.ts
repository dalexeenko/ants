import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore, selectCurrentProject, selectProjectById } from './projectStore';
import type { Project } from '../agent/types';

describe('useProjectStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useProjectStore.setState({
      projects: [],
      currentProjectId: null,
    });
  });

  describe('project management', () => {
    const mockProject: Project = {
      id: 'project-1',
      name: 'Test Project',
      path: '/path/to/project',
      createdAt: Date.now(),
      providerType: 'local',
    };

    it('should add a project', () => {
      useProjectStore.getState().addProject(mockProject);
      
      const projects = useProjectStore.getState().projects;
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe('project-1');
    });

    it('should add multiple projects', () => {
      const project2: Project = { ...mockProject, id: 'project-2', name: 'Project 2' };
      
      useProjectStore.getState().addProject(mockProject);
      useProjectStore.getState().addProject(project2);
      
      const projects = useProjectStore.getState().projects;
      expect(projects).toHaveLength(2);
    });

    it('should remove a project', () => {
      const project2: Project = { ...mockProject, id: 'project-2' };
      useProjectStore.getState().addProject(mockProject);
      useProjectStore.getState().addProject(project2);
      
      useProjectStore.getState().removeProject('project-1');
      
      const projects = useProjectStore.getState().projects;
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe('project-2');
    });

    it('should clear currentProjectId when removing current project', () => {
      useProjectStore.getState().addProject(mockProject);
      useProjectStore.getState().setCurrentProject('project-1');
      
      useProjectStore.getState().removeProject('project-1');
      
      expect(useProjectStore.getState().currentProjectId).toBeNull();
    });

    it('should not clear currentProjectId when removing different project', () => {
      const project2: Project = { ...mockProject, id: 'project-2' };
      useProjectStore.getState().addProject(mockProject);
      useProjectStore.getState().addProject(project2);
      useProjectStore.getState().setCurrentProject('project-1');
      
      useProjectStore.getState().removeProject('project-2');
      
      expect(useProjectStore.getState().currentProjectId).toBe('project-1');
    });

    it('should update a project', () => {
      useProjectStore.getState().addProject(mockProject);
      
      useProjectStore.getState().updateProject('project-1', {
        name: 'Updated Name',
      });
      
      const projects = useProjectStore.getState().projects;
      expect(projects[0].name).toBe('Updated Name');
      expect(projects[0].path).toBe('/path/to/project'); // unchanged
    });

    it('should not update non-existent project', () => {
      useProjectStore.getState().addProject(mockProject);
      
      useProjectStore.getState().updateProject('non-existent', {
        name: 'Updated Name',
      });
      
      const projects = useProjectStore.getState().projects;
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('Test Project');
    });

    it('should set current project', () => {
      useProjectStore.getState().addProject(mockProject);
      useProjectStore.getState().setCurrentProject('project-1');
      
      expect(useProjectStore.getState().currentProjectId).toBe('project-1');
    });

    it('should clear current project', () => {
      useProjectStore.getState().addProject(mockProject);
      useProjectStore.getState().setCurrentProject('project-1');
      useProjectStore.getState().setCurrentProject(null);
      
      expect(useProjectStore.getState().currentProjectId).toBeNull();
    });

    it('should set all projects', () => {
      const project2: Project = { ...mockProject, id: 'project-2' };
      const project3: Project = { ...mockProject, id: 'project-3' };
      
      useProjectStore.getState().setProjects([project2, project3]);
      
      const projects = useProjectStore.getState().projects;
      expect(projects).toHaveLength(2);
      expect(projects[0].id).toBe('project-2');
      expect(projects[1].id).toBe('project-3');
    });

    it('should replace existing projects when setting all', () => {
      useProjectStore.getState().addProject(mockProject);
      
      const newProject: Project = { ...mockProject, id: 'new-project' };
      useProjectStore.getState().setProjects([newProject]);
      
      const projects = useProjectStore.getState().projects;
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe('new-project');
    });
  });

  describe('worktree fields', () => {
    const mockProject: Project = {
      id: 'project-1',
      name: 'Test Project',
      path: '/path/to/project',
      createdAt: Date.now(),
      providerType: 'local',
      isGitRepo: true,
      worktreeEnabled: false,
    };

    it('should store isGitRepo and worktreeEnabled', () => {
      useProjectStore.getState().addProject(mockProject);

      const projects = useProjectStore.getState().projects;
      expect(projects[0].isGitRepo).toBe(true);
      expect(projects[0].worktreeEnabled).toBe(false);
    });

    it('should update worktreeEnabled', () => {
      useProjectStore.getState().addProject(mockProject);

      useProjectStore.getState().updateProject('project-1', {
        worktreeEnabled: true,
      });

      const projects = useProjectStore.getState().projects;
      expect(projects[0].worktreeEnabled).toBe(true);
      expect(projects[0].isGitRepo).toBe(true); // unchanged
    });

    it('should update isGitRepo', () => {
      useProjectStore.getState().addProject(mockProject);

      useProjectStore.getState().updateProject('project-1', {
        isGitRepo: false,
      });

      const projects = useProjectStore.getState().projects;
      expect(projects[0].isGitRepo).toBe(false);
      expect(projects[0].worktreeEnabled).toBe(false); // unchanged
    });
  });

  describe('remote projects', () => {
    it('should handle remote provider type', () => {
      const remoteProject: Project = {
        id: 'remote-1',
        name: 'Remote Project',
        path: '/remote/path',
        createdAt: Date.now(),
        providerType: 'remote',
        remoteServerId: 'server-1',
      };
      
      useProjectStore.getState().addProject(remoteProject);
      
      const projects = useProjectStore.getState().projects;
      expect(projects[0].providerType).toBe('remote');
      expect(projects[0].remoteServerId).toBe('server-1');
    });
  });

  describe('selectors', () => {
    const mockProject: Project = {
      id: 'project-1',
      name: 'Test Project',
      path: '/path/to/project',
      createdAt: Date.now(),
      providerType: 'local',
    };

    it('selectCurrentProject returns current project', () => {
      useProjectStore.getState().addProject(mockProject);
      useProjectStore.getState().setCurrentProject('project-1');
      
      const state = useProjectStore.getState();
      const project = selectCurrentProject(state);
      
      expect(project?.id).toBe('project-1');
    });

    it('selectCurrentProject returns undefined when no current project', () => {
      useProjectStore.getState().addProject(mockProject);
      
      const state = useProjectStore.getState();
      const project = selectCurrentProject(state);
      
      expect(project).toBeUndefined();
    });

    it('selectCurrentProject returns undefined for invalid currentProjectId', () => {
      useProjectStore.getState().addProject(mockProject);
      useProjectStore.getState().setCurrentProject('non-existent');
      
      const state = useProjectStore.getState();
      const project = selectCurrentProject(state);
      
      expect(project).toBeUndefined();
    });

    it('selectProjectById returns project by id', () => {
      const project2: Project = { ...mockProject, id: 'project-2', name: 'Project 2' };
      useProjectStore.getState().addProject(mockProject);
      useProjectStore.getState().addProject(project2);
      
      const state = useProjectStore.getState();
      const project = selectProjectById(state, 'project-2');
      
      expect(project?.name).toBe('Project 2');
    });

    it('selectProjectById returns undefined for unknown id', () => {
      useProjectStore.getState().addProject(mockProject);
      
      const state = useProjectStore.getState();
      const project = selectProjectById(state, 'unknown');
      
      expect(project).toBeUndefined();
    });
  });
});
