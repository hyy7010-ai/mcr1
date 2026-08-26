import { supabase } from './supabase';

/**
 * 示例教会（Demo Church / sample tenant）
 *
 * 全平台共用一条教会记录，装满示例数据，任何登录用户都能切进去参观、随便试，
 * Super Admin 可在平台管理控制台一键重置。UUID 与 supabase_demo_church.sql 保持一致。
 *
 * 注意：别和 `demo-church-id` 混淆 —— 那个是「该用户还没分配教会」的占位符
 * （见 lib/permissions.ts 的 isDemoChurch），含义正好相反。
 */
export const DEMO_CHURCH_ID = '0de00000-0000-4000-a000-000000000001';
export const DEMO_CHURCH_NAME = '示例教会 Grace Demo Church';

export const isSampleChurch = (church: any): boolean =>
  (church?.id ?? church) === DEMO_CHURCH_ID;

/** 参观期间把用户原本的教会存起来，退出时好切回去。 */
const RETURN_KEY = 'sample_church_return_to';

export const sampleVisit = {
  start(currentChurch: any) {
    try { localStorage.setItem(RETURN_KEY, JSON.stringify(currentChurch ?? null)); } catch {}
  },
  /** 返回用户原本的教会；没有记录就返回 null（由调用方决定回落到哪）。 */
  end(): any | null {
    try {
      const raw = localStorage.getItem(RETURN_KEY);
      localStorage.removeItem(RETURN_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  isVisiting(): boolean {
    return localStorage.getItem(RETURN_KEY) !== null;
  },
};

/* ── 示例内容 ─────────────────────────────────────────────────────────────
   全部集中在这里，改文案不用翻代码。日期按「相对今天」算，示例永远不过期。
   ────────────────────────────────────────────────────────────────────── */

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** 从今天往后数第 n 个主日（n=0 即最近的一个）。 */
function nextSunday(n = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7) + n * 7);
  return iso(d);
}
function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
}

const MEMBERS = [
  { name: '陈约翰 John Chen',  initials: 'JC', status: 'Pastor',    role: ['主任牧师'],   family: '陈家',   occupation: '牧师',     skills: ['讲道', '门徒栽培'], phone: '0400 100 001' },
  { name: '林恩慈 Grace Lin',  initials: 'GL', status: 'Leader',    role: ['敬拜带领'],   family: '林家',   occupation: '音乐教师', skills: ['主领', '钢琴'],     phone: '0400 100 002' },
  { name: '王大卫 David Wang', initials: 'DW', status: 'Leader',    role: ['青年团契'],   family: '王家',   occupation: '工程师',   skills: ['吉他', '带小组'],   phone: '0400 100 003' },
  { name: '李美玲 Mary Li',    initials: 'ML', status: 'Leader',    role: ['关怀组'],     family: '李家',   occupation: '护士',     skills: ['探访', '烹饪'],     phone: '0400 100 004' },
  { name: '张保罗 Paul Zhang', initials: 'PZ', status: 'Member',    role: ['音响'],       family: '张家',   occupation: 'IT 支持',  skills: ['音响', '投影'],     phone: '0400 100 005' },
  { name: '刘平安 Peace Liu',  initials: 'PL', status: 'Member',    role: ['司琴'],       family: '刘家',   occupation: '会计',     skills: ['钢琴'],             phone: '0400 100 006' },
  { name: '黄喜乐 Joy Huang',  initials: 'JH', status: 'Member',    role: ['招待'],       family: '黄家',   occupation: '零售',     skills: ['招待', '接待新朋友'], phone: '0400 100 007' },
  { name: '吴信实 Faith Wu',   initials: 'FW', status: 'Member',    role: ['主日学'],     family: '吴家',   occupation: '幼教',     skills: ['儿童主日学'],       phone: '0400 100 008' },
  { name: '郑安德 Andrew Zheng', initials: 'AZ', status: 'Member',  role: ['投影'],       family: '郑家',   occupation: '学生',     skills: ['投影', '摄影'],     phone: '0400 100 009' },
  { name: '周新民 Simon Zhou', initials: 'SZ', status: 'New Friend', role: [],            family: '周家',   occupation: '厨师',     skills: [],                   phone: '0400 100 010' },
  { name: '孙恩典 Gift Sun',   initials: 'GS', status: 'New Friend', role: [],            family: '孙家',   occupation: '设计师',   skills: ['平面设计'],         phone: '0400 100 011' },
  { name: '马利亚 Maria Ma',   initials: 'MM', status: 'Member',    role: ['财务'],       family: '马家',   occupation: '银行职员', skills: ['记账'],             phone: '0400 100 012' },
];

const GROUPS = [
  { name: '青年团契',   description: '18–30 岁，每周五晚 7:30，查经与生活分享。', color: '#2C2C2C', icon: 'groups' },
  { name: '姊妹小组',   description: '每周二上午，查经、代祷与育儿交流。',       color: '#8B7E74', icon: 'diversity_3' },
  { name: '福音朋友小组', description: '为慕道友预备，轻松聊信仰的入门小组。',   color: '#6E635B', icon: 'handshake' },
];

const EVENTS = [
  { title: '主日崇拜',       event_date: nextSunday(0), event_time: '10:00', category: 'Service',   description: '主日联合崇拜，会后爱筵。' },
  { title: '圣餐主日',       event_date: nextSunday(1), event_time: '10:00', category: 'Communion', description: '每月首个主日举行圣餐。' },
  { title: '受洗见证会',     event_date: nextSunday(2), event_time: '10:00', category: 'Service',   description: '三位弟兄姊妹受洗，欢迎家人朋友一同见证。' },
  { title: '青年团契查经',   event_date: daysFromNow(4), event_time: '19:30', category: 'Meeting',  description: '罗马书第八章。' },
  { title: '同工月度会议',   event_date: daysFromNow(11), event_time: '20:00', category: 'Meeting', description: '各部门事工回顾与下月计划。' },
];

const TASKS = [
  { title: '预备主日讲道 PPT',   description: '经文：罗马书 8:28–39', due_date: daysFromNow(3),  priority: 'high',   status: 'pending',     category: '主日预备', created_by_name: '陈约翰 John Chen' },
  { title: '联系受洗班学员',     description: '确认三位受洗者的见证稿。',  due_date: daysFromNow(6),  priority: 'high',   status: 'in_progress', category: '牧养',     created_by_name: '李美玲 Mary Li' },
  { title: '采购爱筵食材',       description: '本月爱筵约 60 人。',        due_date: daysFromNow(5),  priority: 'medium', status: 'pending',     category: '总务',     created_by_name: '黄喜乐 Joy Huang' },
  { title: '整理上月奉献报表',   description: '交财务组复核。',            due_date: daysFromNow(9),  priority: 'medium', status: 'done',        category: '财务',     created_by_name: '马利亚 Maria Ma' },
];

const PRAYERS = [
  { content: '求主医治我父亲的膝盖手术，也求主赐我们全家平安与信心。', tag: 'health', author_name: '李美玲 Mary Li',   anonymous: false, prayed_count: 23 },
  { content: '为下周的工作面试祷告，求主开路，也求主让我在职场中作光作盐。', tag: 'work',   author_name: '郑安德 Andrew Zheng', anonymous: false, prayed_count: 11 },
  { content: '孩子刚上中学，求主保守他交对朋友，也求主给我们做父母的智慧。', tag: 'family', author_name: '',                anonymous: true,  prayed_count: 17 },
  { content: '求主指引我毕业后的方向，是继续升学还是先工作，求主让我心里有平安。', tag: 'future', author_name: '',            anonymous: true,  prayed_count: 8 },
  { content: '感谢主！上个月提的搬家代祷已经蒙应允，新住处离教会只要十分钟。', tag: 'other',  author_name: '黄喜乐 Joy Huang', anonymous: false, prayed_count: 31 },
];

const ROSTER_ROLES = ['讲员', '主领', '司琴', '音响', '投影', '招待'];

const LIFE: { kind: string; data: any; author_name?: string }[] = [
  { kind: 'notice', data: { title: '本周主日因暴雨改为线上聚会', body: '气象局已发布暴雨预警。主日上午 10:00 请从教会公众号进入线上聚会室，爱筵取消。', level: 'urgent' }, author_name: '陈约翰 John Chen' },
  { kind: 'notice', data: { title: '冬令营招募同工', body: '7 月 12–14 日青年冬令营，招募厨务、活动、摄影同工各 2 名，请向王大卫报名。', level: 'info' }, author_name: '王大卫 David Wang' },

  { kind: 'course', data: { title: '系统神学导读班', speaker: '陈约翰 牧师', time: '每周三 19:30，共 8 周', place: '副堂 201', capacity: 20, outline: '第一课：启示论\n第二课：神论\n第三课：基督论\n第四课：救恩论' }, author_name: '陈约翰 John Chen' },
  { kind: 'course', data: { title: '新信徒门徒成长班', speaker: '李美玲 传道', time: '每周日 13:00，共 6 周', place: '小堂', capacity: 12, outline: '认识救恩、读经方法、祷告生活、教会生活、奉献与服事、传福音。' }, author_name: '李美玲 Mary Li' },
  { kind: 'course', data: { title: '敬拜团新人训练', speaker: '林恩慈', time: '每周六 15:00，共 4 周', place: '敬拜厅', capacity: 8, outline: '敬拜的心态、基本乐理、团队默契、主日流程实操。' }, author_name: '林恩慈 Grace Lin' },

  { kind: 'resource', data: { cat: 'prep',   title: '主日崇拜流程表（模板）', note: '含诗歌、经文、报告顺序', url: '' } },
  { kind: 'resource', data: { cat: 'sermon', title: '罗马书 8 章讲道大纲',    note: '陈约翰 牧师', url: '' } },
  { kind: 'resource', data: { cat: 'group',  title: '小组查经手册 · 约翰福音', note: '共 21 课，附讨论问题', url: '' } },
  { kind: 'resource', data: { cat: 'misc',   title: '教会场地借用申请表',      note: '婚礼、追思、外借请提前两周', url: '' } },

  { kind: 'lostfound', data: { kind: 'lost',  title: '黑色折叠雨伞',   note: '主日下午遗落在二楼走廊。', contact: '0400 100 007' }, author_name: '黄喜乐 Joy Huang' },
  { kind: 'lostfound', data: { kind: 'found', title: '儿童蓝色水壶',   note: '在主日学教室捡到，已放到接待台。', contact: '接待台' }, author_name: '吴信实 Faith Wu' },
  { kind: 'lostfound', data: { kind: 'share', title: '婴儿床免费转赠', note: '孩子长大用不上了，成色良好，自取。', contact: '0400 100 011' }, author_name: '孙恩典 Gift Sun' },

  { kind: 'visit',  data: { name: '周新民 Simon Zhou', contact: '0400 100 010', address: 'Hurstville', reason: '刚来教会两次，想多认识弟兄姊妹。', needs: '工作日晚上有空', spiritual: '慕道中，对救恩有兴趣', status: 'scheduled', log: [] }, author_name: '李美玲 Mary Li' },
  { kind: 'visit',  data: { name: '张伯母', contact: '0400 100 099', address: 'Kogarah', reason: '住院两周，盼望同工探望。', needs: '需要有人代买日用品', spiritual: '信心坚定，盼望有人一同祷告', status: 'visited', log: [{ at: new Date().toISOString(), by: '李美玲 Mary Li', text: '已到医院探望，一同读诗篇 23 篇并祷告，精神不错。' }] }, author_name: '李美玲 Mary Li' },

  { kind: 'reading', data: { ot: 412, nt: 168 } },
];

/* ── 重置 ─────────────────────────────────────────────────────────────── */

export interface SeedResult { table: string; rows: number; error?: string }

/** 每张表单独 try —— 某张表不存在/列对不上时只跳过它，不拖垮整次重置。 */
async function wipeAndInsert(table: string, rows: any[]): Promise<SeedResult> {
  try {
    const { error: delErr } = await supabase.from(table).delete().eq('church_id', DEMO_CHURCH_ID);
    if (delErr) return { table, rows: 0, error: delErr.message };
    if (!rows.length) return { table, rows: 0 };
    const { data, error } = await supabase.from(table).insert(rows).select('id');
    if (error) return { table, rows: 0, error: error.message };
    return { table, rows: data?.length ?? 0 };
  } catch (e: any) {
    return { table, rows: 0, error: e?.message || String(e) };
  }
}

/**
 * 清空并重新写入示例教会的全部示例数据。
 * 只影响 church_id = DEMO_CHURCH_ID 的行，碰不到任何真实教会。
 */
export async function resetDemoChurch(): Promise<SeedResult[]> {
  const out: SeedResult[] = [];
  const cid = DEMO_CHURCH_ID;

  // 教会记录本身（SQL 脚本已建好，这里只补名字，跑过就当没事）
  await supabase.from('churches').update({ name: DEMO_CHURCH_NAME }).eq('id', cid);

  // 成员要先写，排班要用它们的 id
  const memberRows = MEMBERS.map(m => ({ ...m, church_id: cid, joined: daysFromNow(-Math.floor(Math.random() * 900) - 30) }));
  await supabase.from('church_members').delete().eq('church_id', cid);
  const { data: members, error: memErr } = await supabase.from('church_members').insert(memberRows).select('id, name, status');
  out.push({ table: 'church_members', rows: members?.length ?? 0, error: memErr?.message });

  out.push(await wipeAndInsert('church_groups', GROUPS.map(g => ({ ...g, church_id: cid }))));
  out.push(await wipeAndInsert('church_events', EVENTS.map(e => ({ ...e, church_id: cid }))));
  out.push(await wipeAndInsert('church_tasks',  TASKS.map(t => ({ ...t, church_id: cid }))));

  out.push(await wipeAndInsert('church_prayers', PRAYERS.map(p => ({
    church_id: cid, content: p.content, tag: p.tag, anonymous: p.anonymous,
    author_name: p.anonymous ? 'Anonymous' : p.author_name,
    author_email: '', visibility: 'All Church', status: 'Published', prayed_count: p.prayed_count,
  }))));

  out.push(await wipeAndInsert('church_life', LIFE.map(l => ({
    church_id: cid, kind: l.kind, data: l.data, author_id: null, author_name: l.author_name ?? null,
  }))));

  // 排班：接下来四个主日，每个主日排满六个岗位
  if (members?.length) {
    const byName = (n: string) => members.find((m: any) => m.name.startsWith(n))?.id;
    const plan: Record<string, string | undefined> = {
      '讲员': byName('陈约翰'), '主领': byName('林恩慈'), '司琴': byName('刘平安'),
      '音响': byName('张保罗'), '投影': byName('郑安德'), '招待': byName('黄喜乐'),
    };
    const rosterRows = [0, 1, 2, 3].flatMap(w =>
      ROSTER_ROLES.map(role => ({ church_id: cid, date: nextSunday(w), staff_id: plan[role], role }))
        .filter(r => r.staff_id));
    out.push(await wipeAndInsert('rosters', rosterRows));
  }

  return out;
}
