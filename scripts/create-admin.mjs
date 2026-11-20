#!/usr/bin/env node
/**
 * Bootstraps the FIRST administrator (run once, from a trusted machine).
 *
 *   npm run create-admin -- owner@company.com "Full Name"              # sends an invitation e-mail
 *   npm run create-admin -- owner@company.com "Full Name" --password   # prompts for a password instead
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 * Afterwards, invite everyone else from the app (Administration → Users).
 */
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";

const [email, fullName = "", flag] = process.argv.slice(2);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Usage: npm run create-admin -- <email> "<full name>" [--password]');
  process.exit(1);
}
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (see .env.example).");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function findUser(address) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === address.toLowerCase());
    if (hit || data.users.length < 200) return hit ?? null;
  }
  return null;
}

let user = await findUser(email);

if (!user) {
  if (flag === "--password") {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const password = await rl.question("Password (min 10 chars, upper+lower case and a number): ");
    rl.close();
    if (password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
      console.error("Password does not meet the policy.");
      process.exit(1);
    }
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : undefined,
    });
    if (error) throw error;
    user = data.user;
    console.log(`✓ Created ${email} with a password.`);
  } else {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${site}/auth/confirm?next=${encodeURIComponent("/reset-password?mode=invite")}`,
      data: fullName ? { full_name: fullName } : undefined,
    });
    if (error) {
      console.error(`Could not send the invitation: ${error.message}`);
      console.error("Configure Brevo SMTP in Supabase first, or re-run with --password.");
      process.exit(1);
    }
    user = data.user;
    console.log(`✓ Invitation e-mail sent to ${email}.`);
  }
}

const { data: profile, error: profileError } = await admin
  .from("profiles")
  .update({ role: "administrator", is_active: true, ...(fullName ? { full_name: fullName } : {}) })
  .eq("id", user.id)
  .select("id, email, role, is_active")
  .single();

if (profileError) {
  console.error(`Could not promote the profile: ${profileError.message}`);
  console.error("Make sure both migrations in supabase/migrations have been applied.");
  process.exit(1);
}

console.log(`✓ ${profile.email} is now an active ${profile.role}.`);
