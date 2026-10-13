export type CouncilRole = 'Owner' | 'Research Partner' | 'Guest' | 'Agent';

export interface CouncilCapabilities {
  role: CouncilRole;
  manage: boolean;
  research: boolean;
  execute: boolean;
}

/** Friendly role names derived from the office's enforced admin/member session model. */
export function councilAccess(me: { admin: boolean; account?: { role: string } }): CouncilCapabilities {
  if (me.admin || me.account?.role === 'admin') return { role: 'Owner', manage: true, research: true, execute: true };
  if (me.account?.role === 'member') return { role: 'Research Partner', manage: false, research: true, execute: true };
  return { role: 'Guest', manage: false, research: false, execute: false };
}

export const agentAccess: CouncilCapabilities = { role: 'Agent', manage: false, research: true, execute: true };
