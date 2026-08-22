HABITLY V1 + EXACT AUTHENTICATION INTEGRATION

Source preservation
-------------------
The original Habitly V1 application files are preserved unchanged:
- app.js
- styles.css
- README.txt
- existing V1 assets

Authentication
--------------
The exact supplied authentication page code is kept under /auth.
Its original authentication CSS is preserved byte-for-byte.
The authentication UI is presented as the entry gate before the V1 app.

Flow
----
1. New browser/session -> Login is the visible starting page.
2. New user -> Create Account -> Verify Email -> Login.
3. Existing verified user -> Login -> successful authentication.
4. Forgot Password -> Reset Password -> Reset Success -> Login.
5. Successful authentication -> the original Habitly V1 application is revealed.
6. Direct dashboard URLs are still visually blocked when there is no auth session.

Demo authentication
-------------------
- Verification code: 248613
- Accounts are stored in browser localStorage for this frontend-only demo.
- No real email is sent.
- Google button is a demo sign-in path.

Important
---------
The authentication layer is isolated from the V1 application. It uses an iframe
entry gate so the exact auth CSS cannot overwrite the original V1 dashboard,
habits, goals, calendar, statistics, or settings styles.
