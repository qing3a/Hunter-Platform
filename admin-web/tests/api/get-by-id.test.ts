import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getUser } from '../../src/api/users';
import { getJob } from '../../src/api/jobs';
import { getCandidate } from '../../src/api/candidates';
import { getRecommendation } from '../../src/api/recommendations';

vi.mock('../../src/api/raw', () => ({ apiFetchRaw: vi.fn() }));
import { apiFetchRaw } from '../../src/api/raw';

describe('get-by-id APIs (Sub-D4)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. getUser calls users/:id', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: { id: 'u_1' } });
    await getUser('u_1');
    expect(apiFetchRaw).toHaveBeenCalledWith('users/u_1');
  });

  it('2. getJob calls jobs/:id', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: { id: 'job_1' } });
    await getJob('job_1');
    expect(apiFetchRaw).toHaveBeenCalledWith('jobs/job_1');
  });

  it('3. getCandidate calls candidates/:id', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: { id: 'c_1' } });
    await getCandidate('c_1');
    expect(apiFetchRaw).toHaveBeenCalledWith('candidates/c_1');
  });

  it('4. getRecommendation calls recommendations/:id', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: { id: 'rec_1' } });
    await getRecommendation('rec_1');
    expect(apiFetchRaw).toHaveBeenCalledWith('recommendations/rec_1');
  });

  it('5. throws on non-ok', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: false, error: { code: 'NOT_FOUND', message: 'not found' } });
    await expect(getUser('x')).rejects.toThrow('not found');
  });
});