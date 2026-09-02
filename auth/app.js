const view = document.getElementById("view");
const status = document.getElementById("status");

const habitlyAuth = window.habitlySupabase;

const routes = {
    login: renderLogin,
    signup: renderSignup,
    verify: renderVerify,
    forgot: renderForgot,
    reset: renderReset,
    success: renderSuccess
};

let state = {
    email: "",
    name: ""
};

let googleOAuthInFlight = false;

function announce(message) {
    if (status) {
        status.textContent = message;
    }
}

function notifyParent(type, detail = {}) {
    window.parent.postMessage(
        {
            source: "habitly-auth",
            type,
            ...detail
        },
        "*"
    );
}

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(value) {
    return String(value || "").replace(
        /[&<>"']/g,
        char =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#039;"
            })[char]
    );
}

function setStatus(id, message) {
    const el = document.getElementById(id);

    if (el) {
        el.textContent = message;
    }
}

function ensurehabitlyAuth() {
    if (!habitlyAuth) {
        console.error("Habitly habitlyAuth client was not initialized.");
        announce("Authentication service is unavailable.");
        return false;
    }

    return true;
}

function getRedirectUrl() {
    return `${window.top.location.origin}/index.html`;
}

function icon(type) {
    const icons = {
        user: "♙",
        mail: "✉",
        lock: "♙"
    };

    return `<span class="field-icon" aria-hidden="true">${icons[type] || ""}</span>`;
}

function passwordField(id, label, placeholder) {
    return `
    <div class="field">
      <label for="${id}">${label}</label>

      <div class="input-wrap">
        ${icon("lock")}

        <input
          class="input"
          id="${id}"
          name="${id}"
          type="password"
          placeholder="${placeholder}"
          autocomplete="${id.includes("confirm")
            ? "new-password"
            : id.includes("reset")
                ? "new-password"
                : "current-password"
        }"
        >

        <button
          class="password-toggle"
          type="button"
          aria-label="Show password"
          data-password="${id}"
        >
          <svg class="password-eye" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path>
            <circle cx="12" cy="12" r="2.5"></circle>
          </svg>
        </button>
      </div>
    </div>
  `;
}

function shell({
    eyebrow,
    title,
    subtitle = "",
    back = true,
    content
}) {
    return `
    ${back
            ? `
          <button
            class="back"
            type="button"
            data-route="login"
            aria-label="Back to login"
          >
            ← <span>Back</span>
          </button>
        `
            : ""
        }

    <p class="eyebrow">${eyebrow}</p>

    <h1>${title}</h1>

    ${subtitle
            ? `<p class="subtitle">${subtitle}</p>`
            : ""
        }

    ${content}
  `;
}

/* =========================================================
   LOGIN
========================================================= */

function renderLogin() {
    view.innerHTML = shell({
        eyebrow: "WELCOME BACK",

        title: `
      Welcome back<br>
      to <span class="accent">Habitly</span>
    `,

        subtitle:
            "Continue with your profile to pick up where you left off.",

        back: false,

        content: `
      <form class="form" id="login-form" novalidate>

        <div class="field">
          <label for="login-email">
            Email address
          </label>

          <div class="input-wrap">
            ${icon("mail")}

            <input
              class="input"
              id="login-email"
              type="email"
              autocomplete="email"
              placeholder="Enter your email"
              required
            >
          </div>
        </div>

        ${passwordField(
            "login-password",
            "Password",
            "Enter your password"
        )}

        <div class="row">

          <label class="check">
            <input
              type="checkbox"
              id="remember"
            >
            <span>Remember me</span>
          </label>

          <button
            class="text-link"
            type="button"
            data-route="forgot"
          >
            Forgot password?
          </button>

        </div>

        <div
          class="status"
          id="login-status"
          role="status"
        ></div>

        <button
          class="primary-btn"
          type="submit"
        >
          Log In
        </button>

        <div
          class="divider"
          aria-hidden="true"
        >
          <span>or</span>
        </div>

        <button
          class="google-btn"
          type="button"
          data-google
        >
          <img src="assets/google.svg" alt="">
          Continue with Google
        </button>

        <p class="bottom-note">
          New here?

          <button
            class="text-link"
            type="button"
            data-route="signup"
          >
            Create an account
          </button>
        </p>

      </form>
    `
    });
}

/* =========================================================
   SIGNUP
========================================================= */

function renderSignup() {
    view.innerHTML = shell({
        eyebrow: "CREATE ACCOUNT",

        title: `
      Create your<br>
      <span class="accent">Habitly</span> account
    `,

        subtitle:
            "Start your journey towards a better you.",

        content: `
      <form class="form" id="signup-form" novalidate>

        <div class="field">
          <label for="signup-name">
            Full name
          </label>

          <div class="input-wrap">
            ${icon("user")}

            <input
              class="input"
              id="signup-name"
              type="text"
              autocomplete="name"
              placeholder="Enter your full name"
              required
            >
          </div>
        </div>

        <div class="field">
          <label for="signup-email">
            Email address
          </label>

          <div class="input-wrap">
            ${icon("mail")}

            <input
              class="input"
              id="signup-email"
              type="email"
              autocomplete="email"
              placeholder="Enter your email"
              required
            >
          </div>
        </div>

        ${passwordField(
            "signup-password",
            "Password",
            "Create a password"
        )}

        ${passwordField(
            "signup-confirm",
            "Confirm password",
            "Confirm your password"
        )}

        <label class="consent">

          <input
            type="checkbox"
            id="terms"
            required
          >

          <span>
            I agree to the
            <a
              class="text-link"
              href="#"
              onclick="return false"
            >
              Terms of Service
            </a>

            and

            <a
              class="text-link"
              href="#"
              onclick="return false"
            >
              Privacy Policy
            </a>
          </span>

        </label>

        <div
          class="status"
          id="signup-status"
          role="status"
        ></div>

        <button
          class="primary-btn"
          type="submit"
        >
          Create Account
        </button>

        <div
          class="divider"
          aria-hidden="true"
        >
          <span>or</span>
        </div>

        <button
          class="google-btn"
          type="button"
          data-google
        >
          <img src="assets/google.svg" alt="">
          Continue with Google
        </button>

        <p class="bottom-note">
          Already have an account?

          <button
            class="text-link"
            type="button"
            data-route="login"
          >
            Sign in
          </button>
        </p>

      </form>
    `
    });
}

/* =========================================================
   REAL EMAIL VERIFICATION
========================================================= */

function renderVerify() {
    const email = state.email || "";

    view.innerHTML = shell({
        eyebrow: "CHECK YOUR EMAIL",

        title: `
      Verify your
      <span class="accent">email</span>
    `,

        subtitle: `
      We've sent a confirmation link to
      <strong>${escapeHtml(email)}</strong>.
    `,

        content: `
      <div class="form">

        <div class="status" id="verify-status" role="status">
          Open your email and click the confirmation link to activate your Habitly account.
        </div>

        <button
          class="primary-btn"
          type="button"
          id="resend"
        >
          Resend confirmation email
        </button>

        <button
          class="secondary-btn"
          type="button"
          data-route="login"
        >
          Back to Sign In
        </button>

        <p class="bottom-note">
          Already confirmed your email?

          <button
            class="text-link"
            type="button"
            data-route="login"
          >
            Sign in
          </button>
        </p>

      </div>
    `
    });
}

/* =========================================================
   FORGOT PASSWORD
========================================================= */

function renderForgot() {
    view.innerHTML = shell({
        eyebrow: "FORGOT PASSWORD",

        title: `
      Forgot your<br>
      <span class="accent">password?</span>
    `,

        subtitle:
            "Enter your email address and we'll send you a password reset link.",

        content: `
      <form
        class="form"
        id="forgot-form"
        novalidate
      >

        <div class="field">

          <label for="forgot-email">
            Email address
          </label>

          <div class="input-wrap">
            ${icon("mail")}

            <input
              class="input"
              id="forgot-email"
              type="email"
              autocomplete="email"
              placeholder="Enter your email"
              required
            >
          </div>

        </div>

        <div
          class="status"
          id="forgot-status"
          role="status"
        ></div>

        <button
          class="primary-btn"
          type="submit"
        >
          Send Reset Link
        </button>

        <p class="bottom-note">
          Remember your password?

          <button
            class="text-link"
            type="button"
            data-route="login"
          >
            Log in
          </button>
        </p>

      </form>
    `
    });
}

/* =========================================================
   RESET PASSWORD
========================================================= */

function renderReset() {
    view.innerHTML = shell({
        eyebrow: "RESET PASSWORD",

        title: `
      Set a new
      <span class="accent">password</span>
    `,

        subtitle:
            "Choose a new password for your Habitly account.",

        content: `
      <form
        class="form"
        id="reset-form"
        novalidate
      >

        ${passwordField(
            "reset-password",
            "New password",
            "Enter new password"
        )}

        ${passwordField(
            "reset-confirm",
            "Confirm new password",
            "Confirm new password"
        )}

        <div class="hint">
          Use at least 8 characters, include a number,
          and include an uppercase letter.
        </div>

        <div
          class="status"
          id="reset-status"
          role="status"
        ></div>

        <button
          class="primary-btn"
          type="submit"
        >
          Reset Password
        </button>

      </form>
    `
    });
}

/* =========================================================
   SUCCESS
========================================================= */

function renderSuccess() {
    view.innerHTML = `
    <div
      class="success"
      role="status"
    >

      <div
        class="success-icon"
        aria-hidden="true"
      >
        ✓
      </div>

      <p class="eyebrow">
        SUCCESS
      </p>

      <h1>
        Password reset
        <span class="accent">successful!</span>
      </h1>

      <p>
        Your password has been reset successfully.
        You can now sign in with your new password.
      </p>

      <button
        class="primary-btn"
        type="button"
        data-route="login"
      >
        Go to Sign In
      </button>

    </div>
  `;
}

/* =========================================================
   ROUTING
========================================================= */

function navigate(route) {
    const renderer = routes[route] || routes.login;

    renderer();

    view.focus();

    history.replaceState(
        { route },
        "",
        `#${route}`
    );

    announce(
        `${document.title}. ${route} page loaded.`
    );
}

/* =========================================================
   OTP / PASSWORD TOGGLE
========================================================= */

document.addEventListener("click", async event => {

    const routeEl = event.target.closest("[data-route]");

    if (routeEl) {
        event.preventDefault();

        navigate(routeEl.dataset.route);

        return;
    }

    const toggle = event.target.closest("[data-password]");

    if (toggle) {

        const input = document.getElementById(
            toggle.dataset.password
        );

        if (!input) return;

        const showing = input.type === "text";

        input.type = showing
            ? "password"
            : "text";

        toggle.setAttribute(
            "aria-label",
            showing
                ? "Show password"
                : "Hide password"
        );

        toggle.innerHTML = showing
            ? `<svg class="password-eye" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.5"></circle></svg>`
            : `<svg class="password-eye" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"></path><path d="M10.6 6.2A10.6 10.6 0 0 1 12 6c6 0 9.5 6 9.5 6a16.8 16.8 0 0 1-3.2 3.7M6.2 6.2C3.8 7.8 2.5 12 2.5 12s3.5 6 9.5 6c1.1 0 2.1-.2 3-.5"></path></svg>`;

        return;
    }

/* =====================================================
   GOOGLE OAUTH
===================================================== */

const google = event.target.closest("[data-google]");

if (google) {

    event.preventDefault();

    if (!ensurehabitlyAuth() || googleOAuthInFlight) return;

    googleOAuthInFlight = true;
    google.disabled = true;

    const redirectUrl = getRedirectUrl();

    console.log(
        "Habitly Google OAuth redirect:",
        redirectUrl
    );

    const { data, error } =
        await habitlyAuth.auth.signInWithOAuth({
            provider: "google",

            options: {
                redirectTo: redirectUrl,
                skipBrowserRedirect: true
            }
        });

    if (error) {

        console.error(
            "Habitly Google OAuth error:",
            error
        );

        setStatus(
            "login-status",
            error.message
        );

        setStatus(
            "signup-status",
            error.message
        );

        googleOAuthInFlight = false;
        google.disabled = false;

        return;
    }

    if (!data?.url) {

        console.error(
            "Habitly Google OAuth did not return a URL."
        );

        setStatus(
            "login-status",
            "Unable to start Google sign-in."
        );

        googleOAuthInFlight = false;
        google.disabled = false;

        return;
    }

    /*
      The authentication page is inside an iframe.
      Navigate the TOP window so Google OAuth is not
      trapped inside the authentication iframe.
    */
    window.top.location.assign(data.url);

    return;
}

    /* =====================================================
       RESEND CONFIRMATION
    ===================================================== */

    const resend = event.target.closest("#resend");

    if (resend) {

        if (!ensurehabitlyAuth()) return;

        if (!state.email) {

            setStatus(
                "verify-status",
                "Please return to sign up again."
            );

            return;
        }

        resend.disabled = true;

        const { error } =
            await habitlyAuth.auth.resend({
                type: "signup",
                email: state.email,

                options: {
                    emailRedirectTo: getRedirectUrl()
                }
            });

        if (error) {

            setStatus(
                "verify-status",
                error.message
            );

            resend.disabled = false;

            return;
        }

        setStatus(
            "verify-status",
            "A new confirmation email has been sent. Please check your inbox."
        );

        setTimeout(() => {
            resend.disabled = false;
        }, 30000);
    }
});

/* =========================================================
   FORM SUBMISSION
========================================================= */

document.addEventListener("submit", async event => {

    event.preventDefault();

    if (!ensurehabitlyAuth()) return;

    /* =====================================================
       LOGIN
    ===================================================== */

    if (event.target.id === "login-form") {

        const email =
            document.getElementById("login-email");

        const password =
            document.getElementById("login-password");

        const emailValue =
            normalizeEmail(email.value);

        if (!validateEmail(emailValue)) {

            setStatus(
                "login-status",
                "Enter a valid email address."
            );

            return;
        }

        if (!password.value) {

            setStatus(
                "login-status",
                "Enter your password."
            );

            return;
        }

        const {
            data,
            error
        } = await habitlyAuth.auth.signInWithPassword({
            email: emailValue,
            password: password.value
        });

        if (error) {

            console.error(error);

            if (
                error.message
                    .toLowerCase()
                    .includes("email not confirmed")
            ) {

                state.email = emailValue;

                navigate("verify");

                setStatus(
                    "verify-status",
                    "Please confirm your email address before signing in."
                );

                return;
            }

            setStatus(
                "login-status",
                error.message
            );

            return;
        }

        state.email = emailValue;
        // Supabase emits SIGNED_IN; the parent auth gate is the sole owner of
        // authenticated navigation. No second success message is necessary.
        return;
    }

    /* =====================================================
       SIGNUP
    ===================================================== */

    if (event.target.id === "signup-form") {

        const name =
            document.getElementById("signup-name");

        const email =
            document.getElementById("signup-email");

        const password =
            document.getElementById("signup-password");

        const confirm =
            document.getElementById("signup-confirm");

        const terms =
            document.getElementById("terms");

        const nameValue =
            name.value.trim();

        const emailValue =
            normalizeEmail(email.value);

        if (!nameValue) {

            setStatus(
                "signup-status",
                "Enter your full name."
            );

            return;
        }

        if (!validateEmail(emailValue)) {

            setStatus(
                "signup-status",
                "Enter a valid email address."
            );

            return;
        }

        if (password.value.length < 8) {

            setStatus(
                "signup-status",
                "Password must contain at least 8 characters."
            );

            return;
        }

        if (!/[A-Z]/.test(password.value)) {

            setStatus(
                "signup-status",
                "Include at least one uppercase letter."
            );

            return;
        }

        if (!/[0-9]/.test(password.value)) {

            setStatus(
                "signup-status",
                "Include at least one number."
            );

            return;
        }

        if (password.value !== confirm.value) {

            setStatus(
                "signup-status",
                "Passwords do not match."
            );

            return;
        }

        if (!terms.checked) {

            setStatus(
                "signup-status",
                "Please agree to the Terms of Service and Privacy Policy."
            );

            return;
        }

        state.name = nameValue;
        state.email = emailValue;

        const {
            data,
            error
        } = await habitlyAuth.auth.signUp({

            email: emailValue,

            password: password.value,

            options: {

                data: {
                    full_name: nameValue
                },

                emailRedirectTo: getRedirectUrl()
            }
        });

        if (error) {

            console.error(error);

            setStatus(
                "signup-status",
                error.message
            );

            return;
        }

        /*
          habitlyAuth may return a user with no session when
          email confirmation is required.
        */

        if (data.user) {

            navigate("verify");

            setStatus(
                "verify-status",
                `Confirmation email sent to ${emailValue}. Please check your inbox.`
            );

            return;
        }

        setStatus(
            "signup-status",
            "Account created. Please check your email to confirm your account."
        );
    }

    /* =====================================================
       FORGOT PASSWORD
    ===================================================== */

    if (event.target.id === "forgot-form") {

        const email =
            document.getElementById("forgot-email");

        const emailValue =
            normalizeEmail(email.value);

        if (!validateEmail(emailValue)) {

            setStatus(
                "forgot-status",
                "Enter a valid email address."
            );

            return;
        }

        state.email = emailValue;

        const {
            error
        } = await habitlyAuth.auth.resetPasswordForEmail(
            emailValue,
            {
                redirectTo:
                    `${window.location.origin}/auth/index.html#reset`
            }
        );

        if (error) {

            console.error(error);

            setStatus(
                "forgot-status",
                error.message
            );

            return;
        }

        setStatus(
            "forgot-status",
            "Password reset email sent. Check your inbox and follow the link."
        );
    }

    /* =====================================================
       RESET PASSWORD
    ===================================================== */

    if (event.target.id === "reset-form") {

        const password =
            document.getElementById("reset-password");

        const confirm =
            document.getElementById("reset-confirm");

        if (password.value.length < 8) {

            setStatus(
                "reset-status",
                "Use at least 8 characters."
            );

            return;
        }

        if (!/[A-Z]/.test(password.value)) {

            setStatus(
                "reset-status",
                "Include at least one uppercase letter."
            );

            return;
        }

        if (!/[0-9]/.test(password.value)) {

            setStatus(
                "reset-status",
                "Include at least one number."
            );

            return;
        }

        if (password.value !== confirm.value) {

            setStatus(
                "reset-status",
                "Passwords do not match."
            );

            return;
        }

        const {
            error
        } = await habitlyAuth.auth.updateUser({
            password: password.value
        });

        if (error) {

            console.error(error);

            setStatus(
                "reset-status",
                error.message
            );

            return;
        }

        await habitlyAuth.auth.signOut();

        navigate("success");
    }
});

/* =========================================================
   AUTH STATE
   The parent auth gate owns the single Supabase auth listener. This iframe
   only renders auth screens and reacts to explicit parent route messages.
========================================================= */

/* =========================================================
   HANDLE habitlyAuth REDIRECT
========================================================= */

async function initializeAuth() {

    if (!ensurehabitlyAuth()) return;

    const {
        data: {
            session
        }
    } = await habitlyAuth.auth.getSession();

    const hash =
        window.location.hash;

    /*
      Password recovery:
      habitlyAuth sends the user back with a recovery session.
    */

    if (
        hash.includes("access_token") ||
        hash.includes("type=recovery")
    ) {

        navigate("reset");

        return;
    }

    /*
      If the user already has a valid session,
      notify the main Habitly application.
    */

    if (session?.user) {
        // The parent window already received INITIAL_SESSION/SIGNED_IN from
        // Supabase. Do not emit a second success event from the iframe.
        return;
    }

    navigate(
        hash.startsWith("#")
            ? hash.substring(1)
            : "login"
    );
}

/* =========================================================
   BACK/FORWARD
========================================================= */

window.addEventListener(
    "popstate",
    () => {

        const route =
            location.hash
                .replace("#", "")
                .split("?")[0];

        navigate(
            routes[route]
                ? route
                : "login"
        );
    }
);

/* =========================================================
   PARENT (habitly-gate) ROUTE REQUESTS
   ---------------------------------------------------------
   The auth UI lives inside a persistent iframe: it is loaded
   once and never reloaded on logout. auth-gate.js posts an
   AUTH_ROUTE message whenever it needs this page to show a
   specific view (most importantly, "login" right after a
   logout). Without handling this message the iframe silently
   keeps showing whatever view it last rendered (verify,
   forgot, success, etc.), which is exactly why the login page
   used to appear missing/incomplete until a hard reload.
========================================================= */

let authReadyNotified = false;

function notifyAuthReady() {
    if (authReadyNotified) return;
    authReadyNotified = true;
    notifyParent("AUTH_READY");
}

window.addEventListener("message", event => {
    if (event.source !== window.parent) return;

    const data = event.data || {};
    if (data.source !== "habitly-gate") return;

    if (data.type === "AUTH_ROUTE") {
        // Always render a fresh view so no stale form, status
        // message, or disabled button survives a logout.
        state = { email: "", name: "" };
        navigate(routes[data.route] ? data.route : "login");
    }
});

initializeAuth();
notifyAuthReady();