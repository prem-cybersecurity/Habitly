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


## Cross-device architecture
Habitly uses Supabase as the only active cross-device source of truth. Browser localStorage is only a performance/offline cache. Google Drive is not required for cross-device synchronization.

### Required Supabase setup
Run `supabase-schema.sql` in the Supabase SQL Editor, including the `habitly_sync_documents_v2` table, its RLS policy, `commit_habitly_sync_v2()` RPC, and Realtime publication entry.
