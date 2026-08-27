import { DEMO_CHURCH_ID, sampleVisit } from './demoChurch';

/**
 * Centralized permission helpers.
 *
 * All role / permission checks in the app should go through these functions.
 * Never scatter raw role-string comparisons or hardcoded email checks across
 * individual components — import from here so a single change propagates
 * everywhere.
 */

/**
 * Roles considered "Super Admin" level。去空格转大写再比 —— 库里这一列
 * 出现过 'Super Admin' / 'SuperAdmin' / 'SUPERADMIN' 三种写法，逐个列举
 * 迟早漏。
 */
const isSuperAdminRole = (role?: string) =>
  !!role && role.replace(/\s+/g, '').toUpperCase() === 'SUPERADMIN';

/**
 * 平台所有者邮箱：无论 profiles.role 是什么都按 Super Admin 处理。
 * 这是唯一一份清单 —— AuthContext 和 supabase_setup_all.sql 的
 * is_platform_admin() 都要与它保持一致，否则会出现「前端显示控制台、
 * 数据库拒绝写入」的错配。
 */
export const OWNER_EMAILS = new Set([
  'jzey805@gmail.com',
  'hyy7010@gmail.com',
  'admin@fliptus.com',
]);

/**
 * Returns true if the user is a Super Admin, regardless of whether
 * the check comes from a real session or a demo session.
 */
export function isSuperAdmin(profile: any, user?: any): boolean {
  if (isSuperAdminRole(profile?.role)) return true;
  const email = (user?.email ?? profile?.email ?? '').toLowerCase().trim();
  return OWNER_EMAILS.has(email);
}

/**
 * Returns true if the user can perform manager-level actions
 * (Super Admin, Manager, Admin, Leader).
 */
export function canManageChurch(profile: any, user?: any): boolean {
  if (isSuperAdmin(profile, user)) return true;
  return ['Manager', 'Admin', 'Leader'].includes(profile?.role ?? '');
}

/**
 * Returns true if the user can perform staff-level actions.
 */
export function canDoStaff(profile: any, user?: any): boolean {
  if (canManageChurch(profile, user)) return true;
  return profile?.role === 'Staff';
}

/**
 * Returns the best available church ID for the current session.
 *
 * Priority: auth-context church (which super admin can switch) > profile church_id.
 *
 * Pages that query the DB should call this instead of reading
 * `profile?.church_id` directly so that Super Admins can switch context.
 */
export function getActiveChurchId(profile: any, church: any): string | null {
  // 参观示例教会期间一律返回示例教会 —— 不看 church state。它会被 token
  // 刷新等事件异步冲掉，页面在那个窗口里会读到用户自己教会的数据（表现为
  // 「离开一会儿回来 demo 数据就没了」）。
  if (sampleVisit.isVisiting()) return DEMO_CHURCH_ID;
  const churchId = church?.id;
  // Skip demo placeholder — fall through to real profile church_id
  if (churchId && churchId !== 'demo-church-id') return churchId;
  return profile?.church_id ?? null;
}

/**
 * Returns true if the active church is the synthetic demo church
 * (i.e. no real DB queries should be written there).
 */
export function isDemoChurch(church: any): boolean {
  return church?.id === 'demo-church-id';
}
