const view = document.getElementById("view");
const status = document.getElementById("status");

const routes = { login: renderLogin, signup: renderSignup, verify: renderVerify, forgot: renderForgot, reset: renderReset, success: renderSuccess };
const ACCOUNT_STORAGE = "habitly.auth.accounts.v1";
const DEMO_CODE = "248613";
let state = { email: "", name: "", demoCode: DEMO_CODE };

function getAccounts(){ try { return JSON.parse(localStorage.getItem(ACCOUNT_STORAGE) || "{}"); } catch { return {}; } }
function saveAccounts(accounts){ localStorage.setItem(ACCOUNT_STORAGE, JSON.stringify(accounts)); }
function normalizeEmail(email){ return String(email || "").trim().toLowerCase(); }
function announce(message){ status.textContent = message; }
function notifyParent(type, detail={}){ window.parent.postMessage({ source:"habitly-auth", type, ...detail }, "*"); }
function navigate(route){ (routes[route] || routes.login)(); view.focus(); history.replaceState({route}, "", `#${route}`); announce(`${document.title}. ${route} page loaded.`); }
function icon(type){ const icons={user:"♙",mail:"✉",lock:"♙"}; return `<span class="field-icon" aria-hidden="true">${icons[type] || ""}</span>`; }
function passwordField(id,label,placeholder){ return `<div class="field"><label for="${id}">${label}</label><div class="input-wrap">${icon("lock")}<input class="input" id="${id}" name="${id}" type="password" placeholder="${placeholder}" autocomplete="${id.includes("confirm")?"new-password":"current-password"}"><button class="password-toggle" type="button" aria-label="Show password" data-password="${id}">◉</button></div></div>`; }
function shell({eyebrow,title,subtitle="",back=true,content}){ return `${back?`<button class="back" type="button" data-route="login" aria-label="Back to login">← <span>Back</span></button>`:""}<p class="eyebrow">${eyebrow}</p><h1>${title}</h1>${subtitle?`<p class="subtitle">${subtitle}</p>`:""}${content}`; }

function renderLogin(){
 view.innerHTML=shell({eyebrow:"WELCOME BACK",title:`Welcome back<br>to <span class="accent">Habitly</span>`,subtitle:"Continue with your profile to pick up where you left off.",back:false,content:`
 <form class="form" id="login-form" novalidate>
  <div class="field"><label for="login-email">Email address</label><div class="input-wrap">${icon("mail")}<input class="input" id="login-email" type="email" autocomplete="email" placeholder="Enter your email" required></div></div>
  ${passwordField("login-password","Password","Enter your password")}
  <div class="row"><label class="check"><input type="checkbox" id="remember"><span>Remember me</span></label><button class="text-link" type="button" data-route="forgot">Forgot password?</button></div>
  <div class="status" id="login-status" role="status"></div><button class="primary-btn" type="submit">Log In</button>
  <div class="divider" aria-hidden="true"><span>or</span></div>
  <button class="google-btn" type="button" data-google><img src="assets/google.svg" alt=""> Continue with Google</button>
  <p class="bottom-note">New here?<button class="text-link" type="button" data-route="signup">Create an account</button></p>
 </form>`});
}
function renderSignup(){
 view.innerHTML=shell({eyebrow:"CREATE ACCOUNT",title:`Create your<br><span class="accent">Habitly</span> account`,subtitle:"Start your journey towards a better you.",content:`
 <form class="form" id="signup-form" novalidate>
  <div class="field"><label for="signup-name">Full name</label><div class="input-wrap">${icon("user")}<input class="input" id="signup-name" type="text" autocomplete="name" placeholder="Enter your full name" required></div></div>
  <div class="field"><label for="signup-email">Email address</label><div class="input-wrap">${icon("mail")}<input class="input" id="signup-email" type="email" autocomplete="email" placeholder="Enter your email" required></div></div>
  ${passwordField("signup-password","Password","Create a password")}${passwordField("signup-confirm","Confirm password","Confirm your password")}
  <label class="consent"><input type="checkbox" id="terms" required><span>I agree to the <a class="text-link" href="#" onclick="return false">Terms of Service</a> and <a class="text-link" href="#" onclick="return false">Privacy Policy</a></span></label>
  <div class="status" id="signup-status" role="status"></div><button class="primary-btn" type="submit">Create Account</button>
  <div class="divider" aria-hidden="true"><span>or</span></div><button class="google-btn" type="button" data-google><img src="assets/google.svg" alt=""> Continue with Google</button>
  <p class="bottom-note">Already have an account?<button class="text-link" type="button" data-route="login">Sign in</button></p>
 </form>`});
}
function renderVerify(){
 const email=state.email || "";
 view.innerHTML=shell({eyebrow:"VERIFY YOUR EMAIL",title:`Verify your <span class="accent">email</span>`,subtitle:`We've sent a 6-digit verification code to <strong>${escapeHtml(email)}</strong>`,content:`
 <form class="form" id="verify-form" novalidate><div class="otp" aria-label="6 digit verification code">${[1,2,3,4,5,6].map((n,i)=>`<input id="otp-${n}" inputmode="numeric" pattern="[0-9]*" maxlength="1" aria-label="Digit ${n}" autocomplete="${i===0?"one-time-code":"off"}">`).join("")}</div>
 <p class="resend">Didn't receive the code? <button type="button" id="resend">Resend code <span id="timer"></span></button></p><div class="status" id="verify-status" role="status"></div>
 <button class="primary-btn" type="submit">Verify Email</button><button class="secondary-btn" type="button" data-route="login">Change email</button><p class="bottom-note">Wrong email? <button class="text-link" type="button" data-route="login">Go back</button></p></form>`});
 setupOtp(); startTimer();
}
function renderForgot(){
 view.innerHTML=shell({eyebrow:"FORGOT PASSWORD",title:`Forgot your<br><span class="accent">password?</span>`,subtitle:"No worries! Enter your email address and we'll send you a link to reset your password.",content:`
 <form class="form" id="forgot-form" novalidate><div class="field"><label for="forgot-email">Email address</label><div class="input-wrap">${icon("mail")}<input class="input" id="forgot-email" type="email" autocomplete="email" placeholder="Enter your email" required></div></div>
 <div class="status" id="forgot-status" role="status"></div><button class="primary-btn" type="submit">Send Reset Link</button><p class="bottom-note">Remember your password?<button class="text-link" type="button" data-route="login">Log in</button></p></form>`});
}
function renderReset(){
 view.innerHTML=shell({eyebrow:"RESET PASSWORD",title:`Set a new <span class="accent">password</span>`,subtitle:"Your new password must be different from previously used passwords.",content:`
 <form class="form" id="reset-form" novalidate>${passwordField("reset-password","New password","Enter new password")}${passwordField("reset-confirm","Confirm new password","Confirm new password")}
 <div class="hint">Use at least 8 characters, include a number, and include an uppercase letter.</div><div class="status" id="reset-status" role="status"></div><button class="primary-btn" type="submit">Reset Password</button></form>`});
}
function renderSuccess(){ view.innerHTML=`<div class="success" role="status"><div class="success-icon" aria-hidden="true">✓</div><p class="eyebrow">SUCCESS</p><h1>Password reset <span class="accent">successful!</span></h1><p>Your password has been reset successfully. You can now sign in with your new password.</p><button class="primary-btn" type="button" data-route="login">Go to Sign In</button></div>`; }
function escapeHtml(value){ return String(value||"").replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char])); }
function validateEmail(value){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function setStatus(id,message){ const el=document.getElementById(id); if(el)el.textContent=message; }
function setupOtp(){ const inputs=[...document.querySelectorAll(".otp input")]; inputs.forEach((input,index)=>{input.addEventListener("input",()=>{input.value=input.value.replace(/\D/g,"").slice(0,1);if(input.value&&inputs[index+1])inputs[index+1].focus();});input.addEventListener("keydown",e=>{if(e.key==="Backspace"&&!input.value&&inputs[index-1])inputs[index-1].focus();if(e.key==="ArrowLeft"&&inputs[index-1])inputs[index-1].focus();if(e.key==="ArrowRight"&&inputs[index+1])inputs[index+1].focus();});input.addEventListener("paste",e=>{const text=(e.clipboardData.getData("text")||"").replace(/\D/g,"").slice(0,6);if(!text)return;e.preventDefault();inputs.forEach((field,i)=>field.value=text[i]||"");inputs[Math.min(text.length,6)-1]?.focus();});}); }
function startTimer(){let seconds=28;const timer=document.getElementById("timer"),resend=document.getElementById("resend");if(!timer||!resend)return;resend.disabled=true;const tick=()=>{timer.textContent=`(${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")})`;if(seconds<=0){resend.disabled=false;timer.textContent="";return;}seconds--;setTimeout(tick,1000);};tick();}

function completeLogin(email){ localStorage.setItem("habitly.auth.session", JSON.stringify({email,loggedIn:true,at:Date.now()})); notifyParent("AUTH_SUCCESS",{email}); }

// Keep the reference UI intact; only the authentication behavior is connected to the parent V1 application.
document.addEventListener("click",e=>{
 const routeEl=e.target.closest("[data-route]"); if(routeEl){e.preventDefault();navigate(routeEl.dataset.route);return;}
 const toggle=e.target.closest("[data-password]"); if(toggle){const input=document.getElementById(toggle.dataset.password);if(!input)return;const showing=input.type==="text";input.type=showing?"password":"text";toggle.setAttribute("aria-label",showing?"Show password":"Hide password");}
 const google=e.target.closest("[data-google]"); if(google){completeLogin("google.user@demo.habitly");}
 const resend=e.target.closest("#resend"); if(resend&&!resend.disabled){announce("A new demo verification code was sent. Code: 248613");startTimer();}
});

document.addEventListener("submit",e=>{
 e.preventDefault();
 if(e.target.id==="login-form"){
  const email=document.getElementById("login-email"),password=document.getElementById("login-password"),key=normalizeEmail(email.value),accounts=getAccounts();
  if(!validateEmail(email.value))return setStatus("login-status","Enter a valid email address.");
  if(!password.value)return setStatus("login-status","Enter your password.");
  if(!accounts[key])return setStatus("login-status","No account found. Create an account first.");
  if(!accounts[key].verified)return setStatus("login-status","Please verify your email before signing in.");
  if(accounts[key].password!==password.value)return setStatus("login-status","Incorrect password. Please try again.");
  state.email=key;completeLogin(key);
 }
 if(e.target.id==="signup-form"){
  const name=document.getElementById("signup-name"),email=document.getElementById("signup-email"),password=document.getElementById("signup-password"),confirm=document.getElementById("signup-confirm"),terms=document.getElementById("terms"),key=normalizeEmail(email.value),accounts=getAccounts();
  if(!name.value.trim())return setStatus("signup-status","Enter your full name.");
  if(!validateEmail(email.value))return setStatus("signup-status","Enter a valid email address.");
  if(accounts[key])return setStatus("signup-status","An account with this email already exists.");
  if(password.value.length<8)return setStatus("signup-status","Password must contain at least 8 characters.");
  if(!/[A-Z]/.test(password.value))return setStatus("signup-status","Include at least one uppercase letter.");
  if(!/[0-9]/.test(password.value))return setStatus("signup-status","Include at least one number.");
  if(password.value!==confirm.value)return setStatus("signup-status","Passwords do not match.");
  if(!terms.checked)return setStatus("signup-status","Please agree to the Terms of Service and Privacy Policy.");
  state.name=name.value.trim();state.email=key;accounts[key]={name:state.name,email:key,password:password.value,verified:false};saveAccounts(accounts);navigate("verify");
 }
 if(e.target.id==="verify-form"){
  const code=[...document.querySelectorAll(".otp input")].map(x=>x.value).join(""),accounts=getAccounts(),key=normalizeEmail(state.email);
  if(code.length!==6)return setStatus("verify-status","Enter all 6 verification digits.");
  if(code!==DEMO_CODE)return setStatus("verify-status","Demo code is 248613. Please check the code and try again.");
  if(!accounts[key])return setStatus("verify-status","Account not found. Please create the account again.");
  accounts[key].verified=true;saveAccounts(accounts);navigate("login");setStatus("login-status","Email verified. You can now sign in.");announce("Email verified successfully. You can now sign in.");
 }
 if(e.target.id==="forgot-form"){
  const email=document.getElementById("forgot-email"),key=normalizeEmail(email.value),accounts=getAccounts();
  if(!validateEmail(email.value))return setStatus("forgot-status","Enter a valid email address.");
  if(!accounts[key])return setStatus("forgot-status","No account found with this email address.");
  state.email=key;navigate("reset");
 }
 if(e.target.id==="reset-form"){
  const password=document.getElementById("reset-password"),confirm=document.getElementById("reset-confirm"),key=normalizeEmail(state.email),accounts=getAccounts();
  if(password.value.length<8)return setStatus("reset-status","Use at least 8 characters.");
  if(!/[A-Z]/.test(password.value))return setStatus("reset-status","Include at least one uppercase letter.");
  if(!/[0-9]/.test(password.value))return setStatus("reset-status","Include at least one number.");
  if(password.value!==confirm.value)return setStatus("reset-status","Passwords do not match.");
  if(!accounts[key])return setStatus("reset-status","Account not found. Please return to sign in.");
  accounts[key].password=password.value;saveAccounts(accounts);navigate("success");
 }
});

window.addEventListener("popstate",()=>navigate(location.hash.slice(1)||"login"));
navigate(location.hash.slice(1)||"login");
