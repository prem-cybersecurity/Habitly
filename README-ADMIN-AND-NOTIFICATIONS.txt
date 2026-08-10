HABITLY BY PRK — WELCOME + PRIVATE ADMIN + REMINDER NOTIFICATIONS

WHAT THIS VERSION DOES
1. First-use welcome page asks for name + email.
2. The welcome page uses the premium colorful Habitly style.
3. Dark mode is the default theme.
4. The visitor-record checkbox starts checked, but the visitor can uncheck it. If unchecked, the profile is kept locally and is not sent to the visitor registry.
5. Habit data and progress remain in LocalStorage.
6. If Supabase is configured and the visitor-record checkbox is enabled, name/email are added to the small visitor registry.
7. /admin.html provides a separate private admin login and visitor table.
8. Reminder notifications can be enabled from Settings.

YOUR ADMIN
Admin email: prem.cybersecurity@gmail.com
The phone number 8190866405 is NOT used as an admin credential.
Create the Supabase Auth account with the admin email above and set an admin role for that user's UUID.

SUPABASE SETUP
1. Go to https://supabase.com/ and create a project.
2. Open SQL Editor in the Supabase dashboard.
3. Open the included supabase-schema.sql file, copy all of it, paste it into SQL Editor, and Run it.
4. Open Authentication -> Users. Create the admin user with:
   Email: prem.cybersecurity@gmail.com
   Password: choose a strong password that only you know.
5. Copy the UUID of that user.
6. Return to SQL Editor and run:
   insert into public.user_roles(user_id, role) values ('PASTE-YOUR-ADMIN-UUID-HERE', 'admin');
7. Open Project Settings -> API Keys (or the project's Connect dialog).
8. Copy the Project URL and the Publishable key (sb_publishable_...). If your project only shows the legacy client key, the anon key can be used for this older setup. NEVER use a secret/service_role key in the browser.
9. Open config.js and set:
   supabaseUrl: 'YOUR_PROJECT_URL',
   supabaseAnonKey: 'YOUR_PUBLISHABLE_KEY'
   Leave adminEmail as prem.cybersecurity@gmail.com.
10. Deploy the folder over HTTPS.
11. Open /admin.html. Sign in using prem.cybersecurity@gmail.com and the password you created.
12. If the account has the admin role, the visitor table will load.

IMPORTANT SECURITY
- The browser may contain the Supabase publishable/anon key. That key is not a password.
- NEVER put a Supabase secret/service_role key into config.js.
- Admin access is enforced by Supabase Auth plus the user_roles table and the configured admin email.
- RLS policies in supabase-schema.sql prevent ordinary authenticated users from reading the visitor table.

VISITOR RECORDS
- Local profile: name + email + preference are stored in the visitor's browser.
- Remote registry: only name/email are sent when the visitor leaves the record-sharing checkbox enabled and Supabase is configured.
- Habit history, goals, notes and other personal tracker data remain local.

REMINDER NOTIFICATIONS
- Open Habitly -> Settings -> Reminder Notifications -> Enable.
- Allow browser notifications.
- A notification appears when a scheduled reminder is due while Habitly is open.
- This lightweight version does not guarantee notifications after the browser is completely closed. Reliable background push requires a push service/server.

NEW UI NOTES
- Export, Import and Reset are highlighted as red action buttons.
- Profile includes a Log Out action. In this local-only app, logging out clears the local profile and habit data from the current browser and returns to the welcome screen. It does not delete the visitor registry entry in Supabase.
- Use admin.html for the real Supabase-protected admin area.
