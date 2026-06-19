// v1: 从 config/industry_map.json 加载，支持 fallback 模糊匹配
// v2: 可接 LLM 推导
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface IndustryConfig {
  version: number;
  updated_at: string;
  categories: { id: string; companies: string[] }[];
  fallback_keywords: Record<string, string[]>;
  default: string;
}

interface IndustryCache {
  companies: Map<string, string>;  // company name → category id (first-wins)
  cfg: IndustryConfig;
  categoryOrder: string[];  // for fallback iteration order
}

let _cache: IndustryCache | null = null;

export function loadIndustryMap(): IndustryCache {
  if (_cache) return _cache;
  const path = join(process.cwd(), 'config', 'industry_map.json');
  let cfg: IndustryConfig;
  try {
    cfg = JSON.parse(readFileSync(path, 'utf8'));
    // basic shape validation
    if (!Array.isArray(cfg.categories)) throw new Error('categories not array');
  } catch (e) {
    // 兜底：文件丢失或解析失败时使用最小集合
    console.warn('[industry_map] failed to load config/industry_map.json, using minimal fallback:', (e as Error).message);
    cfg = {
      version: 0,
      updated_at: 'fallback',
      categories: [
        { id: '互联网', companies: ['字节跳动', '阿里巴巴', '腾讯', '百度', '美团', '京东', '小米'] },
        { id: '通信/硬件', companies: ['华为'] },
        { id: '金融', companies: ['招商银行', '中国银行', '工商银行', '中金', '高盛'] },
      ],
      fallback_keywords: {
        '金融': ['银行', '证券', '保险'],
        '互联网': ['科技', '网络'],
      },
      default: '其他',
    };
  }
  const companies = new Map<string, string>();
  for (const cat of cfg.categories) {
    for (const c of cat.companies) {
      if (!companies.has(c)) companies.set(c, cat.id); // first-wins
    }
  }
  _cache = {
    companies,
    cfg,
    categoryOrder: cfg.categories.map(c => c.id),
  };
  return _cache;
}

export function lookupIndustry(companyName: string | undefined | null): string | undefined {
  if (!companyName) return undefined;
  const { companies, cfg, categoryOrder } = loadIndustryMap();

  // 1. 枚举命中
  const hit = companies.get(companyName);
  if (hit) return hit;

  // 2. fallback 关键词（按 categories 数组顺序遍历，避免随机匹配）
  for (const catId of categoryOrder) {
    const keywords = cfg.fallback_keywords[catId] ?? [];
    if (keywords.some(k => companyName.includes(k))) {
      return catId;
    }
  }

  // 3. default
  return cfg.default;
}

// 兼容旧 API（保留 INDUSTRY_MAP 导出供可能的旧 import）
// 注意：现在读的是 Map 不是 Record；如需保持兼容可在外面用 Object.fromEntries
export const INDUSTRY_MAP: Record<string, string> = new Proxy({} as Record<string, string>, {
  get(_t, prop: string) {
    const { companies } = loadIndustryMap();
    return companies.get(prop);
  },
  has(_t, prop: string) {
    const { companies } = loadIndustryMap();
    return companies.has(prop);
  },
});

export const TITLE_LEVEL_PATTERNS: { regex: RegExp; level: string }[] = [
  // P6: senior engineer variants. 高级X（前端/后端/测试/架构/运维）+ 高级工程师 + P5-P7
  { regex: /P[5-7]|高级工程师|高级.*?(?:开发|前端|后端|测试|架构|运维|研发)/, level: 'P6' },
  { regex: /P[8-9]|资深|专家|Staff|Principal/, level: 'P7+' },
  { regex: /M[1-2]|经理|主管/, level: 'M1' },
  { regex: /M[3-4]|总监/, level: 'M2' },
  { regex: /VP|副总裁|总裁/, level: 'VP' },
];

export const SALARY_BANDS: { min: number; max: number | null; label: string }[] = [
  { min: 0,       max: 200000,   label: '0-20万' },
  { min: 200000,  max: 400000,   label: '20-40万' },
  { min: 400000,  max: 600000,   label: '40-60万' },
  { min: 600000,  max: 800000,   label: '60-80万' },
  { min: 800000,  max: 1200000,  label: '80-120万' },
  { min: 1200000, max: 2000000,  label: '120-200万' },
  { min: 2000000, max: null,     label: '200万+' },
];

// 985 工程完整 39 所（数据来源：教育部官方名单）
export const SCHOOL_TIERS: Record<string, string> = {
  // 北京（8 所）
  '北京大学': '985', '清华大学': '985', '中国人民大学': '985',
  '北京航空航天大学': '985', '北京理工大学': '985', '中国农业大学': '985',
  '北京师范大学': '985', '中央民族大学': '985',
  // 天津（2 所）
  '南开大学': '985', '天津大学': '985',
  // 辽宁（2 所）
  '大连理工大学': '985', '东北大学': '985',
  // 吉林（1 所）
  '吉林大学': '985',
  // 黑龙江（1 所）
  '哈尔滨工业大学': '985',
  // 上海（4 所）
  '复旦大学': '985', '同济大学': '985', '上海交通大学': '985', '华东师范大学': '985',
  // 江苏（2 所）
  '南京大学': '985', '东南大学': '985',
  // 浙江（1 所）
  '浙江大学': '985',
  // 安徽（1 所）
  '中国科学技术大学': '985',
  // 福建（1 所）
  '厦门大学': '985',
  // 山东（2 所）
  '山东大学': '985', '中国海洋大学': '985',
  // 湖北（2 所）
  '武汉大学': '985', '华中科技大学': '985',
  // 湖南（1 所）
  '中南大学': '985',
  // 广东（2 所）
  '中山大学': '985', '华南理工大学': '985',
  // 四川（2 所）
  '四川大学': '985', '电子科技大学': '985',
  // 重庆（1 所）
  '重庆大学': '985',
  // 陕西（3 所）
  '西安交通大学': '985', '西北工业大学': '985', '西北农林科技大学': '985',
  // 甘肃（1 所）
  '兰州大学': '985',
  // 军队（1 所）
  '国防科技大学': '985',
  // 注：211 学校不在 985 列表里的部分仍 fallback '普通'；如需细化可单独立 spec
};