import type { AdminRole } from '../models/types.js';

/** Role → permission matrix for the admin panel (least privilege). */
export const PERMISSIONS = {
  'dashboard:view': ['SUPER_ADMIN', 'ADMIN', 'RISK_MANAGER', 'SUPPORT'],
  'users:view': ['SUPER_ADMIN', 'ADMIN', 'RISK_MANAGER', 'SUPPORT'],
  'users:manage': ['SUPER_ADMIN', 'ADMIN', 'RISK_MANAGER'],
  'bets:view': ['SUPER_ADMIN', 'ADMIN', 'RISK_MANAGER', 'SUPPORT'],
  'bets:manage': ['SUPER_ADMIN', 'ADMIN'],
  'sports:manage': ['SUPER_ADMIN', 'ADMIN'],
  'finance:view': ['SUPER_ADMIN', 'ADMIN', 'RISK_MANAGER', 'SUPPORT'],
  'finance:manage': ['SUPER_ADMIN', 'ADMIN'],
  'wallet:adjust': ['SUPER_ADMIN', 'ADMIN'],
  'risk:manage': ['SUPER_ADMIN', 'ADMIN', 'RISK_MANAGER'],
  'settings:manage': ['SUPER_ADMIN'],
  'admins:manage': ['SUPER_ADMIN'],
  'audit:view': ['SUPER_ADMIN', 'ADMIN', 'RISK_MANAGER'],
} as const satisfies Record<string, readonly AdminRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export const can = (role: AdminRole, p: Permission) => (PERMISSIONS[p] as readonly AdminRole[]).includes(role);

export const permissionsFor = (role: AdminRole) => (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
