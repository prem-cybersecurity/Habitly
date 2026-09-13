# Habitly configuration

The uploaded v9 build contained test-only Supabase placeholders. They have been removed.

Before deploying Habitly on Netlify, put the real public Supabase project values into `config.js` under `BUILTIN_CONFIG`:

- `supabaseUrl`: your Supabase project URL, e.g. `https://<project-ref>.supabase.co`
- `supabaseAnonKey`: your Supabase **anon/public** key
- `googleDriveClientId`: your Google OAuth Web Client ID if Google Drive backup is used
- `adminEmail`: optional admin UI value

Never put a Supabase `service_role` key in browser code.

The app now fails closed when Supabase configuration is missing or invalid. It will not create a fake user or fake cloud database.

Google Drive remains backup/restore only and is disabled by default.


## Netlify deployment

This project is configured for Netlify. The repository uses `_headers` for security headers; `vercel.json` is intentionally not included.

## Admin setup

The Admin page requires BOTH:
1. A Supabase Auth account whose email matches `adminEmail`.
2. An `admin` row in `public.user_roles` for that Auth user's UUID.

After creating/signing into the admin account in Supabase Auth, run this once in the Supabase SQL Editor:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin'
from auth.users
where lower(email) = lower('prem.cybersecurity@gmail.com')
on conflict (user_id) do update set role = excluded.role;
```

Do not expose or add a Supabase service-role key to the browser.

Visitor records are created automatically when a user successfully authenticates through Habitly. The Admin page reads those records through the `admins may read visitors` RLS policy.


### Email verification
Habitly supports Supabase email-signup verification codes (6-digit OTP) on the verification screen. The Supabase Auth email template should provide the verification token/code. After `verifyOtp({ type: 'signup' })` succeeds, the authenticated session is handled by the parent auth gate.
