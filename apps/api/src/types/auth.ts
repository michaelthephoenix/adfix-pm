export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  accountType: "staff" | "client";
};
