import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { profile as profileApi } from '../../api/candidate-portal';
import { MobileLayout } from '../../components/candidate-portal/MobileLayout';
import { RadarChart } from '../../components/candidate-portal/RadarChart';

export function ProfilePage() {
  const qc = useQueryClient();
  const { data: p, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => profileApi.view(),
  });

  const [skillsText, setSkillsText] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [salaryMin, setSalaryMin] = useState('');
  const [salaryMax, setSalaryMax] = useState('');

  useEffect(() => {
    if (p) {
      setSkillsText((p.skills ?? []).join(', '));
      setVisibility(p.visibility ?? 'public');
      if (p.expectations) {
        setSalaryMin(String(p.expectations.expected_salary_min ?? ''));
        setSalaryMax(String(p.expectations.expected_salary_max ?? ''));
      }
    }
  }, [p]);

  const updateMutation = useMutation({
    mutationFn: () => profileApi.update({
      skills: skillsText.split(',').map(s => s.trim()).filter(Boolean),
      visibility: visibility as any,
      expectations: {
        expected_salary_min: salaryMin ? Number(salaryMin) : undefined,
        expected_salary_max: salaryMax ? Number(salaryMax) : undefined,
      },
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  });

  if (isLoading) return <MobileLayout><div className="cp-loading">加载中...</div></MobileLayout>;
  if (!p) return <MobileLayout><div>简历不存在</div></MobileLayout>;

  const radarDims = [
    { label: '技能', score: Math.min(100, (p.skills?.length ?? 0) * 10) },
    { label: '经验', score: p.years_experience ? Math.min(100, p.years_experience * 10) : 50 },
    { label: '学历', score: 70 },
    { label: '行业', score: p.industry ? 80 : 40 },
    { label: '职级', score: 70 },
  ];

  return (
    <MobileLayout title="我的简历">
      <div className="cp-profile">
        <RadarChart dimensions={radarDims} />

        <section>
          <h2>PII (只读)</h2>
          <div className="cp-pii-box">
            <div><strong>姓名:</strong> {p.pii.name ?? '(未填)'}</div>
            <div><strong>当前公司:</strong> {p.pii.current_company ?? '(未填)'}</div>
          </div>
        </section>

        <section>
          <h2>公开信息 (可编辑)</h2>
          <label>技能 (英文逗号分隔):<input type="text" value={skillsText} onChange={e => setSkillsText(e.target.value)} className="cp-input" placeholder="vue, typescript" /></label>
          <label>期望薪资 (k/月):<input type="number" value={salaryMin} onChange={e => setSalaryMin(e.target.value)} className="cp-input" /></label>
          <label>期望薪资 (k/月, 最高):<input type="number" value={salaryMax} onChange={e => setSalaryMax(e.target.value)} className="cp-input" /></label>
          <label>可见性:<select value={visibility} onChange={e => setVisibility(e.target.value)} className="cp-input">
            <option value="public">公开</option><option value="invitation_only">仅邀请</option><option value="hidden">隐藏</option>
          </select></label>
        </section>

        <button className="cp-btn-primary" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
          {updateMutation.isPending ? '保存中...' : '保存'}
        </button>
        {updateMutation.isSuccess && <div className="cp-success">✓ 已保存</div>}
      </div>
    </MobileLayout>
  );
}
