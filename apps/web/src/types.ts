export type User = {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  accountType: "staff" | "client";
  avatarUrl?: string | null;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken?: string;
  user: User;
};
