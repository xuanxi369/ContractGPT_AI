export default {
  async fetch(request, env, ctx) {
    // 临时调试输出（上线后可移除）
    console.log("🚨 SECRET_ID:", env.TENCENTCLOUD_SECRET_ID || "MISSING");
    console.log("🚨 SECRET_KEY:", env.TENCENTCLOUD_SECRET_KEY || "MISSING");
    console.log("ENV KEYS:", Object.keys(env));
    console.log("SECRET_KEY value preview:", JSON.stringify(env.TENCENTCLOUD_SECRET_KEY));

    const url = new URL(request.url);
    if (request.method === "OPTIONS") return handleOptions(request);

    try {
      // ===== Auth 路由 =====
      if (url.pathname === "/api/auth/send-code"   && request.method === "POST") return sendCode(request, env, ctx);
      if (url.pathname === "/api/auth/register"    && request.method === "POST") return register(request, env);
      if (url.pathname === "/api/auth/login/start" && request.method === "POST") return loginStart(request, env, ctx);
      if (url.pathname === "/api/auth/login/verify"&& request.method === "POST") return loginVerify(request, env);
      if (url.pathname === "/api/auth/me"          && request.method === "GET")  return authMe(request, env);

      // 自检：不泄露敏感值，仅回布尔/摘要
      if (url.pathname === "/api/_secrets" && request.method === "GET") {
        const v = (x) => (typeof x === "string" && x.trim().length > 0);
        return withCORS(json({
          have_id:  v(env.TENCENTCLOUD_SECRET_ID),
          have_key: v(env.TENCENTCLOUD_SECRET_KEY),
          host: (env.SES_API_HOST || "").trim(),
          region: (env.SES_REGION || "").trim(),
          from: (env.SES_FROM || "").trim(),
          template: (env.SES_TEMPLATE_ID || "").toString().trim(),
          allow_inline_code: String(env.ALLOW_INLINE_CODE || "") === "1",
          has_deepseek_key: !!(env.DEEPSEEK_API_KEY && String(env.DEEPSEEK_API_KEY).trim())
        }, 200), request);
      }

      // 腾讯云 SES 回调（可选）
      if (url.pathname === "/mail/callback") {
        const text = await request.text();
        console.log("SES callback:", text.slice(0, 1000));
        return withCORS(new Response("OK"), request);
      }

      // ===== 合同分析（必须登录）=====
      if (url.pathname === "/api/analyze" && request.method === "POST") {
        const session = await requireSession(request, env);
        if (!session) {
          return withCORS(json({
            ok: false,
            error: "unauthorized",
            message: "请先登录再使用分析功能"
          }, 401), request);
        }

        let body; 
        try { 
          body = await request.json(); 
        } catch { 
          return withCORS(json({ ok:false, error: "bad_json" }, 400), request); 
        }
        const { contract = "", question = "" } = body;
        if (!contract || !question) {
          return withCORS(json({ ok:false, error: "missing_params", detail: "缺少 contract 或 question" }, 400), request);
        }
        if (!env.DEEPSEEK_API_KEY)  {
          return withCORS(json({ ok:false, error: "config_missing", detail: "后端未配置 API Key" }, 500), request);
        }

        // 脱敏 + 截断
        let maskedContract = maskSensitiveText(contract);
        const MAX_CHARS = 120000;
        if (maskedContract.length > MAX_CHARS) {
          maskedContract = maskedContract.slice(0, MAX_CHARS);
        }

        const preface = "【模拟分析说明】以下为**已脱敏的合同样本**…\n\n";
        const systemPrompt = "你是一位资深合同审查法律顾问…";

        const payload = {
          model: "deepseek-chat",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: preface + maskedContract },
            { role: "user", content: question }
          ],
          stream: false
        };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000);
        let upstreamResp, text;
        try {
          upstreamResp = await fetch("https://api.deepseek.com/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${env.DEEPSEEK_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal
          });
          text = await upstreamResp.text();
        } catch (e) {
          clearTimeout(timeout);
          // 统一返回 OpenAI 形状，让前端能显示更具体的错误
          return withCORS(json({
            ok: false,
            error: "upstream_network_error",
            detail: String((e && e.message) || e || "network error")
          }, 502), request);
        }
        clearTimeout(timeout);

        if (!upstreamResp.ok) {
          let errObj = null; 
          try { errObj = JSON.parse(text); } catch {}
          return withCORS(json({
            ok: false,
            error: "upstream_error",
            upstreamStatus: upstreamResp.status,
            detail: errObj || text
          }, 502), request);
        }

        let parsed; 
        try { parsed = JSON.parse(text); } catch { parsed = text; }

        // 统一包成 OpenAI 兼容输出，尽量从不同字段兜底 content
        const content =
          parsed?.choices?.[0]?.message?.content ??
          parsed?.choices?.[0]?.text ??
          (typeof parsed === "string" ? parsed : JSON.stringify(parsed));

        return withCORS(json({
          ok: true,
          model: "deepseek-chat",
          choices: [{ message: { role: "assistant", content: String(content || "") } }]
        }, 200), request);
      }

      if (url.pathname === "/") return withCORS(json({ ok: true, msg: "ContractGPT Worker online" }, 200), request);
      return withCORS(new Response("Not Found", { status: 404 }), request);

    } catch (e) {
      console.error("Unhandled error:", e);
      return withCORS(json({ error: "internal_error" }, 500), request);
    }
  }
};

/* ---------- CORS / JSON ---------- */
const ALLOWED_ORIGINS = new Set(["https://cap.iieao.com", "http://localhost:8788", "http://127.0.0.1:8788"]);
function withCORS(resp, request) {
  const origin = request.headers.get("Origin");
  const h = new Headers(resp.headers);
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Access-Control-Allow-Credentials", "true");
  } else {
    h.set("Access-Control-Allow-Origin", "https://cap.iieao.com");
    h.set("Access-Control-Allow-Credentials", "true");
  }
  h.set("Vary", "Origin");
  return new Response(resp.body, { status: resp.status, headers: h });
}
function handleOptions(request) {
  const origin = request.headers.get("Origin");
  const h = new Headers();
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Access-Control-Allow-Credentials", "true");
  }
  h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  h.set("Access-Control-Max-Age", "86400");
  return new Response(null, { status: 204, headers: h });
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

/* ---------- 密码/JWT ---------- */
async function hashPassword(plain) {
  const PBKDF2_ITER = 100000; // <= Cloudflare Workers 上限
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(plain), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" },
    keyMaterial, { name: "HMAC", hash: "SHA-256", length: 256 }, true, ["sign"]
  );
  const raw = await crypto.subtle.exportKey("raw", key);
  return `pbkdf2$${PBKDF2_ITER}$${toHex(salt)}$${b64(raw)}`;
}

async function verifyPassword(plain, stored) {
  try {
    const [algo, iterStr, saltHex, base] = stored.split("$"); if (algo !== "pbkdf2") return false;
    const iterations = parseInt(iterStr, 10), salt = fromHex(saltHex), enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(plain), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      keyMaterial, { name: "HMAC", hash: "SHA-256", length: 256 }, true, ["sign"]
    );
    const raw = await crypto.subtle.exportKey("raw", key);
    return timingSafeEqual(base, b64(raw));
  } catch { return false; }
}
function timingSafeEqual(a, b){ if (a.length !== b.length) return false; let out=0; for (let i=0;i<a.length;i++) out|=a.charCodeAt(i)^b.charCodeAt(i); return out===0; }
function b64(buf){ let s=""; const bytes = buf instanceof ArrayBuffer? new Uint8Array(buf): new Uint8Array(buf.buffer); for (let i=0;i<bytes.length;i++) s+=String.fromCharCode(bytes[i]); return btoa(s); }
function toHex(u8){ return Array.from(u8).map(b=>b.toString(16).padStart(2,"0")).join(""); }
function fromHex(hex){ const u8=new Uint8Array(hex.length/2); for(let i=0;i<u8.length;i++) u8[i]=parseInt(hex.substr(i*2,2),16); return u8; }

function b64u(s){ return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function b64uFromBytes(buf){ return b64(buf).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
async function signJWT(payload, env, ttlSec){
  const header={alg:"HS256",typ:"JWT"}; const now=Math.floor(Date.now()/1000);
  const exp=now+(ttlSec||parseInt(env.SESSION_TTL_SECONDS||"2592000",10));
  const full={...payload,iss:env.SESSION_ISSUER||"cap.iieao.com",iat:now,exp};
  const msg=`${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(full))}`;
  const key=await crypto.subtle.importKey("raw", new TextEncoder().encode(env.AUTH_JWT_SECRET), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const sig=await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return `${msg}.${b64uFromBytes(sig)}`;
}
async function verifyJWT(token, env){
  try{
    const [h,p,s]=token.split("."); const key=await crypto.subtle.importKey("raw", new TextEncoder().encode(env.AUTH_JWT_SECRET), {name:"HMAC",hash:"SHA-256"}, false, ["verify"]);
    const ok=await crypto.subtle.verify("HMAC", key, base64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
    if(!ok) return null; const payload=JSON.parse(atob(p.replace(/-/g,"+").replace(/_/g,"/")));
    if(payload.exp && Math.floor(Date.now()/1000)>payload.exp) return null; return payload;
  }catch{return null;}
}
function base64urlToBytes(b64u){ const pad="===".slice((b64u.length+3)%4); const b64=(b64u+pad).replace(/-/g,"+").replace(/_/g,"/"); const str=atob(b64); const u8=new Uint8Array(str.length); for(let i=0;i<str.length;i++) u8[i]=str.charCodeAt(i); return u8; }
async function requireSession(request, env){
  const cookie = request.headers.get("Cookie")||""; 
  const m=cookie.match(/(?:^|;\s*)cgpt_session=([^;]+)/); 
  if(!m) return null; 
  return verifyJWT(decodeURIComponent(m[1]), env);
}
function setSessionCookie(token){
  return [
    `cgpt_session=${encodeURIComponent(token)}`,
    "Path=/","HttpOnly","Secure","SameSite=Lax",
    "Domain=.iieao.com", `Max-Age=${60*60*24*30}`
  ].join("; ");
}

/* ---------- 发送验证码/登录注册 ---------- */
async function sendCode(request, env, ctx) {
  const { email, purpose } = await request.json().catch(() => ({}));
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return withCORS(json({ error: "invalid_email" }, 400), request);
  if (!["register", "login"].includes(purpose))
    return withCORS(json({ error: "invalid_purpose" }, 400), request);

  const code = (Math.floor(Math.random() * 900000) + 100000).toString();
  const now = Date.now();
  const ttlMs = 10 * 60 * 1000;
  const INLINE = String(env.ALLOW_INLINE_CODE || "") === "1";

  // 1 分钟频控：同(email,purpose)最近 60s 内不再插入
  const windowMs = 60 * 1000;
  const insertSql = `
    INSERT INTO verification_codes(target, code, purpose, expires_at, consumed, created_at)
    SELECT ?, ?, ?, ?, 0, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM verification_codes
       WHERE target=? AND purpose=? AND created_at > ?
    )
  `;
  const res = await env.prod_auth.prepare(insertSql)
    .bind(email, code, purpose, now + ttlMs, now, email, purpose, now - windowMs)
    .run();

  // A. 新验证码
  if (res.meta && res.meta.changes === 1) {
    if (INLINE) {
      ctx && ctx.waitUntil(sendEmailSES({
        env, to: email,
        subject: purpose === "register" ? "ContractGPT 注册验证码" : "ContractGPT 登录验证码",
        templateId: env.SES_TEMPLATE_ID,
        templateData: JSON.stringify({ code })
      }));
      return withCORS(json({ ok: true, sent: true, code, channel: "inline" }), request);
    }
    const ok = await sendEmailSES({
      env, to: email,
      subject: purpose === "register" ? "ContractGPT 注册验证码" : "ContractGPT 登录验证码",
      templateId: env.SES_TEMPLATE_ID,
      templateData: JSON.stringify({ code })
    });
    if (!ok.ok) return withCORS(json({ error: "send_failed", detail: ok }, 500), request);
    return withCORS(json({ ok: true, sent: true }), request);
  }

  // B. 频控：复用最近一条
  const last = await env.prod_auth.prepare(
    "SELECT code, created_at, expires_at FROM verification_codes WHERE target=? AND purpose=? ORDER BY id DESC LIMIT 1"
  ).bind(email, purpose).all();
  const lastRow = last.results?.[0];

  if (lastRow && now < Number(lastRow.expires_at)) {
    const cooldown = Math.max(0, windowMs - (now - Number(lastRow.created_at)));
    if (INLINE) {
      ctx && ctx.waitUntil(sendEmailSES({
        env, to: email,
        subject: purpose === "register" ? "ContractGPT 注册验证码" : "ContractGPT 登录验证码",
        templateId: env.SES_TEMPLATE_ID,
        templateData: JSON.stringify({ code: String(lastRow.code) })
      }));
      return withCORS(json({
        ok: true, sent: true, reused: true,
        code: String(lastRow.code), channel: "inline", cooldown_ms: cooldown
      }), request);
    }

    const resend = await sendEmailSES({
      env, to: email,
      subject: purpose === "register" ? "ContractGPT 注册验证码" : "ContractGPT 登录验证码",
      templateId: env.SES_TEMPLATE_ID,
      templateData: JSON.stringify({ code: String(lastRow.code) })
    });
    if (!resend.ok) {
      console.warn("SES resend failed:", resend);
      return withCORS(json({ error: "send_failed", detail: resend }, 500), request);
    }
    return withCORS(json({ ok: true, sent: true, reused: true, cooldown_ms: cooldown }), request);
  }

  // C. 极少见：既没插入新码，也无可复用旧码
  const left = lastRow ? Math.max(0, windowMs - (now - Number(lastRow.created_at))) : windowMs;
  return withCORS(json({ error: "too_frequent", cooldown_ms: left }, 429), request);
}

async function register(request, env){
  const { email, username, password, code } = await request.json().catch(()=>({}));
  if (!email || !username || !password || !code) return withCORS(json({ error: "missing_params" }, 400), request);

  // 校验验证码（purpose=register）
  const rec = await env.prod_auth.prepare(
    "SELECT id, expires_at, consumed FROM verification_codes WHERE target=? AND purpose='register' AND code=? ORDER BY id DESC LIMIT 1"
  ).bind(email, code).all();
  if (!rec.results?.length) return withCORS(json({ error: "code_invalid" }, 400), request);
  const row = rec.results[0];
  if (row.consumed) return withCORS(json({ error: "code_used" }, 400), request);
  if (Date.now() > row.expires_at) return withCORS(json({ error: "code_expired" }, 400), request);

  // 唯一性
  const existEmail = await env.prod_auth.prepare("SELECT id FROM users WHERE email=?").bind(email).all();
  if (existEmail.results?.length) return withCORS(json({ error: "email_exists" }, 409), request);
  const existName = await env.prod_auth.prepare("SELECT id FROM users WHERE username=?").bind(username).all();
  if (existName.results?.length) return withCORS(json({ error: "username_exists" }, 409), request);

  // 插入
  const password_hash = await hashPassword(password);
  const now = Date.now();
  try {
    await env.prod_auth.prepare(
      "INSERT INTO users(created_at, updated_at, username, email, password_hash, status) VALUES (?,?,?,?,?,'active')"
    ).bind(now, now, username, email, password_hash).run();
  } catch (e) {
    const msg = String(e?.message||e);
    if (msg.includes("users.username")) return withCORS(json({ error:"username_exists" }, 409), request);
    if (msg.includes("users.email"))    return withCORS(json({ error:"email_exists" }, 409), request);
    console.error("register_insert_error:", msg);
    return withCORS(json({ error:"db_insert_error" }, 500), request);
  }

  await env.prod_auth.prepare("UPDATE verification_codes SET consumed=1 WHERE id=?").bind(row.id).run();

  const token = await signJWT({ sub: email, email, username }, env);
  const h = new Headers({ "Content-Type": "application/json; charset=utf-8" });
  h.append("Set-Cookie", setSessionCookie(token));
  return withCORS(new Response(JSON.stringify({ ok: true }), { status: 200, headers: h }), request);
}

async function loginStart(request, env, ctx){
  const { email, password } = await request.json().catch(()=>({}));
  if (!email || !password) return withCORS(json({ error: "missing_params" }, 400), request);

  const u = await env.prod_auth.prepare("SELECT id, username, password_hash, status FROM users WHERE email=?").bind(email).all();
  if (!u.results?.length) return withCORS(json({ error: "user_not_found" }, 404), request);
  const user = u.results[0]; 
  if (user.status!=="active") return withCORS(json({ error: "user_disabled" }, 403), request);

  const okPass = await verifyPassword(password, user.password_hash || "");
  if (!okPass) return withCORS(json({ error: "bad_credentials" }, 401), request);

  // 发送登录验证码（复用 sendCode）
  const req2 = new Request(request.url.replace("/login/start","/send-code"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, purpose: "login" })
  });
  return sendCode(req2, env, ctx);
}

async function loginVerify(request, env){
  const { email, code } = await request.json().catch(()=>({}));
  if (!email || !code) return withCORS(json({ error: "missing_params" }, 400), request);

  const rec = await env.prod_auth.prepare(
    "SELECT id, expires_at, consumed FROM verification_codes WHERE target=? AND purpose='login' AND code=? ORDER BY id DESC LIMIT 1"
  ).bind(email, code).all();
  if (!rec.results?.length) return withCORS(json({ error: "code_invalid" }, 400), request);
  const row = rec.results[0]; 
  if (row.consumed) return withCORS(json({ error: "code_used" }, 400), request);
  if (Date.now() > row.expires_at) return withCORS(json({ error: "code_expired" }, 400), request);

  const u = await env.prod_auth.prepare("SELECT id, username, email, status FROM users WHERE email=?").bind(email).all();
  if (!u.results?.length) return withCORS(json({ error: "user_not_found" }, 404), request);
  const user = u.results[0]; 
  if (user.status!=="active") return withCORS(json({ error: "user_disabled" }, 403), request);

  await env.prod_auth.prepare("UPDATE verification_codes SET consumed=1 WHERE id=?").bind(row.id).run();

  const token = await signJWT({ sub: email, email, username: user.username }, env);
  const h = new Headers({ "Content-Type": "application/json; charset=utf-8" });
  h.append("Set-Cookie", setSessionCookie(token));
  return withCORS(new Response(JSON.stringify({ ok: true }), { status: 200, headers: h }), request);
}

async function authMe(request, env){
  const session = await requireSession(request, env);
  if (!session) return withCORS(json({ authenticated:false }, 200), request);
  return withCORS(json({ authenticated:true, email:session.email, username:session.username }, 200), request);
}

/* ---------- SES 发送 ---------- */
async function sendEmailSES({ env, to, subject, templateId, templateData }) {
  try {
    const service = "ses";
    const region  = (env.SES_REGION || "ap-hongkong").trim();
    const version = "2020-10-02";
    const action  = "SendEmail";
    const from    = (env.SES_FROM || "").trim();

    const sid = (env.TENCENTCLOUD_SECRET_ID  || env.SES_SECRET_ID  || env.SECRET_ID  || "").trim();
    const sk  = (env.TENCENTCLOUD_SECRET_KEY || env.SES_SECRET_KEY || env.SECRET_KEY || "").trim();
    if (!sid || !sk)   return { ok:false, code:"Config.MissingSecret", message:"Missing SECRET_ID/SECRET_KEY" };
    if (!from)         return { ok:false, code:"Config.MissingFrom",   message:"Missing SES_FROM" };
    if (!/^\d+$/.test(String(templateId || "")))
      return { ok:false, code:"Config.BadTemplateID", message:`SES_TEMPLATE_ID must be number, got ${templateId}` };

    const basePayload = {
      FromEmailAddress: from,
      Destination: [to],
      Subject: subject,
      Template: { TemplateID: Number(templateId), TemplateData: templateData }
    };

    const manualHost = (env.SES_API_HOST || "").trim();
    const cnRegional = `ses.${region}.tencentcloudapi.com`;
    const intlHost   = `ses.intl.tencentcloudapi.com`;

    const candidateHosts = [];
    if (manualHost) candidateHosts.push(manualHost);
    candidateHosts.push(cnRegional, intlHost);

    let lastError = null;

    for (const host of candidateHosts) {
      try {
        const endpoint = `https://${host}`;
        const payload  = basePayload;
        const timestamp = Math.floor(Date.now() / 1000);
        const date      = new Date(timestamp * 1000).toISOString().slice(0,10);
        const ct = "application/json; charset=utf-8";

        const canonicalHeaders = `content-type:${ct}\nhost:${host}\n`;
        const signedHeaders    = "content-type;host";

        const hashedPayload    = await sha256Hex(JSON.stringify(payload));
        const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;

        const algorithm       = "TC3-HMAC-SHA256";
        const credentialScope = `${date}/${service}/tc3_request`;
        const stringToSign    = `${algorithm}\n${timestamp}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;

        const secretDate    = await hmac(`TC3${sk}`, date);
        const secretService = await hmacBytes(secretDate, service);
        const secretSigning = await hmacBytes(secretService, "tc3_request");
        const signature     = await hmacHex(secretSigning, stringToSign);

        const headers = {
          "Authorization": `${algorithm} Credential=${sid}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
          "Content-Type": ct,
          "X-TC-Action": action,
          "X-TC-Timestamp": String(timestamp),
          "X-TC-Version": version,
          "X-TC-Region": region
        };

        // 清洗头值，避免 CR/LF 触发 Workers 的 Invalid header
        for (const k of Object.keys(headers)) {
          headers[k] = String(headers[k]).trim();
          if (/[\r\n]/.test(headers[k])) {
            return { ok:false, code:`BadHeader.${k}`, message:`Header has CR/LF`, raw: headers[k] };
          }
        }

        const res  = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
        const text = await res.text();

        if (!res.ok) {
          lastError = { ok:false, httpStatus:res.status, host, raw:text.slice(0,800) };
          continue;
        }

        let obj;
        try { obj = JSON.parse(text); } catch {
          lastError = { ok:false, httpStatus:200, host, raw:text.slice(0,800) };
          continue;
        }
        const resp = obj.Response || {};
        if (resp.Error) {
          lastError = { ok:false, host, code:resp.Error.Code, message:resp.Error.Message, requestId:resp.RequestId };
          continue;
        }

        return { ok:true, host, messageId: resp.MessageId, requestId: resp.RequestId };

      } catch (e) {
        lastError = { ok:false, host, error:"network_or_sign_error", message:e?.message || String(e) };
        continue;
      }
    }

    return lastError || { ok:false, code:"Unknown", message:"All SES endpoints failed" };

  } catch (e) {
    return { ok:false, error:"sendEmailSES_uncaught", message:e?.message || String(e) };
  }
}

/* ---------- TC3/HMAC 工具 ---------- */
async function sha256Hex(str){ const data=new TextEncoder().encode(str); const buf=await crypto.subtle.digest("SHA-256",data); return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join(""); }
async function hmac(key,msg){ const k=await crypto.subtle.importKey("raw", new TextEncoder().encode(key), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]); return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg))); }
async function hmacBytes(keyBytes,msg){ const k=await crypto.subtle.importKey("raw", keyBytes, {name:"HMAC",hash:"SHA-256"}, false, ["sign"]); return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg))); }
async function hmacHex(keyBytes,msg){ const k=await crypto.subtle.importKey("raw", keyBytes, {name:"HMAC",hash:"SHA-256"}, false, ["sign"]); const sig=await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)); return Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,"0")).join(""); }

/* ---------- 脱敏 ---------- */
function maskSensitiveText(text) {
  let s = text;
  s = s.replace(/\b(委托方|甲方|受托方|承接方|乙方)\s*[:：]?\s*([^\n,，；;]{2,60})/gi,(m,p1)=>`${p1}: [${p1==='甲方'||p1==='委托方'?'A公司':'B公司'}]`);
  s = s.replace(/\b([A-Za-z0-9\u4e00-\u9fa5\-\·]{2,80}有限公司|股份有限公司|集团公司|公司)\b/g,"[公司]");
  s = s.replace(/¥?\s?￥?\s?\d{1,3}(?:[,\d]{0,})+(?:\.\d+)?/g,"[金额]");
  s = s.replace(/\d+(?:\.\d+)?\s?(元|人民币|RMB)/gi,"[金额]");
  s = s.replace(/\b\d{4}[-\/\.]\d{1,2}[-\/\.]\d{1,2}\b/g,"[日期]");
  s = s.replace(/\b\d{1,2}年\d{1,2}月\d{1,2}日\b/g,"[日期]");
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,"[邮箱]");
  s = s.replace(/1[3-9]\d{9}/g,"[手机]");
  s = s.replace(/\b0\d{2,3}-\d{7,8}\b/g,"[座机]");
  s = s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,"[IP]");
  s = s.replace(/(合同编号[:：]?\s*)([^\s\n,，；;]+)/gi,"$1[合同编号]");
  return s;
}



 
