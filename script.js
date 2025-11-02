// const $ = s => document.querySelector(s);
// const API = "api/auth"; // 相对路径，无 / 前缀
// const gotoApp = () => location.href = "demo.html";

// // Tab 切换
// document.querySelectorAll(".tab").forEach(btn=>{
//   btn.onclick = () => {
//     document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
//     btn.classList.add("active");
//     document.querySelectorAll(".panel").forEach(p=>p.classList.remove("show"));
//     document.querySelector("#panel-" + btn.dataset.tab).classList.add("show");
//   };
// });

// // 登录 Step1：校验密码并发送验证码
// document.querySelector("#login-send").onclick = async () => {
//   const email = document.querySelector("#login-email").value.trim();
//   const password = document.querySelector("#login-password").value;
//   document.querySelector("#login-msg").textContent = "正在校验并发送验证码…";
//   const res = await fetch(`${API}/login/start`, {
//     method: "POST", credentials: "include",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({ email, password })
//   });
//   const data = await res.json().catch(()=>({}));
//   if (!res.ok || !data.ok) { document.querySelector("#login-msg").textContent = `失败：${data.error || res.status}`; return; }
//   document.querySelector("#login-msg").textContent = "验证码已发送到邮箱，请查收";
//   document.querySelector("#login-code-row").classList.remove("hidden");
// };

// // 登录 Step2：提交验证码完成登录
// document.querySelector("#login-verify").onclick = async () => {
//   const email = document.querySelector("#login-email").value.trim();
//   const code = document.querySelector("#login-code").value.trim();
//   document.querySelector("#login-msg").textContent = "正在验证验证码…";
//   const res = await fetch(`${API}/login/verify`, {
//     method: "POST", credentials: "include",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({ email, code })
//   });
//   const data = await res.json().catch(()=>({}));
//   if (!res.ok || !data.ok) { document.querySelector("#login-msg").textContent = `失败：${data.error || res.status}`; return; }
//   document.querySelector("#login-msg").textContent = "登录成功，正在进入系统…";
//   gotoApp();
// };

// // 注册：发送验证码
// document.querySelector("#reg-send").onclick = async () => {
//   const email = document.querySelector("#reg-email").value.trim();
//   const res = await fetch(`${API}/send-code`, {
//     method: "POST", credentials: "include",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({ email, purpose: "register" })
//   });
//   const data = await res.json().catch(()=>({}));
//   document.querySelector("#reg-msg").textContent = res.ok && data.ok ? "验证码已发送" : `失败：${data.error || res.status}`;
// };

// // 注册：提交注册
// document.querySelector("#reg-submit").onclick = async () => {
//   const email = document.querySelector("#reg-email").value.trim();
//   const username = document.querySelector("#reg-username").value.trim();
//   const password = document.querySelector("#reg-password").value;
//   const code = document.querySelector("#reg-code").value.trim();
//   document.querySelector("#reg-msg").textContent = "正在注册…";
//   const res = await fetch(`${API}/register`, {
//     method: "POST", credentials: "include",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({ email, username, password, code })
//   });
//   const data = await res.json().catch(()=>({}));
//   if (!res.ok || !data.ok) { document.querySelector("#reg-msg").textContent = `失败：${data.error || res.status}`; return; }
//   document.querySelector("#reg-msg").textContent = "注册并登录成功，正在进入系统…";
//   gotoApp();
// };


// ====== 登录页 script.js（整文件替换用）======
// 相对路径（无 / 前缀），同域走 Workers 路由 cap.iieao.com/api/*
const API_BASE = "api/auth";
const gotoApp = () => location.href = "demo.html";

// 小工具
const $ = s => document.querySelector(s);
const jsonOrEmpty = async (r) => {
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("json")) { try { return await r.json(); } catch {} }
  return {};
};

// Tab 切换
document.querySelectorAll(".tab").forEach(btn=>{
  btn.onclick = () => {
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".panel").forEach(p=>p.classList.remove("show"));
    document.querySelector("#panel-" + btn.dataset.tab).classList.add("show");
  };
});

/* ========== 登录流程 ==========
   Step1: 密码校验并发送验证码（带倒计时）
   Step2: 填写验证码完成登录
*/
const loginSendBtn = $("#login-send");
loginSendBtn.onclick = async () => {
  const email = $("#login-email").value.trim();
  const password = $("#login-password").value;
  $("#login-msg").textContent = "正在校验并发送验证码…";

  // 先禁用，防并发点击
  loginSendBtn.disabled = true; let left = 60;
  const timer = setInterval(()=>{ loginSendBtn.textContent = `请稍候 ${left--}s`;
    if (left < 0) { clearInterval(timer); loginSendBtn.textContent = "下一步：发送验证码"; loginSendBtn.disabled = false; }
  }, 1000);

  try {
    const r = await fetch(`${API_BASE}/login/start`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await jsonOrEmpty(r);
    // if (!r.ok || !data.ok) { $("#login-msg").textContent = `失败：${data.error || r.status}`; return; }
    // $("#login-msg").textContent = "验证码已发送到邮箱，请查收";
    // $("#login-code-row").classList.remove("hidden");
    if (!r.ok || !data.ok) { $("#login-msg").textContent = `失败：${data.error || r.status}`; return; }
    if (data.code) {
     // NEW：直返验证码
     $("#login-code").value = String(data.code);
     $("#login-msg").textContent = "验证码已自动填入（同时邮件也会发送），请继续验证完成登录";
   } else {
     $("#login-msg").textContent = "验证码已发送到邮箱，请查收";
   }
   $("#login-code-row").classList.remove("hidden");
  } catch {
    $("#login-msg").textContent = "失败：网络错误";
  }
};

$("#login-verify").onclick = async () => {
  const email = $("#login-email").value.trim();
  const code = $("#login-code").value.trim();
  $("#login-msg").textContent = "正在验证验证码…";
  try {
    const r = await fetch(`${API_BASE}/login/verify`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code })
    });
    const data = await jsonOrEmpty(r);
    if (!r.ok || !data.ok) { $("#login-msg").textContent = `失败：${data.error || r.status}`; return; }
    $("#login-msg").textContent = "登录成功，正在进入系统…";
    gotoApp();
  } catch {
    $("#login-msg").textContent = "失败：网络错误";
  }
};

/* ========== 注册流程 ==========
   发送注册验证码（防并发+倒计时）
   填写验证码 + 用户名 + 密码 → 完成注册并自动登录
*/
// const regSendBtn = $("#reg-send");
// regSendBtn.onclick = async () => {
//   const email = $("#reg-email").value.trim();

//   regSendBtn.disabled = true; let left = 60;
//   const timer = setInterval(()=>{ regSendBtn.textContent = `请稍候 ${left--}s`;
//     if (left < 0) { clearInterval(timer); regSendBtn.textContent = "发送注册验证码"; regSendBtn.disabled = false; }
//   },1000);

//   try {
//     const r = await fetch(`${API_BASE}/send-code`, {
//       method: "POST", credentials: "include",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ email, purpose: "register" })
//     });
//  let data = await jsonOrEmpty(r);
// if (!r.ok || !data.ok) {
//   const d = data.detail || {};
//   // const readable = d.code ? `${d.code}: ${d.message || d.raw || r.status}` : (data.error || r.status);
//   const readable = d.code
//     ? `${d.code}: ${d.message || d.raw || r.status}`
//     : (d.message || d.raw || data.error || r.status);
// //   $("#reg-msg").textContent = `失败：${readable}`;
// // } else {
// //   $("#reg-msg").textContent = "验证码已发送";
// // }
//   if (r.ok && data.ok) {
//      if (data.code) {
//        // NEW: 直返模式，自动填充验证码
//        $("#reg-code").value = String(data.code);
//        $("#reg-msg").textContent = "验证码已自动填入（同时邮件也会发送），请继续完成注册";
//      } else {
//        $("#reg-msg").textContent = "验证码已发送到邮箱，请查收";
//      }
//    } else {
//      $("#reg-msg").textContent = `失败：${data.error || r.status}`;
//    }
//   } catch {
//     $("#reg-msg").textContent = "失败：网络错误";
//   }
// };

const regSendBtn = $("#reg-send");
regSendBtn.onclick = async () => {
  const email = $("#reg-email").value.trim();

  regSendBtn.disabled = true; let left = 60;
  const timer = setInterval(()=>{ regSendBtn.textContent = `请稍候 ${left--}s`;
    if (left < 0) { clearInterval(timer); regSendBtn.textContent = "发送注册验证码"; regSendBtn.disabled = false; }
  },1000);

  try {
    const r = await fetch(`${API_BASE}/send-code`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, purpose: "register" })
    });

    const data = await jsonOrEmpty(r);

    if (r.ok && data.ok) {
      if (data.code) {
        // 直返模式：自动填充
        $("#reg-code").value = String(data.code);
        $("#reg-msg").textContent = "验证码已自动填入（同时邮件也会发送），请继续完成注册";
      } else {
        $("#reg-msg").textContent = "验证码已发送到邮箱，请查收";
      }
    } else {
      const d = data.detail || {};
      const readable = d.code
        ? `${d.code}: ${d.message || d.raw || r.status}`
        : (data.error || r.status);
      $("#reg-msg").textContent = `失败：${readable}`;
    }
  } catch {
    $("#reg-msg").textContent = "失败：网络错误";
  }
};


const regSubmitBtn = $("#reg-submit");
regSubmitBtn.onclick = async () => {
  regSubmitBtn.disabled = true;
  $("#reg-msg").textContent = "正在注册…";
  try {
    const email = $("#reg-email").value.trim();
    const username = $("#reg-username").value.trim();
    const password = $("#reg-password").value;
    const code = $("#reg-code").value.trim();

    const r = await fetch(`${API_BASE}/register`, {
      method:"POST", credentials:"include",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ email, username, password, code })
    });

    const data = await jsonOrEmpty(r);
    if (!r.ok || !data.ok) { $("#reg-msg").textContent = `失败：${data.error || r.status}`; return; }

    $("#reg-msg").textContent = "注册并登录成功，正在进入系统…";
    gotoApp();
  } catch {
    $("#reg-msg").textContent = "失败：网络/响应异常";
  } finally {
    regSubmitBtn.disabled = false;
  }
};


