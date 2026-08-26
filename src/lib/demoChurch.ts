import { supabase } from './supabase';
import { dayKey } from '../services/lifeService';

/**
 * 示例教会（Demo Church / sample tenant）
 *
 * 全平台共用一条教会记录，装满示例数据，任何登录用户都能切进去参观。
 * **对所有人只读**（RLS 保证），只有平台管理员能写 —— 共用一个教会又人人可写的话，
 * 第一个删掉示例排班的人就毁了后面所有访客的样板间。用户想留下什么，走
 * copyFromSample()，把结构复制进自己的教会。UUID 与 supabase_setup_all.sql 一致。
 *
 * 注意：别和 `demo-church-id` 混淆 —— 那个是「该用户还没分配教会」的占位符
 * （见 lib/permissions.ts 的 isDemoChurch），含义正好相反。
 */
export const DEMO_CHURCH_ID = '0de00000-0000-4000-a000-000000000001';
export const DEMO_CHURCH_NAME = '示例教会 Grace Demo Church';

export const isSampleChurch = (church: any): boolean =>
  (church?.id ?? church) === DEMO_CHURCH_ID;

export const SAMPLE_CHURCH = {
  id: DEMO_CHURCH_ID, name: DEMO_CHURCH_NAME, code: 'DEMO', church_code: 'DEMO',
};

/**
 * 参观状态放 sessionStorage：刷新后还在（否则 Supabase 刷新 token、标签页
 * 重新聚焦都会触发 fetchProfileAndChurch，把教会上下文冲回真实教会 ——
 * 用户会莫名其妙被弹出样板间），关掉标签页就自动清掉，不会被困住。
 */
const VISIT_KEY = 'sample_visit';
const RETURN_KEY = 'sample_church_return_to';

export const sampleVisit = {
  start(currentChurch: any) {
    try {
      sessionStorage.setItem(VISIT_KEY, '1');
      sessionStorage.setItem(RETURN_KEY, JSON.stringify(currentChurch ?? null));
    } catch {}
  },
  /** 返回用户原本的教会；没有记录就返回 null（由调用方决定回落到哪）。 */
  end(): any | null {
    try {
      const raw = sessionStorage.getItem(RETURN_KEY);
      sessionStorage.removeItem(VISIT_KEY);
      sessionStorage.removeItem(RETURN_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  isVisiting(): boolean {
    try { return sessionStorage.getItem(VISIT_KEY) === '1'; } catch { return false; }
  },
};

/* ── 示例内容 ─────────────────────────────────────────────────────────────
   全部集中在这里，改文案不用翻代码。日期按「相对今天」算，示例永远不过期。
   ────────────────────────────────────────────────────────────────────── */

// 按**本地**日期格式化。用 toISOString() 会走 UTC —— 在 UTC+10 这种时区，
// 本地周日 00:00 转成 UTC 就退回周六，整份示例数据的日期全差一天。
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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


/** 生日：相对当前月份生成，示例永远有「本月寿星」可看。age 用来倒推出生年。 */
function dob(monthOffset: number, day: number, age: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear() - age, now.getMonth() + monthOffset, day);
  return iso(d);
}

const MEMBERS = [
  { name: '陈约翰 John Chen',    initials: 'JC', status: 'Pastor',     role: ['主任牧师'],       family: '陈家', occupation: '牧师',       skills: ['讲道', '门徒栽培', '婚前辅导'], phone: '0400 100 001', dob: dob(0, 12, 52), referral_source: '创会同工' },
  { name: '陈师母 Ruth Chen',    initials: 'RC', status: 'Member',     role: ['师母', '关怀'],   family: '陈家', occupation: '中文教师',   skills: ['关怀', '烹饪'],                 phone: '0400 100 013', dob: dob(2, 3, 49),  referral_source: '家庭' },
  { name: '林恩慈 Grace Lin',    initials: 'GL', status: 'Leader',     role: ['敬拜带领'],       family: '林家', occupation: '音乐教师',   skills: ['主领', '钢琴', '编曲'],         phone: '0400 100 002', dob: dob(0, 24, 34), referral_source: '朋友介绍' },
  { name: '王大卫 David Wang',   initials: 'DW', status: 'Leader',     role: ['青年团契'],       family: '王家', occupation: '软件工程师', skills: ['吉他', '带小组'],               phone: '0400 100 003', dob: dob(1, 8, 29),  referral_source: '大学团契' },
  { name: '李美玲 Mary Li',      initials: 'ML', status: 'Leader',     role: ['关怀组'],         family: '李家', occupation: '注册护士',   skills: ['探访', '急救', '烹饪'],         phone: '0400 100 004', dob: dob(-1, 19, 45), referral_source: '同事邀请' },
  { name: '张保罗 Paul Zhang',   initials: 'PZ', status: 'Member',     role: ['音响'],           family: '张家', occupation: 'IT 支持',    skills: ['音响', '直播', '投影'],         phone: '0400 100 005', dob: dob(0, 5, 38),  referral_source: '妻子带来' },
  { name: '张丽华 Lily Zhang',   initials: 'LZ', status: 'Member',     role: ['招待'],           family: '张家', occupation: '药剂师',     skills: ['招待'],                         phone: '0400 100 014', dob: dob(3, 11, 36), referral_source: '朋友介绍' },
  { name: '刘平安 Peace Liu',    initials: 'PL', status: 'Member',     role: ['司琴'],           family: '刘家', occupation: '会计',       skills: ['钢琴', '记账'],                 phone: '0400 100 006', dob: dob(1, 22, 41), referral_source: '福音班' },
  { name: '黄喜乐 Joy Huang',    initials: 'JH', status: 'Member',     role: ['招待', '总务'],   family: '黄家', occupation: '零售主管',   skills: ['招待', '接待新朋友', '采买'],   phone: '0400 100 007', dob: dob(0, 28, 31), referral_source: '同事邀请' },
  { name: '吴信实 Faith Wu',     initials: 'FW', status: 'Member',     role: ['主日学'],         family: '吴家', occupation: '幼教老师',   skills: ['儿童主日学', '手工'],           phone: '0400 100 008', dob: dob(2, 17, 27), referral_source: '姊妹小组' },
  { name: '郑安德 Andrew Zheng', initials: 'AZ', status: 'Member',     role: ['投影', '摄影'],   family: '郑家', occupation: '大学生',     skills: ['投影', '摄影', '剪辑'],         phone: '0400 100 009', dob: dob(-1, 30, 21), referral_source: '青年团契' },
  { name: '马利亚 Maria Ma',     initials: 'MM', status: 'Member',     role: ['财务'],           family: '马家', occupation: '银行职员',   skills: ['记账', '报税'],                 phone: '0400 100 012', dob: dob(4, 9, 43),  referral_source: '朋友介绍' },
  { name: '许恩光 Simon Xu',     initials: 'SX', status: 'Member',     role: ['司机'],           family: '许家', occupation: '货运司机',   skills: ['接送', '搬运'],                 phone: '0400 100 015', dob: dob(5, 14, 55), referral_source: '邻居' },
  { name: '何静文 Jenny He',     initials: 'JH', status: 'Member',     role: ['文书'],           family: '何家', occupation: '行政助理',   skills: ['文书', '排版'],                 phone: '0400 100 016', dob: dob(3, 26, 33), referral_source: '姊妹小组' },
  { name: '周新民 Simon Zhou',   initials: 'SZ', status: 'New Friend', role: [],                 family: '周家', occupation: '厨师',       skills: [],                               phone: '0400 100 010', dob: dob(1, 6, 37),  referral_source: '黄喜乐邀请' },
  { name: '孙恩典 Gift Sun',     initials: 'GS', status: 'New Friend', role: [],                 family: '孙家', occupation: '平面设计师', skills: ['平面设计'],                     phone: '0400 100 011', dob: dob(0, 20, 26), referral_source: '福音朋友小组' },
  { name: '赵小雨 Rain Zhao',    initials: 'RZ', status: 'New Friend', role: [],                 family: '赵家', occupation: '留学生',     skills: [],                               phone: '0400 100 017', dob: dob(2, 2, 20),  referral_source: '郑安德邀请' },
  { name: '钱伯明 Ben Qian',     initials: 'BQ', status: 'Member',     role: [],                 family: '钱家', occupation: '退休',       skills: ['园艺'],                         phone: '0400 100 018', dob: dob(-1, 8, 71), referral_source: '女儿带来' },
];

export const SAMPLE_GROUPS = [
  { id: 'demo-group-vine',     name: '葡萄树小组',   description: '约翰福音 15:5「我是葡萄树，你们是枝子」。青年与初职，周五晚查经＋宵夜。', color: '#2C2C2C', icon: 'groups' },
  { id: 'demo-group-ebenezer', name: '以便以谢小组', description: '撒上 7:12「到如今耶和华都帮助我们」。姊妹与家庭，周二上午，可带小孩。',   color: '#8B7E74', icon: 'diversity_3' },
  { id: 'demo-group-bethel',   name: '伯特利小组',   description: '创 28:19「这地方是神的殿」。慕道友与新朋友，周六晚在咖啡厅轻松聊信仰。', color: '#6E635B', icon: 'handshake' },
];

/** 会友 → 所属小组。church_members.family 这一列在 UI 上就叫「所属小组」，
 *  直接用它，不去碰 church_group_members —— 那张表的 profile_id 是指向
 *  profiles 的外键，示例教会没有真实账号，塞进去会违反约束。 */
export const SAMPLE_GROUP_OF: Record<string, string> = {
  '陈约翰': '以便以谢小组', '陈师母': '以便以谢小组', '李美玲': '以便以谢小组',
  '张丽华': '以便以谢小组', '何静文': '以便以谢小组', '马利亚': '以便以谢小组',
  '林恩慈': '葡萄树小组',   '王大卫': '葡萄树小组',   '郑安德': '葡萄树小组',
  '刘平安': '葡萄树小组',   '张保罗': '葡萄树小组',   '吴信实': '葡萄树小组',
  '黄喜乐': '伯特利小组',   '周新民': '伯特利小组',   '孙恩典': '伯特利小组',
  '赵小雨': '伯特利小组',   '许恩光': '伯特利小组',   '钱伯明': '伯特利小组',
};

const EVENTS = [
  { title: '主日崇拜',         event_date: nextSunday(0), event_time: '10:00', category: 'Service',   description: '主日联合崇拜，会后爱筵。讲员：陈约翰牧师。' },
  { title: '祷告会',           event_date: daysFromNow(2), event_time: '19:30', category: 'Meeting',  description: '线上同步，链接见群公告。' },
  { title: '青年团契查经',     event_date: daysFromNow(4), event_time: '19:30', category: 'Meeting',  description: '罗马书第八章，聚会后有宵夜。' },
  { title: '敬拜团练习',       event_date: daysFromNow(5), event_time: '15:00', category: 'Meeting',  description: '主日事奉同工必到。' },
  { title: '圣餐主日',         event_date: nextSunday(1), event_time: '10:00', category: 'Communion', description: '每月首个主日举行圣餐，请弟兄姊妹预备己心。' },
  { title: '受洗见证会',       event_date: nextSunday(2), event_time: '10:00', category: 'Service',   description: '三位弟兄姊妹受洗，欢迎家人朋友一同见证。' },
  { title: '同工月度会议',     event_date: daysFromNow(11), event_time: '20:00', category: 'Meeting', description: '各部门事工回顾与下月计划。' },
  { title: '长者关怀日',       event_date: daysFromNow(13), event_time: '14:00', category: 'Meeting', description: '接送安排请找许恩光弟兄。' },
  { title: '青年冬令营',       event_date: daysFromNow(25), event_time: '全天',  category: 'Camp',    description: '三天两夜，Blue Mountains。招募厨务、活动、摄影同工。' },
];

const TASKS = [
  { title: '预备主日讲道 PPT',     description: '经文：罗马书 8:18–30。大纲已给敬拜团，PPT 周五前发给张保罗。', due_date: daysFromNow(3),  priority: 'high',   status: 'pending',     category: '主日预备', created_by_name: '陈约翰 John Chen' },
  { title: '联系受洗班三位学员',   description: '确认见证稿，提醒他们准备两分钟的分享。',                       due_date: daysFromNow(6),  priority: 'high',   status: 'in_progress', category: '牧养',     created_by_name: '李美玲 Mary Li' },
  { title: '采购爱筵食材',         description: '本月爱筵约 60 人，姊妹小组负责。预算 $250。',                  due_date: daysFromNow(5),  priority: 'medium', status: 'pending',     category: '总务',     created_by_name: '黄喜乐 Joy Huang' },
  { title: '整理上月奉献报表',     description: '交财务组复核后归档，年底审计要用。',                           due_date: daysFromNow(9),  priority: 'medium', status: 'done',       category: '财务',     created_by_name: '马利亚 Maria Ma' },
  { title: '跟进两位新朋友',       description: '周新民、赵小雨连续来了三次，安排一次家访或约咖啡。',           due_date: daysFromNow(8),  priority: 'high',   status: 'pending',     category: '牧养',     created_by_name: '李美玲 Mary Li' },
  { title: '修主堂第三排的椅子',   description: '有两张螺丝松了，坐上去会响。许恩光说周六来处理。',             due_date: daysFromNow(4),  priority: 'low',    status: 'pending',     category: '总务',     created_by_name: '许恩光 Simon Xu' },
  { title: '排下季度主日讲道表',   description: '需要邀请两位外来讲员，先问王牧师和郑传道的档期。',             due_date: daysFromNow(14), priority: 'medium', status: 'pending',     category: '主日预备', created_by_name: '陈约翰 John Chen' },
  { title: '更新教会保险',         description: '公众责任险下月到期，比较三家报价。',                           due_date: daysFromNow(20), priority: 'medium', status: 'in_progress', category: '行政',     created_by_name: '马利亚 Maria Ma' },
];

/** Tasks 页用的结构（dueDate、status 只有 pending / completed）。 */
export const SAMPLE_TASKS = () => TASKS.map((t, i) => ({
  id: String(i + 1),
  title: t.title,
  description: t.description,
  dueDate: t.due_date,
  priority: t.priority as 'low' | 'medium' | 'high',
  status: (t.status === 'done' ? 'completed' : 'pending') as 'pending' | 'completed',
  category: t.category,
}));

/**
 * 示范代祷。三种状态都要有，否则祷告墙管理视图的「待审核」「内部」
 * 两个页签在样板间里是空的，看不出这个功能是干什么的。
 */
export const SAMPLE_PRAYERS = [
  // ── 已发布：全教会可见 ──────────────────────────────────────────────
  { content: '求主医治我父亲的膝盖手术，下周三开刀。也求主赐我们全家平安与信心，不被恐惧抓住。', tag: 'health', authorName: '李美玲 Mary Li',   anonymous: false, prayedCount: 23, status: 'Published', visibility: 'All Church' },
  { content: '为下周的工作面试祷告，求主开路。也求主让我在职场中作光作盐，不只是求一份薪水。', tag: 'work',   authorName: '郑安德 Andrew Zheng', anonymous: false, prayedCount: 11, status: 'Published', visibility: 'All Church' },
  { content: '孩子刚上中学，求主保守他交对朋友，也求主给我们做父母的智慧，知道什么时候该管、什么时候该放手。', tag: 'family', authorName: '', anonymous: true, prayedCount: 17, status: 'Published', visibility: 'All Church' },
  { content: '求主指引我毕业后的方向，是继续升学还是先工作，求主让我心里有平安，不被同学的比较搅扰。', tag: 'future', authorName: '', anonymous: true, prayedCount: 8,  status: 'Published', visibility: 'All Church' },
  { content: '感谢主！上个月提的搬家代祷已经蒙应允，新住处离教会只要十分钟，孩子上学也方便。', tag: 'other',  authorName: '黄喜乐 Joy Huang', anonymous: false, prayedCount: 31, status: 'Published', visibility: 'All Church' },
  { content: '先生还没信主，每次我来教会他都不太高兴。求主软化他的心，也求主让我先活出来，而不是只会讲道理。', tag: 'family', authorName: '', anonymous: true, prayedCount: 42, status: 'Published', visibility: 'All Church' },
  { content: '公司在裁员，这个月已经走了三个同事。求主保守，也求主让我在不安里学会倚靠而不是焦虑。', tag: 'work', authorName: '张保罗 Paul Zhang', anonymous: false, prayedCount: 19, status: 'Published', visibility: 'All Church' },

  // ── 待审核：同工尚未放行 ────────────────────────────────────────────
  { content: '妈妈的检查报告下周出来，求主怜悯。她一个人在国内，我这边什么忙都帮不上，心里很难受。', tag: 'health', authorName: '', anonymous: true, prayedCount: 0, status: 'Pending Approval', visibility: 'All Church' },
  { content: '为教会的场地祷告。租约明年到期，房东说要涨三成，求主预备合适的地方，也让同工们同心。', tag: 'future', authorName: '陈约翰 John Chen', anonymous: false, prayedCount: 0, status: 'Pending Approval', visibility: 'All Church' },
  { content: '我和太太最近吵得很凶，已经一周没好好说话了。写下来手都在抖，但我不想就这样下去。', tag: 'family', authorName: '', anonymous: true, prayedCount: 0, status: 'Pending Approval', visibility: 'All Church' },
  { content: '想为儿子的婚礼献上感恩，六月十二号在主堂，也邀请弟兄姊妹一同来分享喜乐。', tag: 'other', authorName: '许恩光 Simon Xu', anonymous: false, prayedCount: 0, status: 'Pending Approval', visibility: 'All Church' },

  // ── 内部：仅同工 / 仅牧者可见 ───────────────────────────────────────
  { content: '周姊妹一家上个月开始经济困难，先生工作还没着落。已由关怀组每周送一次菜，请同工代祷，勿外传。', tag: 'family', authorName: '李美玲 Mary Li', anonymous: false, prayedCount: 6, status: 'Internal', visibility: 'Staff' },
  { content: '青年团契有两位弟兄近期起了争执，已分别约谈，尚未和好。求主亲自作工，同工们暂勿介入议论。', tag: 'other', authorName: '王大卫 David Wang', anonymous: false, prayedCount: 4, status: 'Internal', visibility: 'Staff' },
  { content: '为下季度的同工调整祷告。敬拜团与关怀组都需要增补人手，牧者会议前请各位先在祷告中寻求。', tag: 'work', authorName: '陈约翰 John Chen', anonymous: false, prayedCount: 9, status: 'Internal', visibility: 'Pastors Only' },
];

const PRAYERS = SAMPLE_PRAYERS;

/** 一个填好的教会长什么样。缺了这些，样板间顶上会一直挂着「完成教会设置 0/6」。 */
const CHURCH_PROFILE = {
  location: '123 Forest Road, Hurstville NSW 2220',
  phone: '(02) 9580 0000',
  website: 'https://demo.gracesystem.org',
  meeting_time: '主日 10:00 联合崇拜 · 周五 19:30 青年团契',
  description: '一间华人移民教会的示范档案 —— 这里的人名、排班、代祷都是虚构的，用来展示每个页面填满之后的样子。',
  // 内联 SVG，不依赖任何外部图床
  logo_url: 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="%232C2C2C"/><path d="M32 12v10M27 17h10M32 22 20 32v18h24V32L32 22Z" fill="none" stroke="%23F4F1EE" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/></svg>'
  ),
  setup_progress: { info: true, group: true, logo: true, invite: true },
};

// 用 App 本来就认得的岗位名 —— 仪表盘的排班表按这些字符串匹配列
// （见 Dashboard 的 getRoleNames），自己另起名字会导致整张表都是「—」。
export const DEFAULT_ROSTER_ROLES = [
  '讲道', '敬拜', '乐手', '吉他', '音响', '媒体', '儿童主日学', '招待', '迎宾', '厨房',
];
const ROSTER_ROLES = DEFAULT_ROSTER_ROLES;

const LIFE: { kind: string; data: any; author_name?: string }[] = [
  { kind: 'notice', data: { title: '本周主日因暴雨改为线上聚会', body: '气象局已发布暴雨预警。主日上午 10:00 请从教会公众号进入线上聚会室，爱筵取消。行动不便的长者若需要接送，请联系许恩光弟兄。', level: 'urgent' }, author_name: '陈约翰 John Chen' },
  { kind: 'notice', data: { title: '冬令营招募同工', body: '7 月 12–14 日青年冬令营，招募厨务、活动、摄影同工各 2 名，请向王大卫报名。', level: 'info' }, author_name: '王大卫 David Wang' },
  { kind: 'notice', data: { title: '停车场施工，本月改停后街', body: '教会停车场重铺，预计三周。主日请停在 Forest Rd 后街，招待同工会引导。', level: 'info' }, author_name: '黄喜乐 Joy Huang' },

  { kind: 'course', data: { title: '系统神学导读班', speaker: '陈约翰 牧师', time: '每周三 19:30，共 8 周', place: '副堂 201', capacity: 20, outline: '第一课：启示论 — 神如何向人说话\n第二课：神论 — 三位一体\n第三课：基督论 — 道成肉身\n第四课：救恩论 — 因信称义\n第五课：圣灵论\n第六课：教会论\n第七课：末世论\n第八课：总复习与答疑' }, author_name: '陈约翰 John Chen' },
  { kind: 'course', data: { title: '新信徒门徒成长班', speaker: '李美玲 传道', time: '每周日 13:00，共 6 周', place: '小堂', capacity: 12, outline: '认识救恩、读经方法、祷告生活、教会生活、奉献与服事、传福音。每课有作业，鼓励带一位朋友同来。' }, author_name: '李美玲 Mary Li' },
  { kind: 'course', data: { title: '敬拜团新人训练', speaker: '林恩慈', time: '每周六 15:00，共 4 周', place: '敬拜厅', capacity: 8, outline: '敬拜的心态、基本乐理、团队默契、主日流程实操。不要求会看谱，但要能稳定出席。' }, author_name: '林恩慈 Grace Lin' },
  { kind: 'course', data: { title: '婚前辅导（一对一）', speaker: '陈约翰牧师夫妇', time: '预约制，共 5 次', place: '牧师办公室', capacity: 6, outline: '原生家庭、沟通与冲突、金钱观、性与亲密、信仰与家庭方向。预备结婚的弟兄姊妹请提前三个月预约。' }, author_name: '陈约翰 John Chen' },
  { kind: 'course', data: { title: '长者智能手机班', speaker: '郑安德', time: '每月第二个周六 14:00', place: '副堂', capacity: 15, outline: '教长辈用微信、看线上聚会、用这个 App 签到和看周报。青年团契陪伴一对一。' }, author_name: '郑安德 Andrew Zheng' },

  { kind: 'resource', data: { cat: 'prep',   title: '主日崇拜流程表（模板）',   note: '含诗歌、经文、报告顺序，同工共用' } },
  { kind: 'resource', data: { cat: 'prep',   title: '圣餐主日流程与注意事项',   note: '每月首主日适用' } },
  { kind: 'resource', data: { cat: 'prep',   title: '受洗礼流程与誓词',         note: '含受洗者名单登记表' } },
  { kind: 'resource', data: { cat: 'sermon', title: '罗马书 8 章讲道大纲',      note: '陈约翰 牧师' } },
  { kind: 'resource', data: { cat: 'sermon', title: '罗马书系列 · 全 16 讲索引', note: '按章节整理，含每讲录音链接' } },
  { kind: 'resource', data: { cat: 'sermon', title: '节期讲道参考（圣诞 / 受难 / 复活）', note: '历年讲章汇编' } },
  { kind: 'resource', data: { cat: 'group',  title: '小组查经手册 · 约翰福音',  note: '共 21 课，附讨论问题' } },
  { kind: 'resource', data: { cat: 'group',  title: '带小组的十个常见难题',     note: '冷场、有人讲太多、有人不来…' } },
  { kind: 'resource', data: { cat: 'group',  title: '破冰游戏 30 则',           note: '适合新人多的小组' } },
  { kind: 'resource', data: { cat: 'misc',   title: '教会场地借用申请表',       note: '婚礼、追思、外借请提前两周' } },
  { kind: 'resource', data: { cat: 'misc',   title: '奉献收据申请流程',         note: '报税季节常用' } },
  { kind: 'resource', data: { cat: 'misc',   title: '紧急联络与钥匙保管名单',   note: '仅同工可见' } },

  { kind: 'lostfound', data: { kind: 'lost',  title: '黑色折叠雨伞',     note: '主日下午遗落在二楼走廊，伞柄有个小裂口。', contact: '0400 100 007' }, author_name: '黄喜乐 Joy Huang' },
  { kind: 'lostfound', data: { kind: 'lost',  title: '银色保温杯',       note: '爱筵之后就找不到了，杯身贴了小熊贴纸，是孩子的。', contact: '0400 100 008' }, author_name: '吴信实 Faith Wu' },
  { kind: 'lostfound', data: { kind: 'found', title: '儿童蓝色水壶',     note: '在主日学教室捡到，已放到接待台。', contact: '接待台' }, author_name: '吴信实 Faith Wu' },
  { kind: 'lostfound', data: { kind: 'found', title: '一副老花眼镜',     note: '深咖色框，在第三排座位下，暂由招待同工保管。', contact: '0400 100 014' }, author_name: '张丽华 Lily Zhang' },
  { kind: 'lostfound', data: { kind: 'share', title: '婴儿床免费转赠',   note: '孩子长大用不上了，成色良好，需自取。', contact: '0400 100 011' }, author_name: '孙恩典 Gift Sun' },
  { kind: 'lostfound', data: { kind: 'share', title: '搬家纸箱约 20 个', note: '刚搬完家，有需要的自取，放在教会杂物间。', contact: '0400 100 003' }, author_name: '王大卫 David Wang' },
  { kind: 'lostfound', data: { kind: 'share', title: '可以帮忙接送就医', note: '我周二周四白天有空，长辈需要去医院的可以找我。', contact: '0400 100 015' }, author_name: '许恩光 Simon Xu' },

  { kind: 'visit',  data: { name: '周新民 Simon Zhou', contact: '0400 100 010', address: 'Hurstville', reason: '刚来教会三次，想多认识弟兄姊妹，但不太好意思开口。', needs: '工作日晚上有空，周末要上班', spiritual: '慕道中，对救恩有兴趣，问过「受洗是什么意思」', status: 'scheduled', log: [] }, author_name: '李美玲 Mary Li' },
  { kind: 'visit',  data: { name: '张伯母', contact: '0400 100 099', address: 'Kogarah', reason: '髋关节手术住院两周，盼望同工探望。', needs: '需要有人代买日用品，家中无人照料', spiritual: '信心坚定，盼望有人一同祷告', status: 'visited', log: [{ at: new Date().toISOString(), by: '李美玲 Mary Li', text: '已到医院探望，一同读诗篇 23 篇并祷告，精神不错。下周出院，已安排姊妹小组轮流送餐一周。' }] }, author_name: '李美玲 Mary Li' },
  { kind: 'visit',  data: { name: '钱伯明 Ben Qian', contact: '0400 100 018', address: 'Beverly Hills', reason: '太太过世满一年，最近主日常常缺席。', needs: '独居，晚上比较难过', spiritual: '信主多年，但这段时间不太说话', status: 'requested', log: [] }, author_name: '陈约翰 John Chen' },
  { kind: 'visit',  data: { name: '赵小雨 Rain Zhao', contact: '0400 100 017', address: 'Kingsford', reason: '留学生，第一次离家过节，想找人聊聊。', needs: '没有车，需要接送', spiritual: '还没信主，郑安德带来的', status: 'scheduled', log: [] }, author_name: '郑安德 Andrew Zheng' },

  { kind: 'reading', data: { ot: 412, nt: 168 } },
];


/* ── 其余页面的示例内容 ─────────────────────────────────────────────────── */

const FINANCE = [0, 1, 2, 3].map(w => {
  const cash = 1200 + w * 137, tithe = 800 + w * 60, reim = w === 2 ? 150 : 0;
  return {
    date: nextSunday(-w - 1), cash_total: cash, tithe, reimbursement: reim,
    grand_total: cash + tithe - reim,
    details: `主日现金奉献 ${cash} · 十一奉献 ${tithe}` + (reim ? ` · 报销 ${reim}` : ''),
    signees: ['马利亚 Maria Ma', '黄喜乐 Joy Huang'],
    created_by: '马利亚 Maria Ma',
  };
});

const ACTIVITY = [
  { action: '更新了排班',       target: '主日崇拜 · 本周',       type: 'Roster',   user_name: '陈约翰 John Chen', user_role: 'Manager', note: '司琴由刘平安调整为林恩慈' },
  { action: '新增会友',         target: '孙恩典 Gift Sun',       type: 'Member',   user_name: '李美玲 Mary Li',   user_role: 'Leader',  note: '由黄喜乐邀请' },
  { action: '上传了资源',       target: '罗马书 8 章讲道大纲',   type: 'Resource', user_name: '陈约翰 John Chen', user_role: 'Manager', note: null },
  { action: '审核通过代祷事项', target: '为父亲的手术代祷',       type: 'System',   user_name: '陈约翰 John Chen', user_role: 'Manager', note: null },
  { action: '登记了探访',       target: '张伯母 · 已探访',        type: 'Member',   user_name: '李美玲 Mary Li',   user_role: 'Leader',  note: '医院探望，一同祷告' },
  { action: '开启新点收',       target: `${nextSunday(-1)} 主日奉献`, type: 'System', user_name: '马利亚 Maria Ma', user_role: 'Staff', note: null },
];


/**
 * 把示范刊物的正文做成 data: 文档。Publications 的预览是
 * `<iframe src={file_url}>`，所以塞一份自带样式的 HTML 就能直接读，
 * 不用引 PDF 库，也不用真的托管文件。
 */
function docUrl(title: string, subtitle: string, body: string[]): string {
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:48px 56px;font:16px/1.85 -apple-system,"PingFang SC","Noto Sans CJK SC",sans-serif;
         color:#2C2C2C;background:#F9F7F5;max-width:46em}
    h1{font:700 30px/1.25 Georgia,"Songti SC",serif;margin:0 0 6px}
    .sub{color:#8B7E74;font-size:13px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 32px}
    h2{font:700 19px/1.4 Georgia,"Songti SC",serif;margin:34px 0 10px}
    blockquote{margin:22px 0;padding:14px 20px;border-left:3px solid #D1CAC3;
               color:#5a5148;font-style:italic;background:#F4F1EE}
    p{margin:0 0 16px}
    hr{border:0;border-top:1px solid #E5E0DA;margin:36px 0}
    .foot{color:#8B7E74;font-size:12px}
  </style><h1>${title}</h1><p class="sub">${subtitle}</p>${body.join('')}
  <hr><p class="foot">示例教会 Grace Demo Church · 本文件为示范内容，可自由替换。</p>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

/** 免费刊物。category 必须是 Publications 页认的五个值之一。 */
export const SAMPLE_PUBLICATIONS = [
  {
    title: '恩典季刊 · 春季号', category: 'Newsletter',
    file_name: 'grace-quarterly-spring.pdf', file_size: 4.2,
    description: '本季主题「在患难中的盼望」。含牧者的话、三篇见证、各部门事工回顾，以及儿童版折页。',
    body: [
      '<h2>牧者的话</h2>',
      '<p>这个季度我们一同读罗马书第八章。保罗写这封信的时候，罗马的信徒正面对逼迫，他没有说苦难会消失，他说的是「万事都互相效力，叫爱神的人得益处」。</p>',
      '<blockquote>我想现在的苦楚，若比起将来要显于我们的荣耀，就不足介意了。（罗 8:18）</blockquote>',
      '<p>过去三个月，教会里有人失业，有人家人重病，也有人刚刚受洗。这些事同时发生，并不矛盾。盼望不是「事情会变好」，而是「神与我们同在」。</p>',
      '<h2>本季见证 · 三则</h2>',
      '<p><b>张弟兄</b>：公司裁员那两个月，我每天早上照常读经，读不进去也坐在那里。后来找到工作，回头看，那两个月学到的比工作本身多。</p>',
      '<p><b>李姊妹</b>：母亲住院期间，姊妹小组轮流送了两周的饭。我没开口求过，她们自己排的班。</p>',
      '<p><b>周弟兄</b>：我来了三次才敢跟人说话。第四次有人记得我的名字，我就留下来了。</p>',
      '<h2>各部门回顾</h2>',
      '<p>敬拜团新增两位同工；儿童主日学分成两班；关怀组完成 14 次探访；福音朋友小组平均每周 9 人，其中 4 位是新朋友。</p>',
    ],
  },
  {
    title: '新朋友手册', category: 'Other',
    file_name: 'newcomer-guide.pdf', file_size: 1.8,
    description: '教会简介、聚会时间、各团契介绍、常见问题。第一次来的朋友建议先看这本，十分钟读完。',
    body: [
      '<h2>你不需要准备什么</h2>',
      '<p>不用穿正式的衣服，不用带圣经，不用会唱诗歌。坐下来听就好。中途想出去透气也没关系。</p>',
      '<h2>主日流程大概是这样</h2>',
      '<p>10:00 开始，先唱三首诗歌（约 20 分钟），然后是报告和奉献，接着讲道 35 分钟左右，最后一起祷告。11:30 前结束，之后有爱筵，可以留下来吃饭。</p>',
      '<h2>常见问题</h2>',
      '<p><b>要奉献吗？</b>不用。奉献袋传过来直接递给下一位就好，没有人会看。</p>',
      '<p><b>我不是基督徒可以来吗？</b>可以。我们有一个「伯特利小组」就是给还在了解的朋友的，周六晚上在咖啡厅，聊天为主。</p>',
      '<p><b>孩子怎么办？</b>10:15 有儿童主日学，3 到 12 岁分两班，在二楼教室。</p>',
      '<h2>找谁问</h2>',
      '<p>门口穿深色马甲的是招待同工，问什么都可以。或者直接找黄喜乐姊妹。</p>',
    ],
  },
  {
    title: '受洗预备课程讲义', category: 'Bible Study',
    file_name: 'baptism-course.pdf', file_size: 2.6,
    description: '六课讲义，配合新信徒门徒成长班使用。每课附经文、讨论问题与一周作业。',
    body: [
      '<h2>第一课　我为什么需要救恩</h2>',
      '<p>经文：罗马书 3:23、6:23。</p>',
      '<p>讨论：你第一次意识到「自己做不到」是什么时候？那种感觉和圣经说的「罪」有什么关系？</p>',
      '<p>作业：写下三件你希望被改变、但靠自己改不了的事。不用交，下次带来。</p>',
      '<h2>第二课　受洗是什么意思</h2>',
      '<p>经文：罗马书 6:3–4。受洗不是仪式的完成，是身份的宣告——旧的那个我埋葬了，新的我站起来。</p>',
      '<p>讨论：如果受洗之后生活没有立刻变好，你会怎么想？</p>',
      '<h2>第三至六课</h2>',
      '<p>读经方法、祷告生活、教会生活、传福音。每课约 45 分钟，鼓励带一位朋友同来。</p>',
    ],
  },
  {
    title: '罗马书查经手册', category: 'Bible Study',
    file_name: 'romans-study.pdf', file_size: 5.4,
    description: '全书十六章，按段落分 24 课。小组长版另附带组提示与常见问题解答。',
    body: [
      '<h2>使用方法</h2>',
      '<p>每课约 60 分钟：读经 10 分钟，讨论 35 分钟，祷告 15 分钟。不要赶进度，一次讨论透一个问题好过走完三个。</p>',
      '<h2>第 12 课　罗马书 8:18–30</h2>',
      '<p><b>破冰</b>：最近一件让你觉得「等不下去」的事。</p>',
      '<p><b>观察</b>：18–25 节出现了几次「叹息」？分别是谁在叹息？</p>',
      '<p><b>解释</b>：26 节说圣灵「用说不出来的叹息替我们祷告」。这对「我不会祷告」的人意味着什么？</p>',
      '<p><b>应用</b>：28 节常被拿来安慰人，但它的对象是谁？（注意「爱神的人」这个限定）</p>',
      '<h2>给小组长</h2>',
      '<p>这一课容易滑向廉价安慰。如果组里有人正在苦难中，先让他说完，不要急着引用 28 节。有时候陪着叹息就是最像圣灵的事。</p>',
    ],
  },
  {
    title: '每日灵修 · 诗篇三十天', category: 'Devotional',
    file_name: 'psalms-30-days.pdf', file_size: 3.1,
    description: '一天一篇，含经文、默想问题与祷告范文。适合刚开始建立灵修习惯的弟兄姊妹。',
    body: [
      '<h2>第一天　诗篇 1 篇</h2>',
      '<blockquote>他要像一棵树栽在溪水旁，按时候结果子，叶子也不枯干。（诗 1:3）</blockquote>',
      '<p><b>默想</b>：树不能决定自己长在哪里，但人可以决定自己扎根在哪里。你现在的生活，根扎在什么上面？</p>',
      '<p><b>祷告</b>：主啊，我常把根扎在别人的评价里，风一吹就摇。求你把我栽在你的话语旁边。阿们。</p>',
      '<h2>第七天　诗篇 23 篇</h2>',
      '<blockquote>我虽然行过死荫的幽谷，也不怕遭害，因为你与我同在。（诗 23:4）</blockquote>',
      '<p><b>默想</b>：注意大卫没有说「你带我绕过幽谷」，是「行过」。神应许的是同在，不是免除。</p>',
      '<h2>怎么用这本册子</h2>',
      '<p>建议固定时间，五分钟就够。漏了一天不要补两天，直接接着今天读——习惯比进度重要。</p>',
    ],
  },
  {
    title: '讲道集 · 登山宝训系列', category: 'Sermon',
    file_name: 'sermon-on-the-mount.pdf', file_size: 6.8,
    description: '陈约翰牧师马太福音 5–7 章共十二讲的讲章整理，含每讲的经文大纲。',
    body: [
      '<h2>第一讲　虚心的人有福了（太 5:1–12）</h2>',
      '<p>大纲：一、「有福」不是心情好；二、八福描述的是同一种人的八个侧面；三、这不是入场券，是身份证。</p>',
      '<p>「虚心」原文是「灵里贫穷」——知道自己一无所有的人。这不是谦虚的美德，是诚实的自觉。</p>',
      '<h2>第五讲　不要论断人（太 7:1–5）</h2>',
      '<p>大纲：一、论断与分辨的差别；二、梁木为什么看不见；三、「先去掉自己眼中的梁木」不是不管别人，是先能看清。</p>',
      '<h2>第十二讲　把房子盖在磐石上（太 7:24–27）</h2>',
      '<p>两座房子外表一样，差别在地基，而地基是看不见的。雨没来的时候，谁也分不出来。</p>',
    ],
  },
  {
    title: '亲子灵修 · 睡前十分钟', category: 'Devotional',
    file_name: 'family-devotion.pdf', file_size: 2.9,
    description: '给学龄前到小学的家庭。每晚一个圣经小故事加一个问题，爸妈可以直接照着念。',
    body: [
      '<h2>怎么用</h2>',
      '<p>睡前关灯之前，念一段（约两分钟），问一个问题，一起祷告一句。不用讲道理，不用要求孩子答对。</p>',
      '<h2>第三晚　挪亚造方舟</h2>',
      '<p><b>念给孩子听</b>：神叫挪亚造一条很大很大的船。邻居都笑他，因为那时候一滴雨都没下。挪亚还是一直造，造了很久很久。</p>',
      '<p><b>问一句</b>：如果别人笑你做的事，你还会做下去吗？</p>',
      '<p><b>一起祷告</b>：神啊，谢谢你看顾挪亚一家。也求你看顾我们家。阿们。</p>',
      '<h2>第十晚　大卫和歌利亚</h2>',
      '<p><b>问一句</b>：大卫那么小，为什么不害怕？（提示：他想的不是自己有多小，是神有多大）</p>',
    ],
  },
  {
    title: '年度事工报告', category: 'Other',
    file_name: 'annual-report.pdf', file_size: 5.1,
    description: '各部门全年事工回顾、出席与奉献摘要、明年方向。会员大会资料。',
    body: [
      '<h2>一年概况</h2>',
      '<p>主日平均出席 128 人（去年 114）。全年受洗 11 位，新加入 23 人。小组从 2 个增加到 3 个，参与率约六成。</p>',
      '<h2>财务摘要</h2>',
      '<p>全年奉献收入 $186,400，支出 $171,900，结余 $14,500 转入场地基金（累计 $63,200）。明细见会员大会附件。</p>',
      '<h2>明年三个方向</h2>',
      '<p>一、场地。现有租约明年到期，房东提出加租三成，同工会正在寻找替代方案。</p>',
      '<p>二、第二代。青少年逐渐长大，需要中英双语的青少契，目前缺一位固定负责的同工。</p>',
      '<p>三、关怀。今年探访 14 次，但仍有长者长期缺席未被跟进。计划把关怀组扩充到 6 人。</p>',
    ],
  },
].map(p => ({ ...p, file_url: docUrl(p.title, p.category, p.body) }));

// 一律用公有领域的古典圣诗，只放开头一两行作示意，避免版权问题
const SONGS = [
  { title: '奇异恩典 Amazing Grace',        key: 'G', lyrics: 'Amazing grace! how sweet the sound,\nThat saved a wretch like me!\n\n（示例：完整歌词请自行录入）' },
  { title: '三一颂 Doxology',               key: 'F', lyrics: 'Praise God, from whom all blessings flow;\nPraise Him, all creatures here below.\n\n（示例：完整歌词请自行录入）' },
  { title: '圣哉、圣哉、圣哉 Holy, Holy, Holy', key: 'D', lyrics: 'Holy, holy, holy! Lord God Almighty!\nEarly in the morning our song shall rise to Thee.\n\n（示例：完整歌词请自行录入）' },
  { title: '我心灵得安宁 It Is Well',        key: 'C', lyrics: 'When peace like a river attendeth my way,\nWhen sorrows like sea billows roll.\n\n（示例：完整歌词请自行录入）' },
  { title: '这是天父世界 This Is My Father\'s World', key: 'D', lyrics: 'This is my Father\'s world,\nAnd to my listening ears all nature sings.\n\n（示例：完整歌词请自行录入）' },
];


export const SAMPLE_GROUP_POSTS: Record<string, { type: string; content: string; author: string }[]> = {
  '葡萄树小组': [
    { type: 'text', content: '本周五查经到罗马书第八章，请先读 1–17 节。聚会后照例有宵夜 🍜', author: '王大卫 David Wang' },
    { type: 'text', content: '我可以带二十个饺子来，不用另外买了', author: '刘平安 Peace Liu' },
    { type: 'text', content: '下周五轮到郑安德带敬拜，还缺一位帮忙架音响的，有空的举手 🙋', author: '王大卫 David Wang' },
    { type: 'text', content: '我可以，那天不用加班', author: '张保罗 Paul Zhang' },
    { type: 'text', content: '上周分享「万事互相效力」之后我想了很久。最近工作上的事一直过不去，但那句话让我安静下来了，谢谢大家陪我祷告。', author: '郑安德 Andrew Zheng' },
  ],
  '以便以谢小组': [
    { type: 'text', content: '周二上午聚会改到 10:00，地点还是副堂。带孩子的姊妹可以把孩子交给主日学教室，吴信实会帮忙看。', author: '李美玲 Mary Li' },
    { type: 'text', content: '收到，我这周会带一盘水果过去', author: '张丽华 Lily Zhang' },
    { type: 'text', content: '感谢主，上周为陈姊妹产检的代祷已蒙应允，母子平安 🙏', author: '李美玲 Mary Li' },
    { type: 'text', content: '太好了！等她出月子我们去看看她', author: '何静文 Jenny He' },
    { type: 'text', content: '本月爱筵由我们组预备，需要四位帮厨。预算 $250，黄姊妹会陪我一起采买。', author: '马利亚 Maria Ma' },
  ],
  '伯特利小组': [
    { type: 'text', content: '这周聊「苦难与盼望」，欢迎带还没信主的朋友来，不需要任何基础，就是喝咖啡聊天 ☕', author: '黄喜乐 Joy Huang' },
    { type: 'text', content: '我可以带我室友来吗？他最近压力很大', author: '赵小雨 Rain Zhao' },
    { type: 'text', content: '当然可以，越多人越好。地点在教会对面那家咖啡厅，我提前占位子', author: '黄喜乐 Joy Huang' },
    { type: 'text', content: '上次听完大家分享，我第一次觉得教会没有那么难进。谢谢你们没有一上来就要我信什么。', author: '周新民 Simon Zhou' },
    { type: 'text', content: '需要接送的说一声，我周六晚上有车', author: '许恩光 Simon Xu' },
  ],
};

/**
 * 任务、周报、奉献、我们的教会这几页是纯 localStorage 的（Tasks 甚至完全
 * 不碰数据库 —— church_tasks 全项目没有任何代码读它），服务端灌不进去，
 * 只能在这里补。
 *
 * force = true 时覆盖已有值：那是用户点「填充示例内容」的显式动作，
 * 等同重置。进门时的自动调用则不覆盖，免得抹掉参观者随手改的东西。
 */
export function seedLocalSampleData(force = false) {
  const cid = DEMO_CHURCH_ID;
  const put = (key: string, value: any) => {
    try { if (force || !localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value)); } catch {}
  };

  put(`tasks_${cid}`, SAMPLE_TASKS());

  put(`giving_settings_${cid}`, { bsb: '062-000', accNo: '1234 5678' });

  // 我们的教会 · 每周聚会时间表 —— 一个负责人真正会填进去的样子
  put(`about_schedule_${cid}`, [
    { name: '主日崇拜',       time: '周日 10:00–11:30', loc: '主堂',      contact: '陈约翰 牧师', note: '会后爱筵，欢迎新朋友留下' },
    { name: '儿童主日学',     time: '周日 10:15–11:15', loc: '二楼教室',  contact: '吴信实',      note: '3–12 岁分两班' },
    { name: '姊妹小组',       time: '周二 10:00–11:30', loc: '副堂',      contact: '李美玲',      note: '可带小孩，有人帮忙看顾' },
    { name: '祷告会',         time: '周三 19:30–20:30', loc: '副堂 201',  contact: '陈约翰 牧师', note: '线上同步，链接见群公告' },
    { name: '系统神学导读班', time: '周三 19:30–21:00', loc: '副堂 201',  contact: '陈约翰 牧师', note: '共 8 周，需报名' },
    { name: '青年团契',       time: '周五 19:30–21:30', loc: '青年厅',    contact: '王大卫',      note: '18–30 岁，查经＋宵夜' },
    { name: '敬拜团练习',     time: '周六 15:00–17:00', loc: '敬拜厅',    contact: '林恩慈',      note: '主日事奉同工必到' },
    { name: '福音朋友小组',   time: '周六 19:00–20:30', loc: '咖啡厅',    contact: '黄喜乐',      note: '慕道友专属，轻松聊信仰' },
  ]);

  put(`about_corevalues_${cid}`, {
    heading: '我们看重的三件事',
    items: [
      { title: '扎根真理 / Rooted',  desc: '不追热闹。讲台按卷查经，小组跟着讲道走，让每个人都能自己读懂圣经。' },
      { title: '彼此相顾 / Together', desc: '移民生活不容易。有人生病、失业、孩子出状况，教会要第一时间知道，并且真的到场。' },
      { title: '走出去 / Sent',       desc: '福音不是留在会堂里的。邻里、职场、校园，是我们平日的禾场。' },
    ],
  });

  // 首页 · 本周讲道
  put(`sermon_${cid}`, {
    title: '在患难中的盼望 — 罗马书 8:18–30',
    description: '苦难不会因为信主就消失，但它不再是终点。这周我们看保罗如何在受苦中说「万事互相效力」，以及圣灵怎样为说不出话的我们代求。',
    link: '',
  });

  put(`bulletin_v3_${cid}`, {
    churchName: DEMO_CHURCH_NAME,
    date: nextSunday(0),
    issueNo: '2026-14',
    meetingTime: '主日 10:00',
    address: CHURCH_PROFILE.location,
    phone: CHURCH_PROFILE.phone,
    website: CHURCH_PROFILE.website,
    sermonTitle: '在患难中的盼望',
    preacher: '陈约翰 牧师',
    scripture: '罗马书 8:18–30',
    scriptureText: '我想现在的苦楚，若比起将来要显于我们的荣耀，就不足介意了。',
    hymns: [
      { name: '奇异恩典', number: '1' },
      { name: '圣哉、圣哉、圣哉', number: '2' },
      { name: '三一颂', number: '3' },
    ],
    sermonPoints: ['一、苦难不是终点', '二、圣灵亲自的代求', '三、万事都互相效力'],
    schedule: [
      { role: '讲员', name: '陈约翰' }, { role: '主领', name: '林恩慈' },
      { role: '司琴', name: '刘平安' }, { role: '音响', name: '张保罗' },
      { role: '投影', name: '郑安德' }, { role: '招待', name: '黄喜乐' },
    ],
    announcements: [
      '下周主日举行圣餐，请弟兄姊妹预备己心。',
      '受洗班开始报名，请向李美玲传道登记。',
      '本月爱筵由姊妹小组预备，欢迎自由奉献。',
    ],
    activities: [
      { name: '系统神学导读班', time: '每周三 19:30', place: '副堂 201' },
      { name: '青年团契查经',   time: '每周五 19:30', place: '青年厅' },
    ],
    offering: '$2,180',
    attendance: '132',
    prayerRequests: ['为受洗班的学员祷告', '为张伯母的康复祷告', '为冬令营的预备祷告'],
    dailyReading: '罗马书 8–12 章',
    memoryVerse: '我们晓得万事都互相效力，叫爱神的人得益处。（罗 8:28）',
    pastorMessage: '亲爱的弟兄姊妹，本周我们一同思想患难中的盼望⋯⋯',
  });
}

/* ── 重置 ─────────────────────────────────────────────────────────────── */

export interface SeedResult { table: string; rows: number; error?: string }

/** 每张表单独 try —— 某张表不存在/列对不上时只跳过它，不拖垮整次重置。 */
async function wipeAndInsert(table: string, rows: any[]): Promise<SeedResult> {
  try {
    const { error: delErr } = await supabase.from(table).delete().eq('church_id', DEMO_CHURCH_ID);
    if (delErr) return { table, rows: 0, error: delErr.message };
    if (!rows.length) return { table, rows: 0 };
    const { data, error } = await supabase.from(table).insert(rows).select('id');
    if (error) {
      // 42501 = 违反行级安全策略。这个项目里最常见的成因是某张表 RLS 开着
      // 但一条策略都没有（fix_database.sql 用了 Postgres 不支持的
      // CREATE POLICY IF NOT EXISTS，脚本在那一行就中断了）。
      const hint = error.code === '42501'
        ? '（RLS 拒绝 — 跑一次 supabase_repair_demo.sql）'
        : '';
      return { table, rows: 0, error: `${error.message}${hint}` };
    }
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

  // 纯 localStorage 的那几页（任务 / 周报 / 奉献 / 我们的教会 / 本周讲道）
  // 强制重写 —— 点这个按钮就是显式的重置动作。
  seedLocalSampleData(true);

  // 教会记录本身（SQL 脚本已建好，这里只补名字，跑过就当没事）
  // 整份资料一次写；某个列在这套库里不存在时退回只写必须的两项，
  // 不能因为一个可选列把整次重置搞失败。
  // 可选列是各版本补丁陆续加的，不同库里未必都有。逐级降级，别让一列
  // 不存在就把整条教会记录的更新废掉。
  const attempts: [string, any][] = [
    ['full',  { name: DEMO_CHURCH_NAME, roster_roles: DEFAULT_ROSTER_ROLES, ...CHURCH_PROFILE }],
    ['roles', { name: DEMO_CHURCH_NAME, roster_roles: DEFAULT_ROSTER_ROLES }],
    ['name',  { name: DEMO_CHURCH_NAME }],
  ];
  let churchDone = '', churchErr = '';
  for (const [label, patch] of attempts) {
    const { error } = await supabase.from('churches').update(patch).eq('id', cid);
    if (!error) { churchDone = label; break; }
    churchErr = error.message;
  }
  out.push(churchDone === 'full'
    ? { table: 'churches', rows: 1 }
    : { table: 'churches', rows: churchDone ? 1 : 0, error: churchDone ? `仅写入 ${churchDone}：${churchErr}` : churchErr });

  // 成员要先写，排班要用它们的 id
  const memberRows = MEMBERS.map(m => ({ ...m, church_id: cid, family: SAMPLE_GROUP_OF[m.name.split(' ')[0]] || m.family, joined: daysFromNow(-Math.floor(Math.random() * 900) - 30) }));
  await supabase.from('church_members').delete().eq('church_id', cid);
  const { data: members, error: memErr } = await supabase.from('church_members').insert(memberRows).select('id, name, status');
  out.push({ table: 'church_members', rows: members?.length ?? 0, error: memErr?.message });

  out.push(await wipeAndInsert('church_events', EVENTS.map(e => ({ ...e, church_id: cid }))));

  out.push(await wipeAndInsert('church_prayers', PRAYERS.map(p => ({
    church_id: cid, content: p.content, tag: p.tag, anonymous: p.anonymous,
    author_name: p.anonymous ? 'Anonymous' : p.authorName,
    author_email: '', visibility: p.visibility, status: p.status, prayed_count: p.prayedCount,
  }))));

  out.push(await wipeAndInsert('church_life', LIFE.map(l => ({
    church_id: cid, kind: l.kind, data: l.data, author_id: null, author_name: l.author_name ?? null,
  }))));

  out.push(await wipeAndInsert('church_finance', FINANCE.map(f => ({ ...f, church_id: cid }))));
  out.push(await wipeAndInsert('activity_logs', ACTIVITY.map(a => ({ ...a, church_id: cid, user_id: null }))));
  out.push(await wipeAndInsert('church_publications', SAMPLE_PUBLICATIONS.map(p => ({
    title: p.title, description: p.description, category: p.category,
    file_name: p.file_name, file_size: `${p.file_size}MB`, file_url: p.file_url,
    church_id: cid, created_by: '陈约翰 John Chen',
  }))));
  out.push(await wipeAndInsert('songs', SONGS.map(x => ({ ...x, church_id: cid }))));

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

    // 出勤：过去四个主日
    const ids = members.map((m: any) => m.id);
    out.push(await wipeAndInsert('attendance_records', [0, 1, 2, 3].map(w => ({
      church_id: cid,
      service_date: nextSunday(-w - 1),
      headcount: 132 - w * 6,
      notes: w === 0 ? '爱筵由姊妹小组预备' : '',
      present_member_ids: ids.slice(0, ids.length - w),
      created_by: '黄喜乐 Joy Huang',
    }))));
  }

  return out;
}

/* ── 复制到我的教会 ───────────────────────────────────────────────────────
   示例教会是只读的，用户看中什么就把「结构」复制进自己的教会。
   刻意只复制骨架，不复制假人和假代祷 —— 往真实名册里灌 12 个虚构会友
   是在给人添乱，而不是帮忙。
   ────────────────────────────────────────────────────────────────────── */

export type CopyKind = 'roster_roles' | 'course' | 'resource';

export const COPY_KINDS: { kind: CopyKind; zh: string; en: string }[] = [
  { kind: 'roster_roles', zh: '排班岗位设置', en: 'Roster roles' },
  { kind: 'course',       zh: '课程大纲',     en: 'Course outlines' },
  { kind: 'resource',     zh: '资源目录',     en: 'Resource library' },
];

/** total = 示例教会里这一类总共有几项；用来把「源是空的」和「你已经有了」区分开。 */
/** 数据库连不上时别把按钮永远卡在「复制中」。 */
function withTimeout<T>(p: PromiseLike<T>, ms = 8000): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

export interface CopyResult { copied: number; skipped: number; total: number; error?: string }

/**
 * 把示例教会的某一类结构复制进目标教会。
 *
 * - 岗位设置走并集，不覆盖用户已有的岗位；
 * - 课程/资源按标题去重，重复的跳过，所以重复点不会灌出一堆副本；
 * - 复制进来的行带 from_sample 标记，将来要清理找得到。
 */
export async function copyFromSample(kind: CopyKind, targetChurchId: string): Promise<CopyResult> {
  if (!targetChurchId || targetChurchId === DEMO_CHURCH_ID) {
    return { copied: 0, skipped: 0, total: 0, error: 'no target church' };
  }

  try {
    if (kind === 'roster_roles') {
      const [{ data: sample }, { data: mine }] = await withTimeout(Promise.all([
        supabase.from('churches').select('roster_roles').eq('id', DEMO_CHURCH_ID).maybeSingle(),
        supabase.from('churches').select('roster_roles').eq('id', targetChurchId).maybeSingle(),
      ]));
      const from: string[] = (sample as any)?.roster_roles || DEFAULT_ROSTER_ROLES;
      const existing: string[] = (mine as any)?.roster_roles || [];
      const added = from.filter(r => !existing.includes(r));
      if (!added.length) return { copied: 0, skipped: from.length, total: from.length };
      const { error } = await withTimeout(supabase.from('churches')
        .update({ roster_roles: [...existing, ...added] }).eq('id', targetChurchId));
      if (error) return { copied: 0, skipped: 0, total: from.length, error: error.message };
      return { copied: added.length, skipped: from.length - added.length, total: from.length };
    }

    const [{ data: sample }, { data: mine }] = await withTimeout(Promise.all([
      supabase.from('church_life').select('kind, data').eq('church_id', DEMO_CHURCH_ID).eq('kind', kind),
      supabase.from('church_life').select('data').eq('church_id', targetChurchId).eq('kind', kind),
    ]));
    const have = new Set((mine || []).map((r: any) => r.data?.title));
    const rows = (sample || [])
      .filter((r: any) => r.data?.title && !have.has(r.data.title))
      .map((r: any) => ({
        church_id: targetChurchId, kind,
        data: { ...r.data, from_sample: true },
        author_id: null, author_name: null,
      }));
    const total = (sample || []).length;
    const skipped = total - rows.length;
    if (!rows.length) return { copied: 0, skipped, total };
    const { error } = await withTimeout(supabase.from('church_life').insert(rows));
    if (error) return { copied: 0, skipped, total, error: error.message };
    return { copied: rows.length, skipped, total };
  } catch (e: any) {
    return { copied: 0, skipped: 0, total: 0, error: e?.message || String(e) };
  }
}


/* ── 消息 · 联系人与对话 ─────────────────────────────────────────────────
   Messages 页的联系人来自 profiles（登录账号），示例教会里没有。这里给一份
   常量名册，role 用 Messages 的 ROLE_GROUPS 认的四个值，四组都占上，
   分组标题才不会是空的。
   ────────────────────────────────────────────────────────────────────── */

export const SAMPLE_VISITS = [
  { name: '周新民 Simon Zhou', contact: '0400 100 010', address: 'Hurstville', reason: '刚来教会三次，想多认识弟兄姊妹，但不太好意思开口。', needs: '工作日晚上有空，周末要上班', spiritual: '慕道中，对救恩有兴趣，问过「受洗是什么意思」', status: 'scheduled', by: '李美玲 Mary Li', log: [] as { at: string; by: string; text: string }[] },
  { name: '张伯母', contact: '0400 100 099', address: 'Kogarah', reason: '髋关节手术住院两周，盼望同工探望。', needs: '需要有人代买日用品，家中无人照料', spiritual: '信心坚定，盼望有人一同祷告', status: 'visited', by: '李美玲 Mary Li', log: [{ at: new Date(Date.now() - 2 * 864e5).toISOString(), by: '李美玲 Mary Li', text: '已到医院探望，一同读诗篇 23 篇并祷告，精神不错。下周出院，已安排姊妹小组轮流送餐一周。' }] },
  { name: '钱伯明 Ben Qian', contact: '0400 100 018', address: 'Beverly Hills', reason: '太太过世满一年，最近主日常常缺席。', needs: '独居，晚上比较难过', spiritual: '信主多年，但这段时间不太说话', status: 'requested', by: '陈约翰 John Chen', log: [] },
  { name: '赵小雨 Rain Zhao', contact: '0400 100 017', address: 'Kingsford', reason: '留学生，第一次离家过节，想找人聊聊。', needs: '没有车，需要接送', spiritual: '还没信主，郑安德带来的', status: 'scheduled', by: '郑安德 Andrew Zheng', log: [] },
  { name: '林伯父夫妇', contact: '0400 100 077', address: 'Carlton', reason: '两位都七十多了，上周主日在教会门口滑了一跤，虽无大碍但家人担心。', needs: '希望有人每周打个电话问候', spiritual: '受洗二十多年，近年听力退化，聚会常听不清', status: 'visited', by: '许恩光 Simon Xu', log: [{ at: new Date(Date.now() - 5 * 864e5).toISOString(), by: '许恩光 Simon Xu', text: '上门看过，膝盖已无碍。已协调主日接送，并向敬拜团反映把字幕字号调大。' }] },
  { name: '吴姊妹一家', contact: '0400 100 088', address: 'Rockdale', reason: '先生上月失业，两个孩子还在念小学，家里气氛紧张。', needs: '暂时的生活支援；先生想找仓管或司机的工作', spiritual: '姊妹信主，先生尚未；不希望被太多人知道', status: 'requested', by: '李美玲 Mary Li', log: [] },
];

export const SAMPLE_CONTACTS = [
  { id: 'dm-chen',   name: '陈约翰 John Chen',   role: 'Manager' },
  { id: 'dm-ruth',   name: '陈师母 Ruth Chen',   role: 'Manager' },
  { id: 'dm-grace',  name: '林恩慈 Grace Lin',   role: 'Leader'  },
  { id: 'dm-david',  name: '王大卫 David Wang',  role: 'Leader'  },
  { id: 'dm-mary',   name: '李美玲 Mary Li',     role: 'Leader'  },
  { id: 'dm-joy',    name: '黄喜乐 Joy Huang',   role: 'Staff'   },
  { id: 'dm-faith',  name: '吴信实 Faith Wu',    role: 'Staff'   },
  { id: 'dm-lily',   name: '张丽华 Lily Zhang',  role: 'Staff'   },
  { id: 'dm-paul',   name: '张保罗 Paul Zhang',  role: 'Member'  },
  { id: 'dm-peace',  name: '刘平安 Peace Liu',   role: 'Member'  },
  { id: 'dm-andrew', name: '郑安德 Andrew Zheng', role: 'Member' },
  { id: 'dm-maria',  name: '马利亚 Maria Ma',    role: 'Member'  },
];

/** 联系人 id → 该会话的往来消息。`me` 表示当前参观者发的。 */
export const SAMPLE_DMS: Record<string, { from: 'me' | 'them'; text: string }[]> = {
  'dm-chen': [
    { from: 'them', text: '姊妹平安。这周主日讲罗马书第八章，我想请你在证道后做个三分钟的回应分享，方便吗？' },
    { from: 'me',   text: '牧师平安，可以的。需要我先把稿子给您看一下吗？' },
    { from: 'them', text: '不用那么正式，讲你自己的经历就好。真实比工整重要。' },
    { from: 'them', text: '另外受洗班那三位，麻烦你这周也帮忙跟进一下见证稿。' },
  ],
  'dm-mary': [
    { from: 'them', text: '关于周新民弟兄，他连着来了三次但都是自己坐后排，我想约他吃个饭。' },
    { from: 'me',   text: '好，需要我一起去吗？他好像跟你比较熟。' },
    { from: 'them', text: '第一次我先单独去，太多人他会紧张。之后再一起。' },
    { from: 'them', text: '还有张伯母下周出院，姊妹小组排了一周的送餐班表，我等下发给你。' },
  ],
  'dm-david': [
    { from: 'me',   text: '冬令营的同工报名怎么样了？' },
    { from: 'them', text: '厨务两位满了，活动还差一位，摄影郑安德接了。' },
    { from: 'them', text: '场地押金要下周付，我先垫上还是走教会账？' },
    { from: 'me',   text: '走教会账，我跟马利亚说一声。' },
  ],
  'dm-joy': [
    { from: 'them', text: '这周爱筵大概六十人，预算 $250 够吗？' },
    { from: 'me',   text: '够的。收据记得留给财务组。' },
    { from: 'them', text: '收到 👌 另外二楼走廊捡到一把黑伞，已经登记在失物招领了。' },
  ],
  'dm-grace': [
    { from: 'them', text: '主日的诗歌我改了一首，把第三首换成《这是天父世界》，跟讲道题目更配。' },
    { from: 'me',   text: '好，PPT 我让张保罗那边同步改。' },
    { from: 'them', text: '谢谢！周六练习 15:00 开始，麻烦提醒一下新来的两位。' },
  ],
};


/* ── 仪表盘 · 今日灵修 / 人员 / 服务排班 ─────────────────────────────────
   这几块都读数据库（church_life、profiles、rosters），示例教会里要么空、
   要么取决于点没点过「填充示例内容」。统一给常量。
   ────────────────────────────────────────────────────────────────────── */

/** 确定性伪随机：同一天打开看到的热力图一样，不会每次刷新都在跳。 */
function seeded(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * 一整年的打卡记录。热力图画的是 53 周（约 371 天），少于这个数左边就会
 * 空一片。密度做成梯度：一年前刚开始、断断续续，越近越稳定。
 */
export function sampleCheckins(userId: string) {
  const out: { date: string; type: 'read' | 'pray' | 'devotion' | 'sunday'; user_id: string }[] = [];
  const types = ['read', 'pray', 'devotion'] as const;
  const SPAN = 378; // 比热力图的 371 天多一点，保证最左边也铺满
  for (let back = 0; back < SPAN; back++) {
    const d = new Date();
    d.setDate(d.getDate() - back);
    const key = dayKey(d);
    if (back === 0) {
      types.forEach(t => out.push({ date: key, type: t, user_id: userId }));
      continue;
    }
    // 一年前约两成，近期约八成五 —— 看得出「慢慢养成习惯」的过程
    const density = 0.85 - (back / SPAN) * 0.65;
    types.forEach((t, i) => {
      if (seeded(back * 3 + i) < density) out.push({ date: key, type: t, user_id: userId });
    });
    if (d.getDay() === 0 && seeded(back) < 0.85) out.push({ date: key, type: 'sunday', user_id: userId });
  }
  return out;
}

export const SAMPLE_NOTICES = [
  { title: '本周主日因暴雨改为线上聚会', level: 'urgent', body: '气象局已发布暴雨预警。主日上午 10:00 请从教会公众号进入线上聚会室，爱筵取消。行动不便的长者若需要接送，请联系许恩光弟兄。', by: '陈约翰 John Chen' },
  { title: '冬令营招募同工', level: 'info', body: '7 月 12–14 日青年冬令营，招募厨务、活动、摄影同工各 2 名，请向王大卫报名。', by: '王大卫 David Wang' },
  { title: '停车场施工，本月改停后街', level: 'info', body: '教会停车场重铺，预计三周。主日请停在 Forest Rd 后街，招待同工会引导。', by: '黄喜乐 Joy Huang' },
];

/** 本月每个主日 + 往后四个主日的排班；仪表盘看的是本月，只排未来会一片空。 */
export function sampleRoster() {
  // 每个岗位备两三个人轮着来，看起来才像真的排班表而不是复制粘贴
  const pool: Record<string, string[]> = {
    '讲道':       ['陈约翰 John Chen', '王大卫 David Wang', '李美玲 Mary Li'],
    '敬拜':       ['林恩慈 Grace Lin', '郑安德 Andrew Zheng'],
    '乐手':       ['刘平安 Peace Liu', '林恩慈 Grace Lin'],
    '吉他':       ['王大卫 David Wang', '郑安德 Andrew Zheng'],
    '音响':       ['张保罗 Paul Zhang', '许恩光 Simon Xu'],
    '媒体':       ['郑安德 Andrew Zheng', '何静文 Jenny He'],
    '儿童主日学': ['吴信实 Faith Wu', '张丽华 Lily Zhang'],
    '招待':       ['黄喜乐 Joy Huang', '张丽华 Lily Zhang', '许恩光 Simon Xu'],
    '迎宾':       ['孙恩典 Gift Sun', '赵小雨 Rain Zhao'],
    '厨房':       ['陈师母 Ruth Chen', '马利亚 Maria Ma', '何静文 Jenny He'],
  };


  const staffById: Record<string, string> = {};
  const staffList = MEMBERS.map(m => {
    const id = `demo-staff-${m.initials}-${m.phone.slice(-3)}`;
    staffById[id] = m.name;
    return { id, name: m.name, initials: m.initials, role: m.role.join(' / ') || m.occupation };
  });
  const idOf = (name: string) => staffList.find(s => s.name === name)?.id || '';

  // 本月 1 号到往后四周之间的所有主日
  const sundays: string[] = [];
  const cur = new Date();
  const d = new Date(cur.getFullYear(), cur.getMonth(), 1);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); // 本月第一个主日
  const end = new Date();
  end.setDate(end.getDate() + 28);
  for (; d <= end; d.setDate(d.getDate() + 7)) sundays.push(iso(d));

  const assignments: Record<string, { staffId: string; role: string }[]> = {};
  sundays.forEach((date, w) => {
    assignments[date] = DEFAULT_ROSTER_ROLES
      .map(role => {
        const cands = pool[role] || [];
        return { staffId: idOf(cands[w % cands.length] || ''), role };
      })
      .filter(a => a.staffId);
  });

  return { staffList: staffList.map(({ name, initials, role }) => ({ name, initials, role })), staffById, assignments };
}


/**
 * 每周主日人数。给一整年（52 个主日），带缓慢上升的趋势 + 每周的自然
 * 波动 + 节期高峰（复活节 / 圣诞前后），这样出勤表和折线才看得出变化。
 */
export function sampleAttendance(memberIds: string[] = []) {
  const out: { service_date: string; headcount: number; notes: string; present_member_ids: string[]; created_by: string }[] = [];
  const NOTES: Record<number, string> = {
    0:  '爱筵由姊妹小组预备',
    3:  '受洗见证会，三位受洗',
    7:  '暴雨，改为线上聚会同步',
    12: '联合圣餐主日',
    20: '长者关怀主日，安排了接送',
    31: '青年主日，团契负责整场',
  };

  // 从今天往回数 52 个主日
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 7) % 7)); // 最近的主日（含今天）
  for (let w = 0; w < 52; w++) {
    const date = new Date(d);
    date.setDate(date.getDate() - w * 7);
    // 一年前约 100 人，稳步长到约 130；叠加 ±8 的周波动
    const trend = 130 - (w / 52) * 30;
    const wobble = (seeded(w * 7.7) - 0.5) * 10; // ±5，再大就盖过趋势变成噪点
    const peak = (w === 13 || w === 39) ? 28 : 0; // 复活节 / 圣诞那两周
    const headcount = Math.max(60, Math.round(trend + wobble + peak));
    // 到会名单取前若干位，人数对得上就行
    const present = memberIds.slice(0, Math.min(memberIds.length, Math.round(headcount / 8)));
    out.push({
      service_date: iso(date),
      headcount,
      notes: NOTES[w] || '',
      present_member_ids: present,
      created_by: '黄喜乐 Joy Huang',
    });
  }
  return out;
}
