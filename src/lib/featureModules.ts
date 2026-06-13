// Feature modules an admin can switch on/off and restrict by role.
// Config is stored per-church in churches.feature_config as:
//   { "/app/members": { enabled: true, roles: ["Manager","Staff","Member"] }, ... }
// Not-configured = visible to everyone (default on).

export interface FeatureModule {
  key: string;   // route path, also the config key
  icon: string;
  en: string;
  zh: string;
}

export const FEATURE_MODULES: FeatureModule[] = [
  { key: '/app/members',      icon: 'group',              en: 'Members',          zh: '会友' },
  { key: '/app/groups',       icon: 'groups',             en: 'Groups',           zh: '小组' },
  { key: '/app/roster',       icon: 'calendar_month',     en: 'Service Roster',   zh: '服事排班' },
  { key: '/app/songs',        icon: 'music_note',         en: 'PPT Creator',      zh: 'PPT 制作' },
  { key: '/app/ready',        icon: 'present_to_all',     en: 'PPT Library',      zh: 'PPT 资源库' },
  { key: '/app/publications', icon: 'menu_book',          en: 'Publications',     zh: '出版物' },
  { key: '/app/bulletin',     icon: 'newspaper',          en: 'Weekly Bulletin',  zh: '每周周报' },
  { key: '/app/prayer',       icon: 'volunteer_activism', en: 'Prayer Wall',      zh: '祷告墙' },
  { key: '/app/giving',       icon: 'favorite',           en: 'Giving',           zh: '奉献' },
  { key: '/app/tasks',        icon: 'task_alt',           en: 'Tasks',            zh: '任务' },
  { key: '/app/ai',           icon: 'smart_toy',          en: 'Grace Assistant',  zh: 'Grace 助理' },
  { key: '/app/activity',     icon: 'history',            en: 'Activity Log',     zh: '活动日志' },
  { key: '/app/about',        icon: 'church',             en: 'Our Church',       zh: '我们的教会' },
];

// The three view roles a module can be restricted to (match the app's modes).
export const FEATURE_ROLES = ['Manager', 'Staff', 'Member'] as const;
export type FeatureRole = typeof FEATURE_ROLES[number];

export type FeatureConfig = Record<string, { enabled?: boolean; roles?: string[] }>;

// Should this module be visible for the given role/mode? Unconfigured = visible.
export function canSeeModule(config: FeatureConfig | undefined | null, key: string, role: string): boolean {
  const cfg = config?.[key];
  if (!cfg) return true;
  if (cfg.enabled === false) return false;
  if (Array.isArray(cfg.roles) && cfg.roles.length > 0 && !cfg.roles.includes(role)) return false;
  return true;
}
