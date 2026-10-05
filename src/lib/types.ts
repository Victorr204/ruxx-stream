export type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  role: "user" | "admin";
  is_premium: boolean;
  created_at: string;
  updated_at: string;
};
