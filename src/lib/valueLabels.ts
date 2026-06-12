// Central translations for stored DATA VALUES (roles, skills, status, visibility).
// Stored values stay English in the DB; this only changes how they're displayed.
// Note: ja / ko / th are best-effort — a native speaker review is recommended.

type Lang = 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'th';

// Shared ministry/skill list — used by BOTH onboarding and the Members page
// so the two stay in sync. (Custom = a user-entered tag.)
export const MINISTRY_SKILLS = [
  'Sunday School Teacher', 'Worship', 'Lead Singer', 'Backing Vocal', 'Usher',
  'Giving', 'Assistant Teacher', 'Kitchen', 'Cleaning', 'Preaching', 'IT', 'Musician', 'Custom',
];

const VALUE_LABELS: Record<string, Partial<Record<Lang, string>>> = {
  // ── Ministry roles / skills ────────────────────────────────────────────────
  'Sunday School Teacher': { 'zh-CN': '主日学老师', 'zh-TW': '主日學老師', ja: '教会学校教師', ko: '주일학교 교사', th: 'ครูรวีวารศึกษา' },
  'Worship':            { 'zh-CN': '敬拜', 'zh-TW': '敬拜', ja: '賛美', ko: '찬양', th: 'นมัสการ' },
  'Lead Singer':        { 'zh-CN': '主领唱', 'zh-TW': '主領唱', ja: 'リードシンガー', ko: '리드 싱어', th: 'นักร้องนำ' },
  'Backing Vocal':      { 'zh-CN': '和声', 'zh-TW': '和聲', ja: 'バックボーカル', ko: '백보컬', th: 'นักร้องประสาน' },
  'Usher':              { 'zh-CN': '招待', 'zh-TW': '招待', ja: '案内係', ko: '안내위원', th: 'ผู้ต้อนรับ' },
  'Giving':             { 'zh-CN': '奉献', 'zh-TW': '奉獻', ja: '献金', ko: '헌금', th: 'การถวาย' },
  'Assistant Teacher':  { 'zh-CN': '助教', 'zh-TW': '助教', ja: '助教師', ko: '보조교사', th: 'ผู้ช่วยครู' },
  'Kitchen':            { 'zh-CN': '厨房', 'zh-TW': '廚房', ja: '厨房', ko: '주방', th: 'ครัว' },
  'Cleaning':           { 'zh-CN': '清洁', 'zh-TW': '清潔', ja: '清掃', ko: '청소', th: 'ทำความสะอาด' },
  'Preaching':          { 'zh-CN': '讲道', 'zh-TW': '講道', ja: '説教', ko: '설교', th: 'เทศนา' },
  'IT':                 { 'zh-CN': '技术', 'zh-TW': '技術', ja: 'IT', ko: 'IT', th: 'ไอที' },
  'Musician':           { 'zh-CN': '乐手', 'zh-TW': '樂手', ja: '演奏者', ko: '연주자', th: 'นักดนตรี' },
  'Piano':              { 'zh-CN': '钢琴', 'zh-TW': '鋼琴', ja: 'ピアノ', ko: '피아노', th: 'เปียโน' },
  'Guitar':             { 'zh-CN': '吉他', 'zh-TW': '吉他', ja: 'ギター', ko: '기타', th: 'กีตาร์' },
  'Guitarist':          { 'zh-CN': '吉他手', 'zh-TW': '吉他手', ja: 'ギタリスト', ko: '기타리스트', th: 'มือกีตาร์' },
  'Bass':               { 'zh-CN': '贝斯', 'zh-TW': '貝斯', ja: 'ベース', ko: '베이스', th: 'เบส' },
  'Bassist':            { 'zh-CN': '贝斯手', 'zh-TW': '貝斯手', ja: 'ベーシスト', ko: '베이시스트', th: 'มือเบส' },
  'Drums':              { 'zh-CN': '鼓', 'zh-TW': '鼓', ja: 'ドラム', ko: '드럼', th: 'กลอง' },
  'Custom':             { 'zh-CN': '自定义', 'zh-TW': '自訂', ja: 'カスタム', ko: '사용자 지정', th: 'กำหนดเอง' },

  // ── Membership status ──────────────────────────────────────────────────────
  'Member':     { 'zh-CN': '会员', 'zh-TW': '會員', ja: 'メンバー', ko: '멤버', th: 'สมาชิก' },
  'Leader':     { 'zh-CN': '同工', 'zh-TW': '同工', ja: 'リーダー', ko: '리더', th: 'ผู้นำ' },
  'Pastor':     { 'zh-CN': '牧师', 'zh-TW': '牧師', ja: '牧師', ko: '목사', th: 'ศิษยาภิบาล' },
  'New Friend': { 'zh-CN': '新朋友', 'zh-TW': '新朋友', ja: '新来者', ko: '새신자', th: 'เพื่อนใหม่' },

  // ── Prayer visibility ──────────────────────────────────────────────────────
  'All Church':   { 'zh-CN': '全教会', 'zh-TW': '全教會', ja: '全教会', ko: '전교회', th: 'ทั้งคริสตจักร' },
  'Staff':        { 'zh-CN': '同工', 'zh-TW': '同工', ja: 'スタッフ', ko: '사역자', th: 'เจ้าหน้าที่' },
  'Pastors Only': { 'zh-CN': '仅牧者', 'zh-TW': '僅牧者', ja: '牧師のみ', ko: '목회자 전용', th: 'เฉพาะศิษยาภิบาล' },
  'My Eyes Only': { 'zh-CN': '仅自己可见', 'zh-TW': '僅自己可見', ja: '自分のみ', ko: '나만 보기', th: 'เฉพาะฉัน' },
};

/** Translate a stored data value to the given language; falls back to the
 *  original English value when there's no translation (e.g. custom roles). */
export function tValue(value: string | undefined | null, language: string): string {
  if (!value) return '';
  const entry = VALUE_LABELS[value];
  if (!entry) return value;
  return entry[language as Lang] || value;
}

// ── Activity log action phrases ──────────────────────────────────────────────
const ACTION_LABELS: Record<string, Partial<Record<Lang, string>>> = {
  'Added calendar event':   { 'zh-CN': '添加日历事件', 'zh-TW': '新增日曆事件', ja: 'カレンダー予定を追加', ko: '캘린더 일정 추가', th: 'เพิ่มกิจกรรมในปฏิทิน' },
  'Added new member':       { 'zh-CN': '新增会友', 'zh-TW': '新增會友', ja: '新しいメンバーを追加', ko: '새 멤버 추가', th: 'เพิ่มสมาชิกใหม่' },
  'Created group':          { 'zh-CN': '创建小组', 'zh-TW': '建立小組', ja: 'グループを作成', ko: '그룹 생성', th: 'สร้างกลุ่ม' },
  'Deleted group':          { 'zh-CN': '删除小组', 'zh-TW': '刪除小組', ja: 'グループを削除', ko: '그룹 삭제', th: 'ลบกลุ่ม' },
  'Recorded attendance':    { 'zh-CN': '记录出席', 'zh-TW': '記錄出席', ja: '出席を記録', ko: '출석 기록', th: 'บันทึกการเข้าร่วม' },
  'Removed member':         { 'zh-CN': '移除会友', 'zh-TW': '移除會友', ja: 'メンバーを削除', ko: '멤버 삭제', th: 'นำสมาชิกออก' },
  'Updated member profile': { 'zh-CN': '更新会友资料', 'zh-TW': '更新會友資料', ja: 'メンバー情報を更新', ko: '멤버 정보 수정', th: 'อัปเดตข้อมูลสมาชิก' },
  'uploaded publication':   { 'zh-CN': '上传刊物', 'zh-TW': '上傳刊物', ja: '出版物をアップロード', ko: '간행물 업로드', th: 'อัปโหลดสิ่งพิมพ์' },
  'deleted publication':    { 'zh-CN': '删除刊物', 'zh-TW': '刪除刊物', ja: '出版物を削除', ko: '간행물 삭제', th: 'ลบสิ่งพิมพ์' },
};

const fill = (tpl: Partial<Record<Lang, string>>, language: string, x: string, fallback: string) =>
  (tpl[language as Lang] || fallback).replace('{x}', x);

/** Translate an activity-log action sentence (handles dynamic name/role parts). */
export function translateAction(action: string | undefined | null, language: string): string {
  if (!action) return '';
  if (ACTION_LABELS[action]) return ACTION_LABELS[action][language as Lang] || action;

  let m: RegExpMatchArray | null;
  if ((m = action.match(/^Added (.+) to group$/))) {
    return fill({ 'zh-CN': '已将 {x} 加入小组', 'zh-TW': '已將 {x} 加入小組', ja: '{x} をグループに追加', ko: '{x}님을 그룹에 추가', th: 'เพิ่ม {x} เข้ากลุ่ม' }, language, m[1], action);
  }
  if ((m = action.match(/^Removed (.+) from group$/))) {
    return fill({ 'zh-CN': '已将 {x} 移出小组', 'zh-TW': '已將 {x} 移出小組', ja: '{x} をグループから削除', ko: '{x}님을 그룹에서 제외', th: 'นำ {x} ออกจากกลุ่ม' }, language, m[1], action);
  }
  if ((m = action.match(/^Approved member as (.+)$/))) {
    return fill({ 'zh-CN': '批准会友为 {x}', 'zh-TW': '批准會友為 {x}', ja: 'メンバーを {x} として承認', ko: '멤버를 {x}(으)로 승인', th: 'อนุมัติสมาชิกเป็น {x}' }, language, tValue(m[1], language), action);
  }
  if ((m = action.match(/^Changed role to (.+)$/))) {
    return fill({ 'zh-CN': '角色改为 {x}', 'zh-TW': '角色改為 {x}', ja: '役割を {x} に変更', ko: '역할을 {x}(으)로 변경', th: 'เปลี่ยนบทบาทเป็น {x}' }, language, tValue(m[1], language), action);
  }
  return action;
}
