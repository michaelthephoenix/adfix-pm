export type User = {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  avatarUrl?: string | null;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  user: User;
};
