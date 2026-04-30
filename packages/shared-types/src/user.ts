export interface User {
  id: string;
  email: string;
  name: string;
  teamIds: string[];
  createdAt: string;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface JwtClaims {
  sub: string;
  email: string;
  name: string;
  teams: string[];
  iat: number;
  exp: number;
}
