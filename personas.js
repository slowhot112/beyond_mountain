// 用户画像配置：身份 + 大行业 + 细分领域
// 参考：左侧身份（准入行/在职深耕/在职转型），右侧大行业与细分领域（参考行业导航二级结构）
// 数据集中在此，方便产品灵活调整。

export const IDENTITIES = [
  { id: 'pre', name: '准入行', desc: '准备进入某个行业，缺真实经历、容易被高赞带节奏' },
  { id: 'deepen', name: '在职深耕', desc: '已在行业里，想建立更深的判断、不被表面经验误导' },
  { id: 'shift', name: '在职转型', desc: '想从当前领域转到新领域，要重新建立判断力' },
];

export const INDUSTRIES = [
  {
    id: 'ai', name: 'AI', subs: ['算法', 'Agent', 'AIGC', 'AI 产品', '模型训练', '数据标注'],
  },
  {
    id: 'live', name: '直播', subs: ['直播运营', '主播', '直播助理', '场控', '选品', '投流'],
  },
  {
    id: 'finance', name: '金融', subs: ['投行', '量化', '风控', '财富管理', '行研', '保险'],
  },
  {
    id: 'media', name: '传媒', subs: ['内容运营', '编导', '媒介', '公关', '短视频', '品牌'],
  },
  {
    id: 'it', name: 'IT', subs: ['前端', '后端', '产品', '测试', '运维', '数据'],
  },
  {
    id: 'hr', name: 'HR', subs: ['招聘', 'OD', '薪酬绩效', 'HRBP', '培训', '员工关系'],
  },
  {
    id: 'sport', name: '运动', subs: ['教练', '赛事运营', '运动康复', '体能', '场馆', '青训'],
  },
  {
    id: 'logistics', name: '物流', subs: ['供应链', '仓储', '运力', '跨境物流', '冷链', '仓配'],
  },
];

export const DEFAULT_PERSONA = { identity: 'pre', industry: 'ai', sub: 'AIGC' };

// 由 id 组合出可读 persona 文本（喂给 prompt）
export function personaText(p) {
  const id = IDENTITIES.find((x) => x.id === p.identity) || IDENTITIES[0];
  const ind = INDUSTRIES.find((x) => x.id === p.industry) || INDUSTRIES[0];
  const sub = p.sub || (ind.subs[0] || '');
  return {
    identityName: id.name,
    industryName: ind.name,
    subName: sub,
    // 给 LLM 的画像说明
    prompt: `你是「${id.name}」的人，所处行业是「${ind.name}」，具体细分领域是「${sub}」。${id.desc}`
      + `请围绕这个真实身份去分析，而不是用通用职场建议替代。`,
  };
}
