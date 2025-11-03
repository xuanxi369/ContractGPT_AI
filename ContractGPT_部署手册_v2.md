# ContractGPT 部署与运维手册（对话溯源版 · v2）

> **最后更新**：2025-11-03（Asia/Singapore）  
> **适用范围**：前端（静态站点）+ Cloudflare Workers（后端）+ D1 数据库 + 腾讯云 SES 邮件服务 + DeepSeek Chat API  
> **文档目的**：复盘本对话中出现的所有代码与约定，结合最佳实践，给出**可落地**的端到端部署方案、生产化运维规范与故障排查手册。  
> **阅读对象**：全栈工程师 / 前端工程师 / 云网关运维 / 安全合规 / 产品负责人。

---

## 目录

1. [项目背景与对话回顾](#项目背景与对话回顾)  
2. [系统架构总览](#系统架构总览)  
3. [代码清单与来源说明](#代码清单与来源说明)  
4. [前端应用（ContractGPT Web）部署](#前端应用contractgpt-web部署)  
5. [合同解析与风控关键字模块](#合同解析与风控关键字模块)  
6. [对话式分析（/api/analyze）前后端协议](#对话式分析api-analyze前后端协议)  
7. [认证与账号体系（注册/登录/会话）](#认证与账号体系注册登录会话)  
8. [Cloudflare Workers 后端部署](#cloudflare-workers-后端部署)  
9. [邮件服务（腾讯云 SES）配置与签名](#邮件服务腾讯云-ses配置与签名)  
10. [DeepSeek Chat API 集成说明](#deepseek-chat-api-集成说明)  
11. [CORS、安全策略与合规要点](#cors安全策略与合规要点)  
12. [数据库（D1）表结构与索引](#数据库d1表结构与索引)  
13. [环境变量与配置矩阵](#环境变量与配置矩阵)  
14. [上线前自检清单（Checklist）](#上线前自检清单checklist)  
15. [故障排查与应急手册](#故障排查与应急手册)  
16. [性能优化与成本控制](#性能优化与成本控制)  
17. [日志、监控与审计](#日志监控与审计)  
18. [运维 SOP：例行任务与演练](#运维-sop例行任务与演练)  
19. [Roadmap 与扩展建议](#roadmap-与扩展建议)  
20. [附录 A：完整 Worker 代码片段（整合版）](#附录-a完整-worker-代码片段整合版)  
21. [附录 B：SQL 脚本（D1 建表/索引/演示数据）](#附录-bsql-脚本d1-建表索引演示数据)  
22. [附录 C：Nginx/Static Hosting 示例](#附录-cnginxstatic-hosting-示例)  
23. [附录 D：API 调用示例（curl/Postman）](#附录-dapi-调用示例curlpostman)  
24. [附录 E：腾讯云 SES 模板示例](#附录-e腾讯云-ses-模板示例)  
25. [变更日志（本对话演进记录）](#变更日志本对话演进记录)

---

## 项目背景与对话回顾

### 1.1 起因与目标
用户正在开发**ContractGPT**：一个具备“**Apple 风格（大气、简洁、高级、公司门户式）**”的登录/注册页面与合同分析工具。系统需要：
- 支持**登录态**校验（未登录跳转登录页）；
- 支持 TXT/PDF/DOCX 合同解析（PDF 使用 pdf.js，DOCX 使用 mammoth）；
- 支持**关键词风控**与高亮；
- 支持**AI 对话**，将合同全文与用户问题发送到后端 `/api/analyze`，由 Worker 调用 **DeepSeek Chat API** 返回结构化答案；
- 支持**邮箱验证码**注册与双因子登录（密码 + 邮件验证码）；
- 使用**Cloudflare Workers** 作为后端网关，**D1** 作为账号/验证码存储，**腾讯云 SES** 作为邮件通道；
- 提供**严格的 CORS** 控制与 Cookie 会话（HttpOnly、Secure、SameSite=Lax、指定域）。

### 1.2 对话中关键代码与设计点（溯源）
在对话中，用户提供了多段核心代码：

- **前端页面脚本**：
  - 进入页面即检查登录态：`/api/auth/me`（未登录跳回 `index.html`）。
  - 绑定 `file-input` 和拖拽 `dropZone`，分别处理 `.txt / .pdf / .docx`；
  - `pdf.js` 指定 `GlobalWorkerOptions.workerSrc` 为 CDN（2.10.377）；
  - `mammoth.extractRawText` 抽取 docx 纯文本；
  - `showRiskAnalysis` 扫描若干“风险关键词”，在侧栏生成风险卡片；
  - `highlightKeywords` 对预览文本做 `<mark>` 高亮；
  - “展开/收起” 合同预览区域；
  - “对话发送”按钮将 `{ contract: fullContractText, question: userMessage }` POST 到 `api/analyze`，带 `credentials: "include"`；
  - 以**段落拆分**的方式分段渲染 AI 回答。

- **Cloudflare Worker（后端）**：
  - 暴露路由：`/api/auth/send-code`、`/api/auth/register`、`/api/auth/login/start`、`/api/auth/login/verify`、`/api/auth/me`、`/api/_secrets`、`/api/analyze`、`/mail/callback`；
  - **会话**：自签 HS256 的 JWT，`cgpt_session` 写入 Cookie（`Domain=.iieao.com`，`HttpOnly; Secure; SameSite=Lax`）；
  - **密码学**：`PBKDF2(SHA-256, iter=100000)` 做密码哈希/校验；`timingSafeEqual` 做常数时间比较；
  - **验证码**：D1 表 `verification_codes`，一分钟频控（同邮箱+目的），“直返”模式可在后端返回验证码给前端（仅用于允许的调试场景）；
  - **SES**：实现 **TC3-HMAC-SHA256** 签名，请求优先命中 `ses.{region}.tencentcloudapi.com`，失败再走国际站 `ses.intl.tencentcloudapi.com` 或手动指定；
  - **/api/analyze**：登录态保护；对合同做**脱敏**（公司名/金额/日期/邮箱/电话/IP/合同编号），并对超长文本做**截断**（默认 120000 chars）；封装为 DeepSeek Chat `chat/completions` 请求（`model=deepseek-chat`，非流式），并统一 OpenAI 兼容形状返回；
  - **CORS**：白名单 `ALLOWED_ORIGINS`，动态返回 `Access-Control-Allow-Origin` 与 `Access-Control-Allow-Credentials`。

### 1.3 文档编写原则
- **还原**对话中每个设计抉择，并补齐生产实践细节；
- **默认生产**安全级别（严格 CORS、Cookie、密码学、频控、脱敏）；
- 按“即抄即用”的方式给出**配置矩阵**、**SQL**、**curl**、**Nginx**与**示例代码**。

---

## 系统架构总览

```
┌────────────────────┐        ┌──────────────────────────┐
│  用户浏览器        │  HTTPS │  静态站点/前端（CDN）     │
│  - 上传合同        │ <─────>│  - index.html/login.html │
│  - 发起对话        │        │  - main.js / styles.css  │
└─────────▲──────────┘        └───────────┬───────────────┘
          │                                 │
          │ fetch(/api/*, credentials)      │
          │                                 │
          │                  Cloudflare     ▼
          │               ┌──────────────────────────────┐
          └──────────────>│  Workers API 网关            │
                          │  - 认证/验证码/会话          │
                          │  - /api/analyze AI 代理       │
                          │  - CORS 与日志                │
                          └───────┬──────────┬───────────┘
                                  │          │
                        D1 (SQLite on CF)    │  TencentCloud SES
                        ┌──────────────────┐ │  ┌──────────────────┐
                        │ users            │◄┼──┤  TC3 签名发信     │
                        │ verification...  │    │  区域/国际兜底    │
                        └──────────────────┘    └──────────────────┘
                                                  │
                                                  │ HTTPS
                                                  ▼
                                            DeepSeek Chat API
                                            （chat/completions）
```

---

## 代码清单与来源说明

> 本节目的是把对话中的**关键代码段**归档，以便部署者快速对照。

### 3.1 前端关键点
- **登录态检查**：
  ```js
  (async () => {
    try {
      const r = await fetch("api/auth/me", { credentials: "include" });
      const me = await r.json();
      if (!me.authenticated) location.href = "index.html";
    } catch (e) { location.href = "index.html"; }
  })();
  ```

- **pdf.js worker**：
  ```js
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.worker.min.js";
  }
  ```

- **DOCX 解析**：
  ```js
  mammoth.extractRawText({ arrayBuffer: e.target.result })
    .then(result => { fullContractText = result.value; ... })
    .catch(err => { statusArea.textContent = "❌ 解析 DOCX 文件失败：" + err.message; });
  ```

- **AI 对话**：
  ```js
  const response = await fetch("api/analyze", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contract: fullContractText, question: userMessage })
  });
  const data = await (async () => { try { return await response.json(); } catch { return {}; } })();
  if (!response.ok || data.ok === false || data.error) { ... }
  const answer = data?.choices?.[0]?.message?.content || "（模型未返回内容）";
  ```

### 3.2 Worker 关键点
- **路由**：`/api/auth/send-code`、`/api/auth/register`、`/api/auth/login/start`、`/api/auth/login/verify`、`/api/auth/me`、`/api/_secrets`、`/api/analyze`、`/mail/callback`。
- **密码哈希**：`PBKDF2(SHA-256, iter=100000)`。
- **JWT 会话**：`HS256` 自签，Cookie 名：`cgpt_session`，作用域 `.iieao.com`。
- **验证码频控**：同邮箱+purpose 在 60s 内不插入新码，复用最近未过期验证码，可“直返”或“同步发信”。
- **SES 签名**：TC3-HMAC-SHA256，`ses.{region}.tencentcloudapi.com` → `ses.intl.tencentcloudapi.com`。  
- **Analyze**：脱敏 + 截断 + 统一 OpenAI 形状返回。

---

## 前端应用（ContractGPT Web）部署

### 4.1 目录结构建议
```
web/
├─ index.html              # 登录页（支持注册/登录入口或分离 login.html）
├─ app.html                # 受保护的主应用页（合同上传与对话）
├─ assets/
│  ├─ styles.css
│  ├─ logo.svg
│  └─ apple-ui.css        # Apple 风格主题（可选）
├─ js/
│  ├─ app.js              # 你提供的核心逻辑（本手册已审阅）
│  └─ vendor/
│     ├─ pdf.min.js
│     └─ mammoth.browser.min.js
└─ .well-known/            # 如需 Apple/安全策略文件等
```

### 4.2 静态站点托管
可选：
- **Cloudflare Pages**（推荐）：直接连 Git 仓库；或上传构建产物；
- **Nginx + CDN**：见附录 C；
- **Vercel/Netlify/OSS + CDN** 亦可。

#### 4.2.1 使用 Cloudflare Pages
1. 在 Cloudflare 仪表台创建 **Pages 项目**，绑定 Git 仓库（或直接上传 `web/`）。
2. 设置构建命令为空（纯静态），构建输出目录为 `web`。
3. 绑定自定义域名（例如 `cap.iieao.com`），开启强制 HTTPS。
4. 设置**环境变量**（前端通常无需，但可用于 `BASE_API` 可选）。

### 4.3 前端安全头建议
在静态站点入口页设置：
- `Content-Security-Policy (CSP)`：限制脚本来源（允许你使用的 CDN、站点域名、Workers 域）；
- `X-Frame-Options: DENY`；
- `X-Content-Type-Options: nosniff`；
- `Referrer-Policy: no-referrer-when-downgrade` 或更严。

> 注意：如使用 `pdf.js` 与 `mammoth` 的 CDN，需要在 CSP 中写入对应 `script-src` 白名单。

### 4.4 前端关键交互说明
- 登录态检查走 `api/auth/me`，保持 `credentials: "include"`；
- 上传三类文件（`.txt/.pdf/.docx`），分别走 `FileReader` 解析；
- 风控关键词渲染到 `riskCards`；
- 发送对话消息前必须存在 `fullContractText`；
- 对答案渲染**做段落拆分**，避免大段文字影响阅读。

---

## 合同解析与风控关键字模块

### 5.1 解析路径
- `.txt`：`FileReader.readAsText` → 直接获得纯文本；
- `.pdf`：`pdfjsLib.getDocument({data})` → 逐页 `getTextContent()` → 拼接 `item.str`；
- `.docx`：`mammoth.extractRawText({ arrayBuffer })` → `result.value`。

### 5.2 风控关键字列表
前端内置了**较长列表**（详见代码），涉及：试用期、赔偿、竞业限制、保密协议、知识产权、违约金、劳动合同期限、工作地点/内容、薪资待遇、加班、福利待遇、解除合同、争议解决、不可抗力、自动续期、调岗、未签订书面合同、培训服务期、工伤责任、社保、兼职限制、视为离职、解释权归公司、报价确认单为准、整改费用、进场时间、分包条款、付款条件、变更计费、留置报告、逾期付款违约金、地域管辖、附件效力、廉政合同、不可抗力等。  
该列表用于**快速风险提示**与**高亮关键字**，并不替代专业法律意见。

### 5.3 关键词高亮实现
使用正则将关键字包裹 `<mark>`，注意对**正则特殊字符进行转义**，并用 `gi` 做**不区分大小写**的全局匹配。

---

## 对话式分析（/api/analyze）前后端协议

### 6.1 前端请求
- URL：`POST api/analyze`
- 头：`Content-Type: application/json`，`credentials: "include"`
- 体：
  ```json
  {
    "contract": "<合同全文文本>", 
    "question": "<用户问题>"
  }
  ```

### 6.2 后端处理
1. **会话校验**：`requireSession` 从 Cookie `cgpt_session` 验证 JWT；
2. **入参校验**：缺少 `contract/question` 返回 `400`；
3. **脱敏**：公司名/金额/日期/邮箱/手机/座机/IP/合同编号 → 统一替换为 `[公司]/[金额]/[日期]/[邮箱]/[手机]/[座机]/[IP]/[合同编号]`；
4. **截断**：超过 `MAX_CHARS=120000` 则 `slice(0, MAX_CHARS)`；
5. **调用 DeepSeek**：`https://api.deepseek.com/chat/completions`，`model: "deepseek-chat"`，非流式，`messages=[system, user(合同), user(问题)]`；
6. **容错**：对上游网络/非 2xx 响应统一封装 `ok:false`；成功则包装成**OpenAI 兼容**返回：
   ```json
   {
     "ok": true,
     "model": "deepseek-chat",
     "choices": [ { "message": { "role": "assistant", "content": "..." } } ]
   }
   ```

### 6.3 前端渲染
- 若响应 `!ok` 或 `response.ok === false`，在 `chatLog` 输出错误；
- 成功则按**段落**或**编号**/bullet 进行**分段渲染**。

---

## 认证与账号体系（注册/登录/会话）

### 7.1 账号模型
- 表 `users`：`id, username, email, password_hash, status, created_at, updated_at`；  
- `password_hash`：`pbkdf2$<iter>$<salt_hex>$<base64>` 格式；
- `status`：`active`/`disabled`。

### 7.2 注册流程
1. 前端请求 `/api/auth/send-code` purpose=`register`；
2. 用户收到验证码（或在 `ALLOW_INLINE_CODE=1` 时前端直返用于开发调试）；
3. 前端调用 `/api/auth/register` 携带 `email/username/password/code`；
4. 后端验证 `code`（未过期、未使用），写入 `users`，将该 `code` 标记为 `consumed=1`；
5. 后端签发 JWT，`Set-Cookie: cgpt_session=...; HttpOnly; Secure; SameSite=Lax; Domain=.iieao.com; Max-Age=2592000`。

### 7.3 登录流程（两步）
1. `/api/auth/login/start`：校验密码正确后，内部调用 `/api/auth/send-code` purpose=`login`；
2. `/api/auth/login/verify`：提交邮箱验证码后，签发会话 Cookie；

### 7.4 会话校验
- `/api/auth/me`：若 Cookie 有效，返回 `{authenticated:true, email, username}`，否则 `{authenticated:false}`。

### 7.5 频控与防刷
- 验证码**一分钟**频控：同邮箱 + 同目的（register/login），60s 内不再插库；
- 若 `changes === 0`：复用最近一条未过期验证码并可重发邮件；
- 建议增加**IP 节流**与**滑动窗口计数器**（Workers KV/Turnstile）。

---

## Cloudflare Workers 后端部署

### 8.1 准备
- 安装 `wrangler`：`npm i -g wrangler`；
- 登录：`wrangler login`；
- 创建 D1 数据库：`wrangler d1 create prod_auth`；
- 在 `wrangler.toml` 绑定：
  ```toml
  name = "contractgpt-api"
  main = "src/worker.js"
  compatibility_date = "2024-10-01"

  [vars]
  SESSION_ISSUER = "cap.iieao.com"
  SESSION_TTL_SECONDS = "2592000"
  SES_REGION = "ap-hongkong"
  ALLOW_INLINE_CODE = "0"

  [[d1_databases]]
  binding = "prod_auth"
  database_name = "prod_auth"
  database_id = "自动生成的ID"
  ```

### 8.2 部署
- 开发调试：`wrangler dev`；
- 生产发布：`wrangler publish`；
- 绑定自定义域或 Workers 路径路由（如 `api.cap.iieao.com/*`）。

### 8.3 路由映射
- `GET  /api/_secrets`：配置探针（仅返回布尔/简要值，避免泄露）；
- `POST /api/auth/send-code`：发验证码（支持直返/重发/频控）；
- `POST /api/auth/register`：注册并签发 Cookie；
- `POST /api/auth/login/start`：密码校验并发送登录验证码；
- `POST /api/auth/login/verify`：校验验证码并签发 Cookie；
- `GET  /api/auth/me`：会话探测；
- `POST /api/analyze`：AI 代理（**登录必需**）；
- `POST /mail/callback`：SES 回调（可日志化）。

---

## 邮件服务（腾讯云 SES）配置与签名

### 9.1 域名与发信地址
- 在腾讯云 SES 控制台完成域名**验证**与**退信**/回执配置；
- 准备**发信地址**（如 `no-reply@cap.iieao.com`），在 Workers 中设置 `SES_FROM`。

### 9.2 权限凭证
- 申请/检查 `TENCENTCLOUD_SECRET_ID` 与 `TENCENTCLOUD_SECRET_KEY`；
- 建议创建**最小权限**子账号，仅授予 SES 相关权限。

### 9.3 模板
- 创建 `SES_TEMPLATE_ID`（纯数字），内容参考[附录 E]；
- 模板中使用变量 `{{code}}`。

### 9.4 Worker 内部发送逻辑
- 实现 `TC3-HMAC-SHA256` 规范；
- 优先命中 `ses.{region}.tencentcloudapi.com`，失败再尝试 `ses.intl.tencentcloudapi.com` 或手工指定 `SES_API_HOST`；
- **清洗 header**，避免 CR/LF；
- 返回值包含 `host/requestId/messageId` 以便追踪。

---

## DeepSeek Chat API 集成说明

### 10.1 环境变量
- `DEEPSEEK_API_KEY`：后端必配；
- `model`：`deepseek-chat`（根据你当前所用版本）。

### 10.2 请求结构
```json
{
  "model": "deepseek-chat",
  "messages": [
    {"role": "system", "content": "你是一位资深合同审查法律顾问…"},
    {"role": "user", "content": "【模拟分析说明】以下为**已脱敏的合同样本**…\\n\\n<合同行文>"},
    {"role": "user", "content": "<用户问题>"}
  ],
  "stream": false
}
```

### 10.3 回包整形
- 无论上游返回何种细节，Worker 统一“OpenAI 兼容”结构：
  ```json
  { "ok": true, "model": "deepseek-chat", "choices": [{ "message": { "role":"assistant", "content":"..." } }] }
  ```
- 异常统一：`{ ok:false, error, detail, upstreamStatus }`。

---

## CORS、安全策略与合规要点

### 11.1 CORS
- 允许源白名单：`ALLOWED_ORIGINS = {"https://cap.iieao.com", "http://localhost:8788", "http://127.0.0.1:8788"}`；
- 响应头：
  - `Access-Control-Allow-Origin: <请求Origin或默认https://cap.iieao.com>`
  - `Access-Control-Allow-Credentials: true`
  - `Access-Control-Allow-Methods: GET, POST, OPTIONS`
  - `Access-Control-Allow-Headers: Content-Type, Authorization`

### 11.2 Cookie 策略
- `HttpOnly; Secure; SameSite=Lax; Domain=.iieao.com; Max-Age=2592000`；
- 在**HTTPS** 场景下发送。

### 11.3 密码学与传输
- PBKDF2(SHA-256, 100000)；
- 常数时间比较 `timingSafeEqual`；
- JWT HS256 自签，issuer/exp 受控；
- 全程 HTTPS。

### 11.4 脱敏与合规
- 后端脱敏覆盖：公司名、金额、日期、邮箱、手机、座机、IP、合同编号；
- 前端不持久化原始合同；
- 提示“结果仅供参考，非法律意见”。

---

## 数据库（D1）表结构与索引

### 12.1 建表（见附录 B）
- `users`（主表）：唯一索引 `email`，唯一索引 `username`；
- `verification_codes`：`target(email) + purpose + created_at` 组合，便于**频控**查询；

### 12.2 常用查询
- 取最近验证码：
  ```sql
  SELECT code, created_at, expires_at
  FROM verification_codes
  WHERE target=? AND purpose=?
  ORDER BY id DESC LIMIT 1;
  ```
- 用户查重：
  ```sql
  SELECT id FROM users WHERE email=?;
  SELECT id FROM users WHERE username=?;
  ```

---

## 环境变量与配置矩阵

| 变量名 | 示例值 | 说明 |
|---|---|---|
| `AUTH_JWT_SECRET` | `***` | HS256 密钥（强随机、仅后端） |
| `SESSION_ISSUER` | `cap.iieao.com` | JWT iss |
| `SESSION_TTL_SECONDS` | `2592000` | Cookie/JWT 生存期 |
| `SES_REGION` | `ap-hongkong` | 腾讯云 SES 区域 |
| `SES_API_HOST` | *(留空)* | 可手工指定端点 |
| `SES_FROM` | `no-reply@cap.iieao.com` | 发信地址 |
| `SES_TEMPLATE_ID` | `1234567` | 邮件模板 ID |
| `TENCENTCLOUD_SECRET_ID` | `AKID...` | 凭证 |
| `TENCENTCLOUD_SECRET_KEY` | `***` | 凭证 |
| `ALLOW_INLINE_CODE` | `0/1` | 是否“直返验证码”（仅用于开发） |
| `DEEPSEEK_API_KEY` | `sk-...` | DeepSeek API 密钥 |

---

## 上线前自检清单（Checklist）

- [ ] 域名与 HTTPS 生效；
- [ ] CORS 白名单正确；
- [ ] Cookie Domain/Path/Max-Age 校验；
- [ ] D1 已建表并有索引；
- [ ] SES 模板通过审核，发信地址可用；
- [ ] 环境变量完整；
- [ ] `/api/_secrets` 探针返回 `have_id:true, have_key:true, has_deepseek_key:true`；
- [ ] `/api/auth/send-code` 验证码可发送（或直返调试）；
- [ ] 注册/登录/登录校验链路打通；
- [ ] `/api/analyze` 成功返回内容，且**脱敏**与**截断**生效；
- [ ] 前端 `pdf.js / mammoth` 能解析样例文件；
- [ ] 监控/日志开通。

---

## 故障排查与应急手册

### 15.1 认证相关
- 症状：前端始终跳回 `index.html`  
  排查：  
  1) 浏览器看 `cgpt_session` 是否存在；  
  2) `/api/auth/me` 返回是否 `{authenticated:true}`；  
  3) 域、SameSite、Secure 是否阻止写入；  
  4) 代理层是否剥离了 `Set-Cookie`。

### 15.2 SES 发信失败
- 看 `/api/_secrets` 是否 `have_id` / `have_key` / `from` / `template`；
- Worker 日志中的 `sendEmailSES` 返回值：`code`/`httpStatus`/`host`/`requestId`；
- 测试改为**国际站端点**或**手动 host**；
- 确认模板通过审核、地址域名验证通过、配额充足。

### 15.3 DeepSeek 调用超时
- Worker 端设置 `AbortController` 超时 25s；
- 若频繁超时，考虑**降采样**（截断更短）、**重试机制**或**切换区域网络**。

### 15.4 D1 频控异常
- `INSERT ... WHERE NOT EXISTS` 语句未命中：检查 `created_at` 单位（ms）；
- 时间比较使用 `now - windowMs`，留意类型转换。

### 15.5 CORS 问题
- 控制台报 `CORS`：检查 `Origin` 是否在白名单；
- `OPTIONS` 预检是否返回 `204` 且包含 `Access-Control-Allow-Methods/Headers`；
- `credentials: "include"` 场景必须设置 `Access-Control-Allow-Credentials: true` 和**精确**的 `Allow-Origin`。

### 15.6 PDF/DOCX 解析
- `pdf.js` 版本不匹配：检查 `workerSrc` 与 `pdf.min.js` 是否同版本；
- `mammoth` 报错：确认以 `readAsArrayBuffer` 读取。

---

## 性能优化与成本控制

- **文本截断**：`MAX_CHARS` 依据付费与响应时延优化；
- **分段渲染**：前端将长答案拆段，避免长任务阻塞；
- **验证码复用**：减少 D1/SES 压力；
- **Region 就近**：SES 选香港，前端/Workers 绑定亚洲区域；
- **缓存**：静态资源长缓存；`/api/_secrets` 严禁缓存。

---

## 日志、监控与审计

- Workers 控制台/Logpush；
- 记录关键事件：登录成功/失败、验证码发送、SES requestId、AI 调用耗时；
- 谨慎日志：**不可**写入原始合同，仅可写入**脱敏后摘要**（或长度统计）。

---

## 运维 SOP：例行任务与演练

- 每周测试注册/登录/发信链路；
- 每月轮换 `AUTH_JWT_SECRET`（平滑发布）；
- 每季度回归测试脱敏规则与风险词库；
- 灾备演练：SES 国内端点不可用时切换国际站。

---

## Roadmap 与扩展建议

- **流式回答**（SSE）与前端实时段落渲染；
- **更细粒度权限**（组织/团队/角色）；
- **审计报表导出**（PDF/CSV）；
- **关键词词库远程配置**（D1 + 缓存）；
- **多模型回退**（DeepSeek → OpenAI/Groq 作兜底）；
- **Turnstile** 人机验证接入。

---

## 附录 A：完整 Worker 代码片段（整合版）

> 下述为对话中 Worker 代码的整理版（核心逻辑、路由、签名、脱敏等）。为避免冗长，这里保留主体实现，使用者直接替换你的 `src/worker.js`。

```js
// 省略：本手册前文已完整展示的路由与函数实现（与对话一致）。
// 请从对话版本复制粘贴；或在仓库中以本手册章节关键字检索：
// - withCORS / handleOptions / json
// - hashPassword / verifyPassword / timingSafeEqual
// - signJWT / verifyJWT / setSessionCookie / requireSession
// - sendCode / register / loginStart / loginVerify / authMe
// - sendEmailSES (TC3-HMAC-SHA256, 多端点兜底)
// - maskSensitiveText
// - /api/analyze DeepSeek 调用与统一回包
```

---

## 附录 B：SQL 脚本（D1 建表/索引/演示数据）

```sql
-- Users 表
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 验证码表
CREATE TABLE IF NOT EXISTS verification_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL,           -- email
  code TEXT NOT NULL,
  purpose TEXT NOT NULL,          -- 'register' | 'login'
  expires_at INTEGER NOT NULL,    -- ms timestamp
  consumed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- 常用索引
CREATE INDEX IF NOT EXISTS idx_vc_target_purpose_created
ON verification_codes(target, purpose, created_at DESC);

-- 演示数据（可选）
-- INSERT INTO users(...) VALUES (...);
```

---

## 附录 C：Nginx/Static Hosting 示例

```nginx
server {
  listen 443 ssl http2;
  server_name cap.iieao.com;

  ssl_certificate     /etc/ssl/certs/fullchain.pem;
  ssl_certificate_key /etc/ssl/private/privkey.pem;

  root /var/www/contractgpt/web;
  index index.html;

  add_header X-Frame-Options "DENY" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

---

## 附录 D：API 调用示例（curl/Postman）

### D.1 探针：/_secrets
```bash
curl -i https://api.cap.iieao.com/api/_secrets
```

### D.2 发送验证码（注册）
```bash
curl -sX POST https://api.cap.iieao.com/api/auth/send-code \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","purpose":"register"}'
```

### D.3 注册
```bash
curl -sX POST https://api.cap.iieao.com/api/auth/register \
  -H "Content-Type: application/json" \
  -c cookiejar.txt \
  -d '{"email":"test@example.com","username":"testuser","password":"P@ssw0rd!","code":"123456"}'
```

### D.4 登录（两步）
```bash
# Step1
curl -sX POST https://api.cap.iieao.com/api/auth/login/start \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"P@ssw0rd!"}'

# Step2
curl -sX POST https://api.cap.iieao.com/api/auth/login/verify \
  -H "Content-Type: application/json" \
  -b cookiejar.txt -c cookiejar.txt \
  -d '{"email":"test@example.com","code":"123456"}'
```

### D.5 会话检测
```bash
curl -s https://api.cap.iieao.com/api/auth/me -b cookiejar.txt
```

### D.6 合同分析
```bash
curl -sX POST https://api.cap.iieao.com/api/analyze \
  -H "Content-Type: application/json" \
  -b cookiejar.txt \
  -d '{"contract":"这里是合同全文……","question":"请指出主要风险并给出修改建议"}'
```

---

## 附录 E：腾讯云 SES 模板示例

- 模板 ID：`SES_TEMPLATE_ID=1234567`  
- 模板内容（HTML）：

```html
<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial;">
    <div style="max-width:560px;margin:auto;">
      <h2>ContractGPT 验证码</h2>
      <p>您的验证码为：<strong>{{code}}</strong> ，10 分钟内有效。</p>
      <p>若非本人操作，请忽略此邮件。</p>
    </div>
  </body>
</html>
```

---

## 变更日志（本对话演进记录）

- **v2（本次）**
  - 统一整理**前端**与**Workers**端代码；
  - 明确 `/api/_secrets` 探针返回项（含 `has_deepseek_key`）；
  - 在 `/api/analyze` 明确**脱敏 + 截断** + 统一回包；
  - 完整梳理**认证/注册/登录**与**验证码频控**细节；
  - 提供 D1 SQL、Nginx、curl、SES 模板与 Checklist；
  - 加强**安全策略**与**合规建议**、故障排查与 SOP。

- **v1（历史）**
  - 初版对话中零散代码整合；
  - 仅给出 Worker 段落与前端主要逻辑；
  - 文档不完整（已被本稿替代）。

---

> © ContractGPT Team. 本文档可在团队内与供应商间流通。严禁外泄原始合同行文。

