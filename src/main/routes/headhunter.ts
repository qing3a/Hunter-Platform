import { Router } from 'express';
import type { DB } from '../db/connection.js';
import { z } from 'zod';
import { authMiddleware } from '../modules/auth/middleware.js';
import { createHeadhunterHandler } from '../modules/headhunter/handler.js';
import { Errors } from '../errors.js';
import type { User } from '../../shared/types.js';

const UploadSchema = z.object({
  candidate_user_id: z.string().min(1),
  name: z.string().min(1).max(100),
  phone: z.string().min(1).max(50),
  email: z.string().email(),
  current_company: z.string().max(200).optional(),
  current_title: z.string().max(100).optional(),
  expected_salary: z.number().int().positive().optional(),
  years_experience: z.number().int().min(0).max(60).optional(),
  education_school: z.string().max(200).optional(),
  skills: z.array(z.string()).optional(),
});

export function createHeadhunterRouter(db: DB, encryptionKey: Buffer): Router {
  const router = Router();
  const handler = createHeadhunterHandler(db, encryptionKey);

  router.use(authMiddleware(db));

  router.post('/candidates', async (req, res, next) => {
    try {
      const parsed = UploadSchema.safeParse(req.body);
      if (!parsed.success) throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      const result = await handler.uploadCandidate((req as typeof req & { user?: User }).user!, parsed.data);
      res.json({ ok: true, data: result });
    } catch (e) { next(e); }
  });

  return router;
}
