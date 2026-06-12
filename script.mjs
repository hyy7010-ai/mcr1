import fs from 'fs';
import path from 'path';

const file = path.resolve('src/contexts/LanguageContext.tsx');
let content = fs.readFileSync(file, 'utf-8');

const keysToAdd = {
  en: {
    industry: 'INDUSTRY',
    allIndustries: 'All Industries',
    industryEducation: 'Education & Academia',
    industryHealthcare: 'Healthcare & Social Work',
    industryIT: 'IT, Engineering & Tech',
    industryFinance: 'Finance, Law & Professional Services',
    industryBusiness: 'Business, Sales & Retail',
    industryGov: 'Government, Public Policy & Utilities',
    industryArts: 'Arts, Media & Creative',
    industryConstruction: 'Construction, Manufacturing & Skilled Labor',
    industryRetired: 'Retired, Homemakers & Students',
    industryLooking: 'Looking for Opportunities',
  },
  'zh-CN': {
    industry: '行业',
    allIndustries: '所有行业',
    industryEducation: '教育与学术',
    industryHealthcare: '医疗卫生与社会福利',
    industryIT: '科技、工程与资讯',
    industryFinance: '金融、法律与专业服务',
    industryBusiness: '商业营销、贸易与零售',
    industryGov: '公务、司法与公共事业',
    industryArts: '艺术、传媒与创意产业',
    industryConstruction: '营造、制造与技术劳务',
    industryRetired: '退休、家管与学生',
    industryLooking: '求职中 (Looking for Opportunities)',
  },
  'zh-TW': {
    industry: '行業',
    allIndustries: '所有行業',
    industryEducation: '教育與學術',
    industryHealthcare: '醫療衛生與社會福利',
    industryIT: '科技、工程與資訊',
    industryFinance: '金融、法律與專業服務',
    industryBusiness: '商業營銷、貿易與零售',
    industryGov: '公務、司法與公共事業',
    industryArts: '藝術、傳媒與創意產業',
    industryConstruction: '營造、製造與技術勞務',
    industryRetired: '退休、家管與學生',
    industryLooking: '求職中 (Looking for Opportunities)',
  }
};

for (const [lang, translations] of Object.entries(keysToAdd)) {
  const newText = Object.entries(translations).map(([k, v]) => `    ${k}: '${v}',`).join('\n');
  
  if (lang === 'en') {
    content = content.replace(/translatingLine:\s*'Translation line\.\.\.',?/, `translatingLine: 'Translation line...',
${newText}`);
  } else if (lang === 'zh-CN') {
    content = content.replace(/translatingLine:\s*'翻译行\.\.\.',?/, `translatingLine: '翻译行...',
${newText}`);
  } else if (lang === 'zh-TW') {
    content = content.replace(/justNow:\s*'剛剛',?/, `justNow: '剛剛',
${newText}`);
  }
}

fs.writeFileSync(file, content);
console.log('LanguageContext.tsx patched successfully.');
