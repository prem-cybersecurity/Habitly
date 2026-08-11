HABITLY BY PRK — WELCOME + PRIVATE ADMIN + REMINDERS + ACHIEVEMENTS

WHAT THIS VERSION DOES
1. First-use welcome page asks only for name + email.
2. Welcome design uses the approved black / light-grey premium theme with a simple mountain path visual.
3. Dark mode is the default theme.
4. The visitor-record checkbox starts checked, but the visitor can uncheck it. If unchecked, the profile is kept locally and is not sent to the visitor registry.
5. Habit data and progress remain in LocalStorage.
6. If Supabase is configured and the visitor-record checkbox is enabled, name/email are added to the small visitor registry.
7. /admin.html provides a separate private admin login and visitor table.
8. Reminders can be added, edited and deleted from the dashboard or Settings.
9. Reminders support built-in sound previews: Gentle Bell, Soft Chime, Calm, Classic, Simple and None.
10. When Habitly is open, due reminders can show an in-app alert, play the selected sound and optionally show a browser notification.
11. Reminders support a 10-minute snooze action.
12. Achievements now include streaks, consistency and milestone collections with locked/unlocked progress.
13. Statistics, progress bars, goals and dashboard cards use the upgraded visual system with restrained accent colors.

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
- Local profile: name + email + record-sharing preference are stored in the visitor's browser.
- Remote registry: only name/email are sent when the visitor leaves the record-sharing checkbox enabled and Supabase is configured.
- Habit history, goals, notes, reminders and other personal tracker data remain local.
- The admin visitor table does not expose users' private habit history.

REMINDER NOTIFICATIONS
- Open Habitly -> Settings -> Reminder Notifications -> Enable.
- Allow browser notifications if you want browser alerts.
- A reminder can also show an in-app alert and play its selected sound while Habitly is open.
- Browser notification APIs do not provide a reliable cross-browser way for this site to force a custom sound when the page is closed. Reliable background push requires a push service/server.

DATA / LOGOUT
- Log Out returns to the welcome page and clears only the local profile/session marker.
- Habits and progress stay on the browser until the user chooses Reset All Data.
- Reset All Data permanently removes the local Habitly data and returns to the welcome page.
- The Supabase visitor record is not deleted by logout or local reset.

NEW UI NOTES
- Export, Import and Reset are highlighted as red action buttons.
- The sidebar contains Log Out; the dashboard date area contains the theme switch.
- The H favicon is used for the browser tab.
- Open Graph metadata/image is intentionally NOT included yet; it will be added as the final deployment/portfolio step.
