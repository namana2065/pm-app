import { supabase } from "../lib/supabaseClient";
import { AppError } from "../lib/errors";

export interface SignupInput {
  name: string;
  email: string;
  password: string;
}

export interface AuthSession {
  userId: string;
  accessToken: string | undefined;
  refreshToken: string | undefined;
  expiresAt: number | undefined;
}

export async function signup({ name, email, password }: SignupInput): Promise<AuthSession> {
  if (!name?.trim()) throw new AppError("Name is required", 400);
  if (!email?.trim()) throw new AppError("Email is required", 400);
  if (!password || password.length < 8) {
    throw new AppError("Password must be at least 8 characters", 400);
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });

  if (error) {
    if (error.status === 422 || /already registered/i.test(error.message)) {
      throw new AppError("An account with this email already exists", 409);
    }
    throw new AppError(error.message, 500);
  }

  if (!data.user) {
    throw new AppError("Signup did not return a user", 500);
  }

  return login({ email, password });
}

export interface LoginInput {
  email: string;
  password: string;
}

export async function login({ email, password }: LoginInput): Promise<AuthSession> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session || !data.user) {
    throw new AppError("Invalid email or password", 401);
  }

  return {
    userId: data.user.id,
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
  };
}

export async function logout(accessToken: string): Promise<void> {
  const { error } = await supabase.auth.admin.signOut(accessToken);
  if (error) throw new AppError(error.message, 500);
}