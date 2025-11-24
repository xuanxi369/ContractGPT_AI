// ====== script.js ======
// 保持原有逻辑，适配沉浸式UI

const API_BASE = "api/auth";
const gotoApp = () => location.href = "demo.html";

const $ = s => document.querySelector(s);
const jsonOrEmpty = async (r) => {
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("json")) { try { return await r.json(); } catch {} }
  return {};
};

// UI 交互：Tab 切换
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    
    document.querySelectorAll(".content-panel").forEach(p => p.classList.remove("show"));
    document.querySelector("#panel-" + btn.dataset.tab).classList.add("show");
    
    // 清空状态
    $("#login-msg").textContent = "";
    $("#reg-msg").textContent = "";
  };
});

/* ========== LOGIN LOGIC ========== */
const loginSendBtn = $("#login-send");
loginSendBtn.onclick = async () => {
  const email = $("#login-email").value.trim();
  const password = $("#login-password").value;
  
  if(!email || !password) {
    $("#login-msg").textContent = "Please enter email and password.";
    return;
  }

  $("#login-msg").textContent = "Authenticating...";

  // 倒计时逻辑
  loginSendBtn.disabled = true;
  let left = 60;
  const originalText = loginSendBtn.textContent;
  
  const timer = setInterval(() => {
    loginSendBtn.textContent = `Wait ${left--}s`;
    if (left < 0) {
      clearInterval(timer);
      loginSendBtn.textContent = originalText;
      loginSendBtn.disabled = false;
    }
  }, 1000);

  try {
    const r = await fetch(`${API_BASE}/login/start`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await jsonOrEmpty(r);
    
    if (!r.ok || !data.ok) {
      $("#login-msg").textContent = `Error: ${data.error || r.status}`;
      return;
    }
    
    if (data.code) {
      $("#login-code").value = String(data.code);
      $("#login-msg").textContent = "Code auto-filled. Please confirm.";
    } else {
      $("#login-msg").textContent = "Verification code sent to email.";
    }
    
    // 显示验证码输入区
    $("#login-code-row").classList.remove("hidden");
    // 聚焦到验证码框
    $("#login-code").focus();
    
  } catch {
    $("#login-msg").textContent = "Network Error";
  }
};

$("#login-verify").onclick = async () => {
  const email = $("#login-email").value.trim();
  const code = $("#login-code").value.trim();
  $("#login-msg").textContent = "Verifying...";
  
  try {
    const r = await fetch(`${API_BASE}/login/verify`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code })
    });
    const data = await jsonOrEmpty(r);
    
    if (!r.ok || !data.ok) {
      $("#login-msg").textContent = `Failed: ${data.error || r.status}`;
      return;
    }
    $("#login-msg").textContent = "Success. Entering system...";
    gotoApp();
  } catch {
    $("#login-msg").textContent = "Network Error";
  }
};

/* ========== REGISTER LOGIC ========== */
const regSendBtn = $("#reg-send");
regSendBtn.onclick = async () => {
  const email = $("#reg-email").value.trim();
  if(!email) { $("#reg-msg").textContent = "Email required"; return; }

  regSendBtn.disabled = true;
  let left = 60;
  const timer = setInterval(() => {
    regSendBtn.textContent = `${left--}s`;
    if (left < 0) {
      clearInterval(timer);
      regSendBtn.textContent = "Get Code";
      regSendBtn.disabled = false;
    }
  }, 1000);

  try {
    const r = await fetch(`${API_BASE}/send-code`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, purpose: "register" })
    });

    const data = await jsonOrEmpty(r);

    if (r.ok && data.ok) {
      if (data.code) {
        $("#reg-code").value = String(data.code);
        $("#reg-msg").textContent = "Code received & auto-filled.";
      } else {
        $("#reg-msg").textContent = "Check your email inbox.";
      }
    } else {
      const d = data.detail || {};
      const readable = d.code ? `${d.code}: ${d.message}` : (data.error || r.status);
      $("#reg-msg").textContent = `Error: ${readable}`;
    }
  } catch {
    $("#reg-msg").textContent = "Network Error";
  }
};

const regSubmitBtn = $("#reg-submit");
regSubmitBtn.onclick = async () => {
  regSubmitBtn.disabled = true;
  $("#reg-msg").textContent = "Creating Account...";
  try {
    const email = $("#reg-email").value.trim();
    const username = $("#reg-username").value.trim();
    const password = $("#reg-password").value;
    const code = $("#reg-code").value.trim();

    const r = await fetch(`${API_BASE}/register`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, username, password, code })
    });

    const data = await jsonOrEmpty(r);
    if (!r.ok || !data.ok) {
      $("#reg-msg").textContent = `Failed: ${data.error || r.status}`;
      return;
    }

    $("#reg-msg").textContent = "Account created. Redirecting...";
    gotoApp();
  } catch {
    $("#reg-msg").textContent = "Network Error";
  } finally {
    regSubmitBtn.disabled = false;
  }
};
