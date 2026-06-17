import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import { createUsersRepo } from '../../db/repositories/users.js';
import { verifyApiKey } from './api-key.js';
import { Errors } from '../../errors.js';
import { API_KEY_PREFIX_LENGTH } from '../../../shared/constants.js';

export function authMiddleware(db: DB, usersRepo = createUsersRepo(db)): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) throw Errors.unauthorized();
      const key = auth.slice(7);
      // prefix 长度必须 ≥ 12 才能用于缩小候选集
      const prefix = key.slice(0, API_KEY_PREFIX_LENGTH);

      // 通过 prefix 缩小候选集 → 再 bcrypt 验证
      const candidates = db.prepare(
        'SELECT * FROM users WHERE api_key_prefix = ? AND status = ?'
      ).all(prefix, 'active') as unknown as User[];

      const matched = candidates.find(u => verifyApiKey(key, u.api_key_hash));
      if (!matched) throw Errors.unauthorized();

      (req as Request & { user?: User }).user = matched;
      next();
    } catch (e) { next(e); }
  };
}
