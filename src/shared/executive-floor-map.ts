/**
 * The explicit bridge between Executive World locations and Agent Office floors.
 * Null floor IDs are intentional: the location is visible in the campus but is
 * not connected to a live floor yet, so the UI can report Planned / Not Connected.
 */
export interface ExecutiveFloorMapEntry {
  districtId: string;
  buildingId: string;
  displayName: string;
  agentOfficeFloorId: string | null;
  connected: boolean;
  fallback: 'planned-not-connected' | 'open-floor-picker';
  destinationLabel?: string;
}

export const EXECUTIVE_SHARED_RUNTIME_LABEL = 'Agent Office Executive World · Shared Runtime Floor';

export const EXECUTIVE_FLOOR_MAP: readonly ExecutiveFloorMapEntry[] = [
  { districtId: 'administration', buildingId: 'town-hall', displayName: 'Town Hall', agentOfficeFloorId: 'agent-office-executive-world', connected: true, fallback: 'planned-not-connected', destinationLabel: EXECUTIVE_SHARED_RUNTIME_LABEL },
  { districtId: 'administration', buildingId: 'intake-routing', displayName: 'Intake & Routing', agentOfficeFloorId: null, connected: false, fallback: 'planned-not-connected' },
  { districtId: 'finance', buildingId: 'financial-markets', displayName: 'Financial Markets', agentOfficeFloorId: null, connected: false, fallback: 'planned-not-connected' },
  { districtId: 'finance', buildingId: 'investment-portfolio', displayName: 'Investment Portfolio', agentOfficeFloorId: null, connected: false, fallback: 'planned-not-connected' },
  { districtId: 'finance', buildingId: 'day-trading', displayName: 'Day Trading', agentOfficeFloorId: null, connected: false, fallback: 'planned-not-connected' },
  { districtId: 'finance', buildingId: 'finance-review', displayName: 'Finance Review', agentOfficeFloorId: null, connected: false, fallback: 'planned-not-connected' },
  { districtId: 'personal-planning', buildingId: 'planning', displayName: 'Planning', agentOfficeFloorId: null, connected: false, fallback: 'planned-not-connected' },
  { districtId: 'personal-planning', buildingId: 'schedule', displayName: 'Schedule', agentOfficeFloorId: null, connected: false, fallback: 'planned-not-connected' },
  { districtId: 'personal-planning', buildingId: 'personal-review', displayName: 'Personal Review', agentOfficeFloorId: null, connected: false, fallback: 'planned-not-connected' },
  { districtId: 'build-design', buildingId: 'research', displayName: 'Research', agentOfficeFloorId: null, connected: false, fallback: 'planned-not-connected' },
  { districtId: 'build-design', buildingId: 'build-workshop', displayName: 'Build Workshop', agentOfficeFloorId: null, connected: false, fallback: 'planned-not-connected' },
  { districtId: 'build-design', buildingId: 'design-studio', displayName: 'Design Studio', agentOfficeFloorId: null, connected: false, fallback: 'planned-not-connected' },
  { districtId: 'build-design', buildingId: 'prompt-lab', displayName: 'Prompt Lab', agentOfficeFloorId: null, connected: false, fallback: 'planned-not-connected' },
  { districtId: 'venture-lab', buildingId: 'opportunity-research', displayName: 'Opportunity Research', agentOfficeFloorId: null, connected: false, fallback: 'planned-not-connected' },
  { districtId: 'venture-lab', buildingId: 'business-validation', displayName: 'Business Validation', agentOfficeFloorId: null, connected: false, fallback: 'planned-not-connected' },
  { districtId: 'venture-lab', buildingId: 'launch-growth', displayName: 'Launch & Growth', agentOfficeFloorId: null, connected: false, fallback: 'planned-not-connected' },
  { districtId: 'security-audit', buildingId: 'security-privacy', displayName: 'Security & Privacy', agentOfficeFloorId: null, connected: false, fallback: 'planned-not-connected' },
  { districtId: 'security-audit', buildingId: 'quality-inspection', displayName: 'Quality Inspection', agentOfficeFloorId: null, connected: false, fallback: 'planned-not-connected' },
  { districtId: 'security-audit', buildingId: 'workflow-reliability', displayName: 'Workflow & Reliability', agentOfficeFloorId: null, connected: false, fallback: 'planned-not-connected' },
];

export function executiveFloorFor(buildingId: string): ExecutiveFloorMapEntry | undefined {
  return EXECUTIVE_FLOOR_MAP.find((entry) => entry.buildingId === buildingId);
}
