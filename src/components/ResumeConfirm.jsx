import React, { useState, useEffect } from 'react';

function joinArr(v) {
  return Array.isArray(v) ? v.join('、') : (v || '');
}
function splitToArr(v) {
  return String(v || '').split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
}

// 简历解析结果确认/编辑弹窗：提取字段在使用前必须可确认或修改
export default function ResumeConfirm({ fields, onConfirm, onCancel }) {
  const [form, setForm] = useState({
    name: fields?.name || '',
    city: fields?.city || '',
    education: fields?.education || '',
    experience: fields?.experience || '',
    projects: Array.isArray(fields?.projects)
      ? fields.projects.map((p) => `${p.name || ''}|${p.role || ''}|${(p.highlights || []).join('，')}`).join('\n')
      : '',
    skills: joinArr(fields?.skills),
    skillLevels: typeof fields?.skillLevels === 'object' && fields.skillLevels
      ? Object.entries(fields.skillLevels).map(([k, v]) => `${k}:${v}`).join('、')
      : '',
    industry: fields?.industry || '',
    roles: joinArr(fields?.roles),
    salary: fields?.salary || '',
    certs: joinArr(fields?.certs),
    languages: joinArr(fields?.languages),
    summary: fields?.summary || '',
  });

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onCancel(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  function update(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  function confirm() {
    const projects = form.projects.trim()
      ? form.projects.split('\n').map((line) => {
          const [name, role, highlights] = line.split('|');
          return { name: (name || '').trim(), role: (role || '').trim(), highlights: splitToArr(highlights || '') };
        }).filter((p) => p.name || p.role)
      : [];
    const skillLevels = {};
    form.skillLevels.split(/[,，、]/).forEach((seg) => {
      const [k, v] = seg.split(':');
      if (k && v) skillLevels[k.trim()] = v.trim();
    });
    onConfirm({
      name: form.name.trim(),
      city: form.city.trim(),
      education: form.education.trim(),
      experience: form.experience.trim(),
      projects,
      skills: splitToArr(form.skills),
      skillLevels,
      industry: form.industry.trim(),
      roles: splitToArr(form.roles),
      salary: form.salary.trim(),
      certs: splitToArr(form.certs),
      languages: splitToArr(form.languages),
      summary: form.summary.trim(),
    });
  }

  return (
    <div className="resume-confirm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="resume-confirm">
        <div className="resume-confirm-head">
          <h3>确认简历解析结果</h3>
          <button className="resume-confirm-close" onClick={onCancel}>✕</button>
        </div>
        <p className="muted">请核对 AI 提取的信息，可直接修改，确认后才会写入处境卡。</p>
        <div className="resume-confirm-body">
          <label>姓名
            <input type="text" value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="姓名" />
          </label>
          <div className="resume-confirm-row">
            <label>城市
              <input type="text" value={form.city} onChange={(e) => update('city', e.target.value)} placeholder="当前/目标城市" />
            </label>
            <label>目标/所在行业
              <input type="text" value={form.industry} onChange={(e) => update('industry', e.target.value)} placeholder="如：AI、金融" />
            </label>
          </div>
          <label>一句话人才画像
            <input type="text" value={form.summary} onChange={(e) => update('summary', e.target.value)} placeholder="50 字以内画像" />
          </label>
          <label>教育经历
            <input type="text" value={form.education} onChange={(e) => update('education', e.target.value)} placeholder="学校/专业/学历/时间" />
          </label>
          <label>工作/项目经历
            <input type="text" value={form.experience} onChange={(e) => update('experience', e.target.value)} placeholder="公司/角色/做了什么" />
          </label>
          <label>项目经历（每行格式：项目名|角色|亮点1，亮点2）
            <textarea rows={3} value={form.projects} onChange={(e) => update('projects', e.target.value)} placeholder="智能推荐系统|后端负责人|QPS 提升 30%，成本下降 20%" />
          </label>
          <div className="resume-confirm-row">
            <label>技能（用顿号分隔）
              <input type="text" value={form.skills} onChange={(e) => update('skills', e.target.value)} placeholder="Python、Go、Kubernetes" />
            </label>
            <label>熟练度（格式：技能:熟练、Go:了解）
              <input type="text" value={form.skillLevels} onChange={(e) => update('skillLevels', e.target.value)} placeholder="Python:熟练、Go:了解" />
            </label>
          </div>
          <label>意向岗位（用顿号分隔）
            <input type="text" value={form.roles} onChange={(e) => update('roles', e.target.value)} placeholder="算法工程师、后端开发" />
          </label>
          <div className="resume-confirm-row">
            <label>证书
              <input type="text" value={form.certs} onChange={(e) => update('certs', e.target.value)} placeholder="英语六级、PMP" />
            </label>
            <label>语言能力
              <input type="text" value={form.languages} onChange={(e) => update('languages', e.target.value)} placeholder="英语、日语" />
            </label>
            <label>薪资
              <input type="text" value={form.salary} onChange={(e) => update('salary', e.target.value)} placeholder="20k-30k" />
            </label>
          </div>
        </div>
        <div className="resume-confirm-actions">
          <button className="chip ghost" onClick={onCancel}>取消/手动填写</button>
          <button className="chip primary" onClick={confirm}>确认使用该信息</button>
        </div>
      </div>
    </div>
  );
}
