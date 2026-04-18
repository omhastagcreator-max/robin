import { useState, useCallback } from 'react';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';

export interface Task {
  _id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: string;
  taskType?: string;
  projectId?: string;
  assignedTo?: string;
  assignedBy?: string;
  completedAt?: string;
}

export function useTasks() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await api.listTasks();
      setTasks(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, [user]);

  const updateTask = useCallback(async (id: string, patch: Partial<Task>) => {
    await api.updateTask(id, patch as Record<string, unknown>);
    setTasks(prev => prev.map(t => t._id === id ? { ...t, ...patch } : t));
  }, []);

  const createTask = useCallback(async (data: Omit<Task, '_id'>) => {
    const created = await api.createTask(data as Record<string, unknown>);
    setTasks(prev => [...prev, created]);
    return created;
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    await api.deleteTask(id);
    setTasks(prev => prev.filter(t => t._id !== id));
  }, []);

  return { tasks, loading, refresh, updateTask, createTask, deleteTask };
}
