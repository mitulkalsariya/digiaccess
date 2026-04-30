export interface Site {
  id: string;
  name: string;
  baseUrl: string;
  ownerTeamId: string;
  slackChannel?: string;
  jiraProjectKey?: string;
  includePatterns?: string[];
  excludePatterns?: string[];
  createdAt: string;
  updatedAt: string;
}
