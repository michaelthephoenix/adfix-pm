export type User = {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  user: User;
};
