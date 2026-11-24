import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export interface Department {
  id: number;
  name: string;
  slug: string;
  evolutionInstance: string | null;
  waState: string;
  waNumber: string | null;
  agentNamePrefix: boolean;
  menuEnabled: boolean;
  menuMaxInvalid: number;
  closeMsgIndividual: boolean;
  closeMsgGroup: boolean;
  catalogSource: 'local' | 'external_mariadb';
  active: boolean;
  conversationsCount: number;
  ticketsCount: number;
  canDelete: boolean;
}

export function useDepartments() {
  return useQuery({ queryKey: ['admin-departments'], queryFn: () => api.get<Department[]>('admin/departments') });
}

export interface AdminUser {
  id: number;
  username: string;
  name: string;
  email: string | null;
  role: 'admin' | 'operator';
  roleLabel: string;
  active: boolean;
  mustChangePassword: boolean;
  locked: boolean;
  lastLoginAt: string | null;
  departmentIds: number[];
  groupIds: number[];
}

export interface Group {
  id: number;
  name: string;
  description: string | null;
  memberIds: number[];
  permissions: string[];
}

export interface PermissionDef {
  key: string;
  page: string;
  label: string;
}

export function usePermissionCatalog() {
  return useQuery({ queryKey: ['admin-permissions'], queryFn: () => api.get<PermissionDef[]>('admin/permissions'), staleTime: Infinity });
}

export function useAdminUsers() {
  return useQuery({ queryKey: ['admin-users'], queryFn: () => api.get<AdminUser[]>('admin/users') });
}

export function useGroups() {
  return useQuery({ queryKey: ['admin-groups'], queryFn: () => api.get<Group[]>('admin/groups') });
}
