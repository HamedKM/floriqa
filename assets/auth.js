// Floriqa — sign-in shared by the Artist panel and the Admin panel
// 1) e-mail  2) unknown → blocked | new → 6-digit code → create password | existing → password
(function () {
  const { sb, esc, toast } = window.Floriqa;

  function authFlow(box, { title = "Sign in", onDone }) {
    let email = "";
    const step = (html, bind) => { box.innerHTML = `<h2 style="margin-bottom:1rem">${title}</h2>${html}`; bind && bind(); };

    const askEmail = () => step(`
      <form id="fEmail">
        <label class="field"><span>E-mail</span><input type="email" name="email" required autocomplete="username" value="${esc(email)}"></label>
        <button class="btn primary" type="submit">Continue</button>
      </form>`, () => {
      const f = box.querySelector("#fEmail");
      f.email.focus();
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        email = f.email.value.trim().toLowerCase();
        const btn = f.querySelector("button"); btn.disabled = true;
        const { data, error } = await sb.rpc("floriqa_email_status", { p_email: email });
        btn.disabled = false;
        if (error) return toast("Something went wrong. Please try again.", "err");
        if (data === "existing") return askPassword();
        if (data === "new") return sendCode(false);
        step(`<p class="muted">This e-mail address is not registered with Floriqa.<br>Please contact the agency if you think this is a mistake.</p>
          <p style="margin-top:1rem"><button class="btn" id="back">Use another e-mail</button></p>`,
          () => box.querySelector("#back").onclick = askEmail);
      });
    });

    const askPassword = () => step(`
      <p class="muted" style="margin-bottom:.8rem">${esc(email)} · <a href="#" id="chg">change</a></p>
      <form id="fPw">
        <label class="field"><span>Password</span><input type="password" name="pw" required autocomplete="current-password"></label>
        <button class="btn primary" type="submit">Sign in</button>
        <p style="margin-top:.8rem"><a href="#" id="forgot" class="muted">Forgot your password?</a></p>
      </form>`, () => {
      box.querySelector("#chg").onclick = (e) => { e.preventDefault(); askEmail(); };
      box.querySelector("#forgot").onclick = (e) => { e.preventDefault(); sendCode(true); };
      const f = box.querySelector("#fPw"); f.pw.focus();
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        const { error } = await sb.auth.signInWithPassword({ email, password: f.pw.value });
        if (error) return toast("Wrong password.", "err");
        onDone();
      });
    });

    async function sendCode(reset) {
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) return toast(/rate|seconds/i.test(error.message) ? "Please wait a minute before asking for a new code." : error.message, "err");
      step(`
        <p class="muted" style="margin-bottom:.8rem">${reset ? "To reset your password, enter" : "First sign-in: enter"} the 6-digit code we just sent to <b>${esc(email)}</b>.</p>
        <form id="fCode">
          <label class="field"><span>Code</span><input type="text" name="code" required inputmode="numeric" autocomplete="one-time-code" maxlength="8" style="letter-spacing:.4em;font-size:1.3rem"></label>
          <button class="btn primary" type="submit">Verify</button>
          <p style="margin-top:.8rem"><a href="#" id="again" class="muted">Send a new code</a> · <a href="#" id="chg" class="muted">change e-mail</a></p>
        </form>`, () => {
        box.querySelector("#again").onclick = (e) => { e.preventDefault(); sendCode(reset); };
        box.querySelector("#chg").onclick = (e) => { e.preventDefault(); askEmail(); };
        const f = box.querySelector("#fCode"); f.code.focus();
        f.addEventListener("submit", async (e) => {
          e.preventDefault();
          const { error } = await sb.auth.verifyOtp({ email, token: f.code.value.trim(), type: "email" });
          if (error) return toast("Invalid or expired code.", "err");
          createPassword(reset);
        });
      });
    }

    const createPassword = (reset) => step(`
      <p class="muted" style="margin-bottom:.8rem">${reset ? "Choose a new password." : "Welcome! Create your password."}</p>
      <form id="fNew">
        <label class="field"><span>Password (8 characters minimum)</span><input type="password" name="pw" required minlength="8" autocomplete="new-password"></label>
        <label class="field"><span>Confirm password</span><input type="password" name="pw2" required minlength="8" autocomplete="new-password"></label>
        <button class="btn primary" type="submit">Save password</button>
      </form>`, () => {
      const f = box.querySelector("#fNew"); f.pw.focus();
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (f.pw.value !== f.pw2.value) return toast("The two passwords don't match.", "err");
        const { error } = await sb.auth.updateUser({ password: f.pw.value });
        if (error) return toast(error.message, "err");
        toast("Password saved.");
        onDone();
      });
    });

    askEmail();
  }

  window.Floriqa.authFlow = authFlow;
})();

// ---------- Settings (name, e-mail, password) — shared by the panels ----------
(function () {
  const { sb, esc, toast } = window.Floriqa;
  window.Floriqa.accountSettings = function (box, { name, email, redirect }) {
    box.innerHTML = `
      <div class="card"><h3 style="margin-bottom:.8rem">Display name</h3>
        <form id="sName" class="toolbar"><input type="text" name="name" required maxlength="80" value="${esc(name || "")}" class="grow" style="max-width:320px"><button class="btn primary" type="submit">Save</button></form></div>
      <div class="card"><h3 style="margin-bottom:.4rem">E-mail address</h3>
        <p class="muted" style="margin-bottom:.8rem">Current: <b>${esc(email || "")}</b>. We'll send a confirmation link to the new address${" "}(and to the current one). Your access follows your new address once confirmed.</p>
        <form id="sMail" class="toolbar"><input type="email" name="email" required placeholder="new e-mail" class="grow" style="max-width:320px"><button class="btn primary" type="submit">Change e-mail</button></form></div>
      <div class="card"><h3 style="margin-bottom:.8rem">Password</h3>
        <form id="sPw">
          <label class="field"><span>Current password</span><input type="password" name="cur" required autocomplete="current-password"></label>
          <div class="row2">
            <label class="field"><span>New password (8+ characters)</span><input type="password" name="pw" required minlength="8" autocomplete="new-password"></label>
            <label class="field"><span>Confirm new password</span><input type="password" name="pw2" required minlength="8" autocomplete="new-password"></label>
          </div>
          <button class="btn primary" type="submit">Change password</button>
        </form></div>`;
    box.querySelector("#sName").onsubmit = async (e) => {
      e.preventDefault();
      const { error } = await sb.rpc("floriqa_set_my_name", { p_name: e.target.name.value });
      toast(error ? "Error: " + error.message : "Name saved.", error ? "err" : "ok");
    };
    box.querySelector("#sMail").onsubmit = async (e) => {
      e.preventDefault();
      const n = e.target.email.value.trim().toLowerCase();
      if (n === (email || "").toLowerCase()) return toast("That's already your e-mail.", "err");
      const { error } = await sb.auth.updateUser({ email: n }, { emailRedirectTo: redirect });
      if (error) return toast("Error: " + error.message, "err");
      e.target.reset();
      toast("Check your inbox(es) and click the confirmation link.");
    };
    box.querySelector("#sPw").onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      if (f.pw.value !== f.pw2.value) return toast("The two new passwords don't match.", "err");
      const { error: e1 } = await sb.auth.signInWithPassword({ email, password: f.cur.value });
      if (e1) return toast("Current password is wrong.", "err");
      const { error } = await sb.auth.updateUser({ password: f.pw.value });
      if (error) return toast("Error: " + error.message, "err");
      f.reset(); toast("Password changed.");
    };
  };
})();
