export type User = {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  accountType: "staff" | "client";
  mustChangePassword: boolean;
  avatarUrl?: string | null;
};

export type AuthTokens = {
  accessToken: string;
  user: User;
};
