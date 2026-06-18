export type ViewType = 'candidate' | 'recommendation' | 'user-quota' | 'audit';

export interface ViewMapping {
  type: ViewType;
  /** JSONPath-like path into the response body to extract the resource ID for view generation. */
  idFrom: string;
}

export const ROUTE_VIEW_MAP: Record<string, ViewMapping> = {
  // Write endpoints that produce candidate / recommendation resources
  'POST /v1/headhunter/candidates':       { type: 'candidate',      idFrom: 'data.anonymized_id' },
  // recommendCandidate returns the full Recommendation object; its id field is the recommendation ID.
  'POST /v1/headhunter/recommendations':  { type: 'recommendation', idFrom: 'data.id' },
  // State-change endpoints return only { data: { status } }; the rec ID is in the URL path.
  'POST /v1/candidate/recommendations/{id}/approve-unlock':  { type: 'recommendation', idFrom: 'params.id' },
  'POST /v1/candidate/recommendations/{id}/reject-unlock':   { type: 'recommendation', idFrom: 'params.id' },
  'POST /v1/employer/recommendations/{id}/express-interest': { type: 'recommendation', idFrom: 'params.id' },
  'POST /v1/employer/recommendations/{id}/unlock-contact':   { type: 'recommendation', idFrom: 'params.id' },

  // Read endpoints that produce user-scoped views
  'GET /v1/users/{id}/status':            { type: 'user-quota', idFrom: 'params.id' },
  'GET /v1/users/{id}/history':           { type: 'audit',     idFrom: 'params.id' },
};