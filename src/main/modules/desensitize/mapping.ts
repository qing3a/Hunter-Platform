// v1 手写配置；v2 可接 LLM 推导
export const INDUSTRY_MAP: Record<string, string> = {
  '字节跳动': '互联网', '阿里巴巴': '互联网', '腾讯': '互联网', '百度': '互联网',
  '美团': '互联网', '京东': '互联网', '小米': '互联网', '华为': '通信/硬件',
  '招商银行': '金融', '中国银行': '金融', '工商银行': '金融',
  '中金': '金融', '高盛': '金融',
};

export const TITLE_LEVEL_PATTERNS: { regex: RegExp; level: string }[] = [
  { regex: /P[5-7]|高级.*工程师|高级开发/, level: 'P6' },
  { regex: /P[8-9]|资深|Staff/, level: 'P7+' },
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

// 985 完整列表（v1 含全部 39 所 + 211 全部 73 所放外部 JSON；这里只列示例）
export const SCHOOL_TIERS: Record<string, string> = {
  '清华大学': '985', '北京大学': '985', '复旦大学': '985',
  '上海交通大学': '985', '浙江大学': '985', '中国科学技术大学': '985',
  // ... 其余见 config/school_tiers.json
};
