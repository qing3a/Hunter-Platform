// Renders a JSON string as a human-readable diff-like view.
// - Parses the JSON (falls back to raw text on parse error)
// - Recursively renders objects/arrays
// - Masks PII fields (email/name/contact) by default using Sub-B's mask helpers
import React from 'react';
import { maskName, maskEmail, maskContact } from '@hunter-platform/shared-web/lib';

const PII_KEYS = new Set(['email', 'name', 'contact', 'phone']);

function maskIfPii(key: string, value: string): string {
  const lower = key.toLowerCase();
  if (lower === 'email') return maskEmail(value);
  if (lower === 'name') return maskName(value);
  if (lower === 'phone' || lower === 'contact') return maskContact(value);
  return value;
}

function renderValue(value: unknown, maskPii: boolean, keyName?: string): React.ReactNode {
  if (value === null) return <span className="json-null">null</span>;
  if (typeof value === 'boolean') return <span className="json-bool">{String(value)}</span>;
  if (typeof value === 'number') return <span className="json-num">{value}</span>;
  if (typeof value === 'string') {
    const display = (maskPii && keyName && PII_KEYS.has(keyName.toLowerCase()))
      ? maskIfPii(keyName, value)
      : value;
    return <span className="json-str">"{display}"</span>;
  }
  if (Array.isArray(value)) {
    return (
      <ul className="json-array">
        {value.map((v, i) => <li key={i}>{renderValue(v, maskPii)}</li>)}
      </ul>
    );
  }
  if (typeof value === 'object') {
    return (
      <ul className="json-obj">
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <li key={k}>
            <strong>{k}:</strong> {renderValue(v, maskPii, k)}
          </li>
        ))}
      </ul>
    );
  }
  return <span>{String(value)}</span>;
}

export default function AuditDiffView({ json, maskPii = true }: { json: string | null; maskPii?: boolean }) {
  if (json === null || json === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return <pre className="json-raw">{json}</pre>;
  }
  return <div className="audit-diff-view">{renderValue(parsed, maskPii)}</div>;
}