/**
 * Shared API request/response types.
 * Keep these separate from UI models — feature modules adapt API types to their own shapes.
 */

/** Response from GET /api/v1/me */
export interface MeResponse {
  issuer: string;
  subject: string;
}

/** Standard paginated list wrapper used by list endpoints. */
export interface PageResponse<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
  first: boolean;
  last: boolean;
}
