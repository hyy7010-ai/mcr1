import { supabase } from '../lib/supabase';

/**
 * 属灵生活模块的通用存储。
 *
 * 所有新模块（打卡 / 通知 / 课程 / 报名 / 资源 / 失物 / 私聊 / 探访）共用一张
 * `church_life` 表，靠 `kind` 区分。DB 不可用时自动退回 localStorage，
 * 所以 demo 教会和未跑 SQL 的环境也能正常使用。
 */
export type LifeKind =
  | 'checkin' | 'notice' | 'course' | 'enroll'
  | 'resource' | 'lostfound' | 'dm' | 'visit' | 'reading';

export interface LifeRow<T = any> {
  id: string;
  church_id: string;
  kind: LifeKind;
  data: T;
  author_id?: string | null;
  author_name?: string | null;
  created_at: string;
}

const key = (churchId: string, kind: LifeKind) => `life_${churchId}_${kind}`;

/** DB 不可达时别把界面卡住 — 超时就当作失败，走 localStorage。 */
function withTimeout<T>(p: PromiseLike<T>, ms = 4000): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

function lsGet<T>(churchId: string, kind: LifeKind): LifeRow<T>[] {
  try { return JSON.parse(localStorage.getItem(key(churchId, kind)) || '[]'); } catch { return []; }
}
function lsSet(churchId: string, kind: LifeKind, rows: LifeRow[]) {
  try { localStorage.setItem(key(churchId, kind), JSON.stringify(rows)); } catch {}
}

export const lifeService = {
  async list<T = any>(churchId: string, kind: LifeKind): Promise<LifeRow<T>[]> {
    if (!churchId) return [];
    const { data, error } = await withTimeout(
      supabase.from('church_life').select('*')
        .eq('church_id', churchId).eq('kind', kind)
        .order('created_at', { ascending: false }),
    ).catch(() => ({ data: null, error: true as any }));
    if (error || !data) return lsGet<T>(churchId, kind);
    lsSet(churchId, kind, data as LifeRow[]);
    return data as LifeRow<T>[];
  },

  async add<T = any>(
    churchId: string, kind: LifeKind, data: T,
    author?: { id?: string | null; name?: string | null },
  ): Promise<LifeRow<T>> {
    const row = {
      church_id: churchId, kind, data,
      author_id: author?.id || null, author_name: author?.name || null,
    };
    const { data: saved, error } = await withTimeout(
      supabase.from('church_life').insert(row).select().single(),
    ).catch(() => ({ data: null, error: true as any }));
    if (!error && saved) {
      lsSet(churchId, kind, [saved as LifeRow, ...lsGet(churchId, kind)]);
      return saved as LifeRow<T>;
    }
    const local: LifeRow<T> = {
      ...row, id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      created_at: new Date().toISOString(),
    } as LifeRow<T>;
    lsSet(churchId, kind, [local as LifeRow, ...lsGet(churchId, kind)]);
    return local;
  },

  async patch(churchId: string, kind: LifeKind, id: string, data: any): Promise<void> {
    lsSet(churchId, kind, lsGet(churchId, kind).map(r => (r.id === id ? { ...r, data } : r)));
    if (id.startsWith('local-')) return;
    await withTimeout(supabase.from('church_life').update({ data }).eq('id', id)).catch(() => {});
  },

  async remove(churchId: string, kind: LifeKind, id: string): Promise<void> {
    lsSet(churchId, kind, lsGet(churchId, kind).filter(r => r.id !== id));
    if (id.startsWith('local-')) return;
    await withTimeout(supabase.from('church_life').delete().eq('id', id)).catch(() => {});
  },
};

/** YYYY-MM-DD（本地时区），打卡与热力图统一用它做日期键。 */
export const dayKey = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
