import type { DB } from '../../db/connection.js';
import { createCandidatesPrivateRepo } from '../../db/repositories/candidates-private.js';
import { createCandidatesAnonymizedRepo } from '../../db/repositories/candidates-anonymized.js';
import { createUnlockAuditLogRepo } from '../../db/repositories/unlock-audit-log.js';
import { createUsersRepo } from '../../db/repositories/users.js';
import { decrypt, zeroMemory } from '../crypto/aes-gcm.js';
import { Errors } from '../../errors.js';
import type { User } from '../../../shared/types.js';

export interface ExportedData {
  user: { id: string; user_type: string; name: string; contact: string | null; agent_endpoint: string | null; reputation: number; status: string; created_at: string };
  candidates_private: unknown[];
  candidates_anonymized: unknown[];
  recommendations: unknown[];
  audit_log_entries: unknown[];
  exported_at: string;
  format_version: string;
}

export function createCandidateExport(db: DB, encryptionKey: Buffer) {
  const users = createUsersRepo(db);
  const priv = createCandidatesPrivateRepo(db);
  const anon = createCandidatesAnonymizedRepo(db);
  const audit = createUnlockAuditLogRepo(db);

  return {
    exportMyData(user: User): ExportedData {
      if (user.user_type !== 'candidate') throw Errors.forbidden('Only candidates can export their data');

      const userRecord = users.findById(user.id);
      if (!userRecord) throw Errors.notFound('User not found');
      const userExport = {
        id: userRecord.id, user_type: userRecord.user_type, name: userRecord.name,
        contact: userRecord.contact, agent_endpoint: userRecord.agent_endpoint,
        reputation: userRecord.reputation, status: userRecord.status, created_at: userRecord.created_at,
      };

      const myAnons = db.prepare('SELECT id FROM candidates_anonymized WHERE source_private_id IN (SELECT id FROM candidates_private WHERE candidate_user_id = ?)').all(user.id) as { id: string }[];
      const myPrivIds = db.prepare('SELECT id FROM candidates_private WHERE candidate_user_id = ?').all(user.id) as { id: string }[];

      const privExports: any[] = [];
      const nameBufs: Buffer[] = [];
      const phoneBufs: Buffer[] = [];
      const emailBufs: Buffer[] = [];
      try {
        for (const { id } of myPrivIds) {
          const p = priv.findById(id);
          if (!p) continue;
          const nameBuf = Buffer.from(decrypt(encryptionKey, p.name_enc), 'utf8');
          const phoneBuf = Buffer.from(decrypt(encryptionKey, p.phone_enc), 'utf8');
          const emailBuf = Buffer.from(decrypt(encryptionKey, p.email_enc), 'utf8');
          nameBufs.push(nameBuf); phoneBufs.push(phoneBuf); emailBufs.push(emailBuf);
          privExports.push({
            id: p.id, headhunter_id: p.headhunter_id,
            name: nameBuf.toString('utf8'),
            phone: phoneBuf.toString('utf8'),
            email: emailBuf.toString('utf8'),
            current_company: p.current_company_raw,
            current_title: p.current_title_raw,
            expected_salary: p.expected_salary,
            years_experience: p.years_experience,
            education_school: p.education_school,
            skills: JSON.parse(p.skills_json ?? '[]'),
            created_at: p.created_at,
          });
        }
      } finally {
        nameBufs.forEach(zeroMemory);
        phoneBufs.forEach(zeroMemory);
        emailBufs.forEach(zeroMemory);
      }

      const anonExports: unknown[] = myAnons
        .map(a => anon.findById(a.id))
        .filter((a): a is NonNullable<typeof a> => Boolean(a));

      const recExports: unknown[] = [];
      for (const a of myAnons) {
        recExports.push(...db.prepare('SELECT * FROM recommendations WHERE anonymized_candidate_id = ?').all(a.id));
      }

      const auditExports: unknown[] = audit.listByActor(user.id);

      return {
        user: userExport,
        candidates_private: privExports,
        candidates_anonymized: anonExports,
        recommendations: recExports,
        audit_log_entries: auditExports,
        exported_at: new Date().toISOString(),
        format_version: '1.0',
      };
    },
  };
}