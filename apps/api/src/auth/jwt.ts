import type { JwtClaims } from '@a11y/shared-types';

export interface IssueJwtInput {
  userId: string;
  email: string;
  name: string;
  teamIds: string[];
}

export function buildClaims(input: IssueJwtInput, ttlSec: number, now = Date.now()): JwtClaims {
  const iat = Math.floor(now / 1000);
  return {
    sub: input.userId,
    email: input.email,
    name: input.name,
    teams: input.teamIds,
    iat,
    exp: iat + ttlSec,
  };
}

// Map IdP group IDs/names → internal team IDs using the configured mapping.
// Unknown groups are dropped (fail-closed).
export function mapGroupsToTeams(
  groups: ReadonlyArray<string>,
  groupToTeamMap: Record<string, string>,
): string[] {
  const teamIds = new Set<string>();
  for (const g of groups) {
    const team = groupToTeamMap[g];
    if (team) teamIds.add(team);
  }
  return [...teamIds];
}
