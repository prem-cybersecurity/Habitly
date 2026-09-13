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
        window.location.origin
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

function friendlyAuthError(error, fallback = "Something went wrong. Please try again.") {
    const message = String(error?.message || "").toLowerCase();

    if (message.includes("invalid login credentials")) return "Email or password is incorrect.";
    if (message.includes("email not confirmed")) return "Please verify your email before signing in.";
    if (message.includes("too many requests") || message.includes("rate limit")) return "Too many attempts. Please wait a moment and try again.";
    if (message.includes("password should be at least") || message.includes("password must")) return "Your password does not meet the required security rules.";
    if (message.includes("user already registered")) return "This email is already registered. Try signing in instead.";
    if (message.includes("invalid or expired")) return "This code is invalid or has expired. Request a new code.";
    if (message.includes("email address") && message.includes("invalid")) return "Enter a valid email address.";

    return error?.message || fallback;
}

function showToast(message, { actionLabel = "", actionRoute = "", duration = 7000 } = {}) {
    document.querySelectorAll(".auth-toast").forEach(el => el.remove());

    const toast = document.createElement("div");
    toast.className = "auth-toast";
    toast.setAttribute("role", "status");
    toast.innerHTML = `
      <div class="auth-toast-icon" aria-hidden="true">!</div>
      <div class="auth-toast-body">
        <strong>${escapeHtml(message.split("\n")[0])}</strong>
        ${message.includes("\n") ? `<span>${escapeHtml(message.split("\n").slice(1).join(" "))}</span>` : ""}
      </div>
      ${actionLabel && actionRoute ? `<button class="auth-toast-action" type="button" data-route="${escapeHtml(actionRoute)}">${escapeHtml(actionLabel)} →</button>` : ""}
      <button class="auth-toast-close" type="button" aria-label="Close notification">×</button>
    `;

    document.body.appendChild(toast);

    const timer = setTimeout(() => toast.remove(), duration);
    toast.querySelector(".auth-toast-close")?.addEventListener("click", () => {
        clearTimeout(timer);
        toast.remove();
    });
}

function setButtonLoading(button, loading, label) {
    if (!button) return;
    if (loading) {
        button.dataset.originalLabel = button.textContent.trim();
        button.disabled = true;
        button.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span>${escapeHtml(label)}`;
    } else {
        button.disabled = false;
        button.textContent = button.dataset.originalLabel || label || "Continue";
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
    return `${window.location.origin}/index.html`;
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

        <div class="password-strength" id="signup-strength" aria-live="polite">
          <div class="password-strength-top">
            <span>Password strength</span>
            <strong id="signup-strength-label">Waiting for password</strong>
          </div>
          <div class="password-strength-bar"><span id="signup-strength-fill"></span></div>
          <div class="password-rules" id="signup-password-rules">
            <span data-rule="length">8+ characters</span>
            <span data-rule="upper">Uppercase letter</span>
            <span data-rule="number">Number</span>
          </div>
        </div>

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

    updateSignupPasswordStrength();
}

function updateSignupPasswordStrength() {
    const input = document.getElementById("signup-password");
    const label = document.getElementById("signup-strength-label");
    const fill = document.getElementById("signup-strength-fill");
    const rules = document.getElementById("signup-password-rules");
    if (!input || !label || !fill || !rules) return;

    const value = input.value;
    const checks = {
        length: value.length >= 8,
        upper: /[A-Z]/.test(value),
        number: /[0-9]/.test(value)
    };
    const score = Object.values(checks).filter(Boolean).length;
    Object.entries(checks).forEach(([key, ok]) => {
        rules.querySelector(`[data-rule="${key}"]`)?.classList.toggle("is-ok", ok);
    });

    const labels = ["Waiting for password", "Weak", "Fair", "Strong"];
    label.textContent = labels[score];
    label.dataset.level = String(score);
    fill.style.width = `${score * 33.333}%`;
}

/* =========================================================
   REAL EMAIL VERIFICATION
========================================================= */

function renderVerify() {
    const email = state.email || "";

    view.innerHTML = shell({
        eyebrow: "VERIFY YOUR EMAIL",

        title: `
      Enter your
      <span class="accent">verification code</span>
    `,

        subtitle: `
      We sent a 6-digit verification code to
      <strong>${escapeHtml(email)}</strong>.
    `,

        content: `
      <form class="form" id="verify-form" novalidate>

        <div class="field">
          <label for="verify-code">Verification code</label>

          <div class="input-wrap">
            ${icon("mail")}

            <input
              class="input"
              id="verify-code"
              name="verify-code"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              pattern="[0-9]{6}"
              maxlength="6"
              placeholder="Enter 6-digit code"
              aria-describedby="verify-status"
              required
            >
          </div>
        </div>

        <div class="status" id="verify-status" role="status">
          Enter the 6-digit code from your Habitly email.
        </div>

        <button class="primary-btn" type="submit" id="verify-submit">
          Verify Email
        </button>

        <button class="secondary-btn" type="button" id="resend">
          Resend verification code
        </button>

        <p class="bottom-note">
          Already verified?

          <button class="text-link" type="button" data-route="login">
            Sign in
          </button>
        </p>

      </form>
    `
    });

    const codeInput = document.getElementById("verify-code");
    codeInput?.addEventListener("input", () => {
        codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 6);
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
            "Enter your email and we'll send recovery instructions if an account is eligible for password recovery.",

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

    const toastClose = event.target.closest(".auth-toast-close");
    if (toastClose) {
        toastClose.closest(".auth-toast")?.remove();
        return;
    }

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
                friendlyAuthError(error)
            );

            resend.disabled = false;

            return;
        }

        setStatus(
            "verify-status",
            "A new verification code has been sent. Please check your inbox."
        );

        setTimeout(() => {
            resend.disabled = false;
        }, 30000);
    }
});

/* =========================================================
   LIVE PASSWORD STRENGTH
========================================================= */

document.addEventListener("input", event => {
    if (event.target?.id === "signup-password") updateSignupPasswordStrength();
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

        const loginButton = event.target.querySelector('button[type="submit"]');
        setButtonLoading(loginButton, true, "Signing in...");

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
                friendlyAuthError(error)
            );
            setButtonLoading(loginButton, false);

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

        const signupButton = event.target.querySelector('button[type="submit"]');
        setButtonLoading(signupButton, true, "Creating account...");

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
                friendlyAuthError(error)
            );
            setButtonLoading(signupButton, false);

            if (String(error.message || "").toLowerCase().includes("already registered")) {
                showToast("This email is already registered.\nTry signing in instead.", {
                    actionLabel: "Sign In",
                    actionRoute: "login"
                });
            }

            return;
        }

        /*
          Supabase can intentionally return an obfuscated existing user
          with an empty identities array. Never send that account to the
          verification screen. Keep the user on Sign Up and offer Login.
        */
        if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
            showToast("This email is already registered.\nTry signing in instead.", {
                actionLabel: "Sign In",
                actionRoute: "login"
            });
            setStatus(
                "signup-status",
                "This email is already registered. Try signing in instead."
            );
            setButtonLoading(signupButton, false);
            document.getElementById("signup-email")?.focus();
            return;
        }

        if (data?.user) {
            navigate("verify");
            setStatus(
                "verify-status",
                `Verification code sent to ${emailValue}. Please check your inbox.`
            );
            return;
        }

        setStatus(
            "signup-status",
            "Account created. Please check your email to confirm your account."
        );
    }

    /* =====================================================
       EMAIL VERIFICATION CODE
    ===================================================== */

    if (event.target.id === "verify-form") {
        const codeInput = document.getElementById("verify-code");
        const submit = document.getElementById("verify-submit");
        const code = String(codeInput?.value || "").replace(/\D/g, "");

        if (code.length !== 6) {
            setStatus(
                "verify-status",
                "Enter the 6-digit verification code from your email."
            );
            return;
        }

        if (!state.email) {
            setStatus(
                "verify-status",
                "Your verification session has expired. Please sign up again."
            );
            return;
        }

        setButtonLoading(submit, true, "Verifying...");
        setStatus("verify-status", "Verifying your email...");

        const { data, error } = await habitlyAuth.auth.verifyOtp({
            email: state.email,
            token: code,
            type: "signup"
        });

        if (error) {
            console.error("Habitly email verification error:", error);
            setStatus(
                "verify-status",
                friendlyAuthError(error, "Invalid or expired verification code.")
            );
            setButtonLoading(submit, false, "Verify Email");
            return;
        }

        if (data?.session?.user || data?.user) {
            setStatus(
                "verify-status",
                "Email verified successfully. Opening Habitly..."
            );
            // Supabase emits SIGNED_IN. The parent auth gate owns navigation.
            return;
        }

        setStatus(
            "verify-status",
            "Verification completed. Please sign in to continue."
        );
        setButtonLoading(submit, false, "Verify Email");
        return;
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
        const forgotButton = event.target.querySelector('button[type="submit"]');
        setButtonLoading(forgotButton, true, "Sending...");

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
                friendlyAuthError(error)
            );
            setButtonLoading(forgotButton, false);

            return;
        }

        setStatus(
            "forgot-status",
            "If this email is eligible for recovery, we've sent password reset instructions. Check your inbox."
        );
        setButtonLoading(forgotButton, false);
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

        const resetButton = event.target.querySelector('button[type="submit"]');
        setButtonLoading(resetButton, true, "Updating...");

        const {
            error
        } = await habitlyAuth.auth.updateUser({
            password: password.value
        });

        if (error) {

            console.error(error);

            setStatus(
                "reset-status",
                friendlyAuthError(error)
            );
            setButtonLoading(resetButton, false);

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