// ----------------------------------------------------------------
// Auth types — updated for multi-tenant
// ----------------------------------------------------------------

export interface JwtPayload {
  sub: string; // admin ID
  email: string;
  role: string;
  businessId: string | null; // null for SUPER_ADMIN
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthenticatedAdmin {
  id: string;
  email: string;
  name: string;
  role: string;
  businessId: string | null;
}

export interface LoginResponse {
  admin: AuthenticatedAdmin;
  tokens: TokenPair;
}

export interface RefreshResponse {
  tokens: TokenPair;
}
