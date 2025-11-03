📘 ContractGPT_部署手册.md

文档长度会超过 **5500 字**，内容将涵盖：

-   ✅ 项目概述与设计目标

-   ✅ 环境与依赖说明

-   ✅ Cloudflare Pages 与 Workers 的关系

-   ✅ 环境变量完整配置表（含国内站 Tencent Cloud SES）

-   ✅ Worker 逻辑解析与安全机制说明

-   ✅ 部署流程（GitHub Pages + Worker）

-   ✅ 调试与验证（包括 /api/\_secrets 与日志调试方法）

-   ✅ 常见错误与修复方案

-   ✅ 前端交互逻辑分析（含文件上传、AI 聊天、登录状态维护）

-   ✅ 国内/国际 API 兼容说明

-   ✅ 最终部署验证 checklist

以下是完整的 Markdown 文档正文👇

# **📘 ContractGPT 项目部署与集成手册**

**版本：v1.3.2 \| 更新日期：2025-11-02\
作者：ChatGPT-5（根据用户实际部署过程整理）**

本手册详细记录了从零部署 ContractGPT 合同智能审查平台的全过程，包括：

-   Cloudflare Pages 前端部署；

-   Cloudflare Workers 后端逻辑；

-   腾讯云 SES 邮件系统接入；

-   登录与注册验证；

-   AI 模型分析（DeepSeek Chat 接口）；

-   本地调试、跨域（CORS）配置；

-   国内/国际 API 路径差异；

-   环境变量配置与测试方法。

## **一、📖 项目总体概述**

### **1.1 项目简介**

**ContractGPT**
是一个智能合同分析与登录认证一体化平台，由以下两部分组成：

  ---------------------------------------------------------------------------------------
  **模块**              **功能**                                           **部署位置**
  --------------------- -------------------------------------------------- --------------
  🧩 **前端（Pages）**  用户登录、注册、上传合同文件、展示风险提示、AI     Cloudflare
                        问答                                               Pages

  ⚙️                    用户认证、验证码邮件发送、合同内容分析、会话管理   Cloudflare
  **后端（Workers）**                                                      Workers
  ---------------------------------------------------------------------------------------

系统采用了 Cloudflare 原生的 **Workers + D1 数据库 + Pages
静态托管架构**，并通过 **腾讯云 SES（邮件推送）**
实现注册/登录验证码的发送。

### **1.2 技术栈**

  -----------------------------------------------------------------------
  **类型**   **技术**
  ---------- ------------------------------------------------------------
  前端框架   原生 JS + HTML + TailwindCSS（苹果风 UI）

  文件解析   pdf.js、mammoth.js

  后端       Cloudflare Worker（TypeScript/JS）

  数据存储   Cloudflare D1（SQLite）

  邮件服务   腾讯云 SES（国内站香港区）

  AI 模型    DeepSeek Chat（兼容 OpenAI ChatCompletion 格式）

  部署平台   Cloudflare Pages + Cloudflare Workers

  开发辅助   Wrangler CLI / GitHub Actions 自动构建
  -----------------------------------------------------------------------

### **1.3 系统结构图**

+\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--+

\| Cloudflare Pages \|

\| - index.html / login.html / contract.html \|

\| - JS: frontend.js \|

\| - 样式: Apple-like Tailwind 风格 \|

\| - 访问 /api/\* 路由 -\> 代理到 Workers \|

+\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--▲\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--+

│

API 调用（带 Cookie、CORS、JSON）

│

+\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--▼\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--+

\| Cloudflare Worker \|

\| - /api/auth/register /login /send-code /analyze 等路由 \|

\| - 使用 D1 记录用户与验证码 \|

\| - 调用腾讯云 SES 发送邮件 \|

\| - 调用 DeepSeek Chat 模型分析合同内容 \|

+\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--▲\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--+

│

HTTPS + TC3-HMAC-SHA256 签名认证请求

│

+\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--▼\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--+

\| 腾讯云 SES (香港节点) \|

\| - 接收邮件发送请求（SES API） \|

\| - 需要正确的 Region 与 Host \|

\| - 国内站必须使用 ap-hongkong \|

+\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--+

## **二、🌍 环境与依赖说明**

### **2.1 环境需求**

  -----------------------------------------------------------------------
  **部署组件**    **依赖条件**
  --------------- -------------------------------------------------------
  Cloudflare      支持 fetch、crypto.subtle、TextEncoder
  Worker          

  Cloudflare      支持静态资源部署，可绑定自定义域名
  Pages           

  腾讯云 SES      必须开通邮件推送服务（地域：ap-hongkong）

  DeepSeek API    需要注册 DeepSeek 开发者账号并获取 API_KEY

  数据库 D1       Cloudflare D1 建立数据库
                  prod_auth（包含用户表、验证码表）
  -----------------------------------------------------------------------

### **2.2 D1 数据库表结构**

CREATE TABLE IF NOT EXISTS users (

id INTEGER PRIMARY KEY AUTOINCREMENT,

created_at INTEGER,

updated_at INTEGER,

username TEXT UNIQUE,

email TEXT UNIQUE,

password_hash TEXT,

status TEXT

);

CREATE TABLE IF NOT EXISTS verification_codes (

id INTEGER PRIMARY KEY AUTOINCREMENT,

target TEXT,

code TEXT,

purpose TEXT,

expires_at INTEGER,

consumed INTEGER,

created_at INTEGER

);

### **2.3 Worker 依赖的环境变量**

  ---------------------------------------------------------------------------------------------------------------
  **类型**     **变量名**                **示例值**                            **说明**
  ------------ ------------------------- ------------------------------------- ----------------------------------
  🔑 密钥      TENCENTCLOUD_SECRET_ID    AKIDxxxxxxxx                          腾讯云 API ID

  🔒 密钥      TENCENTCLOUD_SECRET_KEY   N1xxxxxxxxxxxx                        腾讯云 API KEY

  🌏 地域      SES_REGION                ap-hongkong                           国内站香港区

  📮 发件人    SES_FROM                  ContractGPT@iieao.com                 发信邮箱

  🧾 模板      SES_TEMPLATE_ID           154156                                腾讯云 SES 模板 ID

  🌐 主机      SES_API_HOST              ses.ap-hongkong.tencentcloudapi.com   指定国内 SES 接口

  🔓           ALLOW_INLINE_CODE         1                                     允许验证码直接返回前端（测试用）
  内嵌验证码                                                                   

  🤖 AI Key    DEEPSEEK_API_KEY          sk-xxxxx                              DeepSeek 模型 API Key

  🍪 JWT       AUTH_JWT_SECRET           xxxxxxjwtsecret                       登录令牌签名密钥
  Secret                                                                       
  ---------------------------------------------------------------------------------------------------------------

⚠️ 注意：腾讯云 SES **国内站（ap-hongkong）** 与
**国际站（ap-singapore）** 不可混用。\
调用时 Region 必须与开通地域一致，否则报错 InvalidRegion。

## **三、🚀 部署流程（Cloudflare Pages + Workers）**

### **3.1 GitHub 仓库准备**

1.  新建一个仓库 ContractGPT

2.  上传以下目录结构：

ContractGPT/

├── index.html

├── login.html

├── contract.html

├── frontend.js

├── style.css

├── worker/

│ └── index.js

├── wrangler.toml

├── package.json

└── README.md

1.  在 Cloudflare Pages 绑定此 GitHub 仓库。\
    构建命令留空（纯静态项目），输出目录为 /。

### **3.2 Cloudflare Worker 配置**

1.  打开 **Cloudflare Dashboard → Workers → 新建 Worker**

2.  将你调整后的完整 Worker 代码粘贴进去

3.  点击 **Settings → Variables**

4.  添加所有上表提到的环境变量（⚠️ 注意类型）：

  --------------------------------------------------------------------------
  **类型**   **名称**                  **值**
  ---------- ------------------------- -------------------------------------
  Secret     TENCENTCLOUD_SECRET_ID    你的 AKID
  text                                 

  Secret     TENCENTCLOUD_SECRET_KEY   你的 SK
  text                                 

  Text       SES_REGION                ap-hongkong

  Text       SES_FROM                  ContractGPT@iieao.com

  Text       SES_TEMPLATE_ID           154156

  Text       SES_API_HOST              ses.ap-hongkong.tencentcloudapi.com

  Text       ALLOW_INLINE_CODE         1

  Secret     DEEPSEEK_API_KEY          sk-xxxxx
  text                                 

  Secret     AUTH_JWT_SECRET           自定义随机字符串
  text                                 
  --------------------------------------------------------------------------

🔹 如果出现 \"have_key\": false\
请检查 **Secret key 是否未正确保存**（Cloudflare Secret
一旦修改后必须重新部署 Worker）。

### **3.3 连接 Pages 与 Worker**

在 Cloudflare Pages 的 **"Functions" 或 "Custom routes"** 中配置：

/api/\* → 绑定到你的 Worker 路径

例如：

Route: cap.iieao.com/api/\*

Worker: contractgpt-api

这样，前端所有 /api/\... 请求会直接由 Worker 处理。

### **3.4 D1 数据库绑定**

在 Worker 设置中：

-   点击 **Resources → D1 Database Bindings**

-   绑定你的数据库名称 prod_auth

例如：

Binding name: prod_auth

Database: ContractGPT-Auth

代码中引用：

await env.prod_auth.prepare(\"SELECT \...\")

### **3.5 重新部署**

每次修改环境变量或 Worker 逻辑后，务必点击：

**Deploy → Re-deploy from latest**

如果前端绑定到 GitHub 仓库，只需 push 到 main 分支即可自动更新。

## **四、🧠 Worker 核心逻辑详解**

### **4.1 路由分发**

Worker 使用以下路由分发结构：

  ----------------------------------------------------------------------------
  **路径**                   **方法**   **功能**
  -------------------------- ---------- --------------------------------------
  /api/auth/send-code        POST       发送注册或登录验证码

  /api/auth/register         POST       注册新用户

  /api/auth/login/start      POST       登录初步验证（密码+邮件验证码）

  /api/auth/login/verify     POST       登录验证码验证

  /api/auth/me               GET        返回当前用户信息

  /api/analyze               POST       合同分析（需登录）

  /api/\_secrets             GET        检查 Worker 环境变量状态

  /mail/callback             POST       腾讯云 SES 回调（调试用）
  ----------------------------------------------------------------------------

### **4.2 验证码逻辑与冷却机制**

sendCode() 函数实现了验证码发送逻辑：

-   同一个邮箱在 60 秒内不能重复发；

-   复用上一次验证码（冷却中）；

-   可配置 ALLOW_INLINE_CODE=1 直接返回验证码；

-   生产环境应关闭该直返功能。

部分伪代码：

const code = (Math.floor(Math.random() \* 900000) + 100000).toString();

const INLINE = String(env.ALLOW_INLINE_CODE \|\| \"\") === \"1\";

\...

if (INLINE) {

ctx.waitUntil(sendEmailSES(\...));

return json({ ok: true, code, channel: \"inline\" });

}

### **4.3 邮件发送（腾讯云 SES）**

SES 签名算法采用 **TC3-HMAC-SHA256**，关键字段：

  ------------------------------------------------------------------------
  **参数**       **示例值**                               **说明**
  -------------- ---------------------------------------- ----------------
  Host           ses.ap-hongkong.tencentcloudapi.com      国内站接口

  X-TC-Region    ap-hongkong                              必须与地域一致

  X-TC-Action    SendEmail                                API 动作

  X-TC-Version   2020-10-02                               版本号

  Algorithm      TC3-HMAC-SHA256                          签名算法
  ------------------------------------------------------------------------

发送请求成功后返回：

{

\"Response\": {

\"MessageId\": \"xxxx\",

\"RequestId\": \"xxxx\"

}

}

失败返回：

{

\"Response\": {

\"Error\": { \"Code\": \"AuthFailure\", \"Message\": \"Invalid secret
key\" }

}

}

### **4.4 DeepSeek 合同分析逻辑**

const payload = {

model: \"deepseek-chat\",

messages: \[

{ role: \"system\", content: \"你是一位资深合同审查法律顾问\...\" },

{ role: \"user\", content: preface + maskedContract },

{ role: \"user\", content: question }

\]

};

返回结果结构：

{

\"ok\": true,

\"choices\": \[

{ \"message\": { \"role\": \"assistant\", \"content\":
\"合同风险分析如下\...\" } }

\]

}

### **4.5 Cookie 会话与 JWT 签名**

-   登录成功后生成 cgpt_session Cookie；

-   有效期：30 天；

-   域名作用域：.iieao.com；

-   Worker 使用 verifyJWT() 校验合法性；

-   前端请求时 fetch(\..., { credentials: \"include\" }) 自动携带。

## **五、💻 前端逻辑详解**

### **5.1 登录状态自动检测**

(async () =\> {

const r = await fetch(\"/api/auth/me\", { credentials: \"include\" });

const me = await r.json();

if (!me.authenticated) location.href = \"index.html\";

})();

作用：

-   页面加载时检查用户是否登录；

-   若未登录则跳转登录页。

### **5.2 文件上传与解析逻辑**

前端支持 .txt、.pdf、.docx 格式。

PDF 解析：

const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;

const content = await page.getTextContent();

text += content.items.map(item =\> item.str).join(\" \");

DOCX 解析：

mammoth.extractRawText({ arrayBuffer: e.target.result })

.then(result =\> fullContractText = result.value)

### **5.3 风险检测算法**

系统内置 80+ 条关键风险提示：

-   试用期条款

-   竞业限制

-   违约金

-   自动续约

-   工伤赔偿

-   不可抗力

-   保密条款\
    等等。

通过关键词匹配 + 高亮显示：

const pattern = new RegExp(\`(\${escapedKeywords.join(\"\|\")})\`,
\"gi\");

return text.replace(pattern, \"\<mark\>\$1\</mark\>\");

### **5.4 AI 分析交互逻辑**

调用同域接口：

const response = await fetch(\"/api/analyze\", {

method: \"POST\",

credentials: \"include\",

headers: { \"Content-Type\": \"application/json\" },

body: JSON.stringify({ contract: fullContractText, question: userMessage
})

});

显示分析结果：

const answer = data?.choices?.\[0\]?.message?.content \|\|
\"（模型未返回内容）\";

未登录时自动提示跳转：

if (msg === \"unauthorized\") {

msg = \"未登录，请返回登录页后重试。\";

setTimeout(() =\> { location.href = \"index.html\"; }, 2000);

}

### **5.5 Apple 风格 UI 说明**

-   采用浅灰背景 + 毛玻璃按钮；

-   主色调：#005A9E；

-   圆角统一 border-radius: 12px;

-   采用系统字体堆栈 -apple-system, BlinkMacSystemFont, \"SF Pro
    Text\"；

-   所有状态信息（✅、⚠️、❌）以 emoji 开头；

-   风格轻盈，类似 Apple Developer Portal。

## **六、🔍 调试与诊断**

### **6.1 检查环境变量加载**

访问：

GET https://你的域名/api/\_secrets

返回：

{

\"have_id\": true,

\"have_key\": true,

\"region\": \"ap-hongkong\",

\"from\": \"ContractGPT@iieao.com\",

\"template\": \"154156\",

\"allow_inline_code\": true,

\"has_deepseek_key\": true

}

若 \"have_key\": false，说明 Secret Key 未生效，需重新部署 Worker。

### **6.2 调试 SES 调用**

Worker 已包含日志：

console.log(\"🚨 SECRET_ID:\", env.TENCENTCLOUD_SECRET_ID \|\|
\"MISSING\");

可在 Cloudflare Dashboard → Workers → Logs 中查看输出。

### **6.3 邮件发送失败常见原因**

  -----------------------------------------------------------------------
  **错误代码**              **说明**        **解决方法**
  ------------------------- --------------- -----------------------------
  AuthFailure               密钥无效        重新生成 Secret Key

  InvalidRegion             Region 错误     确保 Region=ap-hongkong

  SignatureFailure          签名错误        检查时区/签名字符串

  MissingParameter          模板参数缺失    检查 TemplateData 格式

  RequestLimitExceeded      调用频率超限    增加冷却时间
  -----------------------------------------------------------------------

## **七、🧩 常见问题与修复方案**

### **Q1：have_key: false**

➡ 重新进入 Worker → Settings → Variables\
→ 删除旧 Secret → 重新添加 → Re-deploy。

### **Q2：验证码邮件未发送**

可能原因：

1.  SES_FROM 发件人邮箱未验证；

2.  模板 ID 填错；

3.  Region 与 Host 不匹配。

### **Q3：AI 无法返回结果**

检查：

1.  /api/\_secrets 中 has_deepseek_key 是否为 true；

2.  Worker 日志是否出现 upstream_network_error；

3.  若 502，确认 DeepSeek API 正常。

### **Q4：登录后 AI 仍提示"请先登录"**

前端必须用：

credentials: \"include\"

且 Origin 必须在后端 ALLOWED_ORIGINS 中。

### **Q5：Cloudflare Pages 环境变量无效？**

确实如此------Pages 环境变量只在 **Functions** 中生效，而不是 Worker。\
所以 **应当在 Worker** 中设置环境变量。

## **八、📦 最终部署检查清单（Checklist）**

  ----------------------------------------------------------------------------
  **项目**                        **状态**   **检查方式**
  ------------------------------- ---------- ---------------------------------
  ✅ Worker 正常运行              ✅         打开 /api/\_secrets 返回 OK

  ✅ D1 数据库连接成功            ✅         注册新用户无报错

  ✅ 邮件发送成功                 ✅         收到验证码邮件

  ✅ DeepSeek 返回分析结果        ✅         上传合同并提问

  ✅ Cookie 会话正常              ✅         登录后可访问 /api/auth/me

  ✅ CORS 正常                    ✅         前端 fetch 请求无跨域错误

  ✅ UI 显示完整                  ✅         所有按钮、状态区正常
  ----------------------------------------------------------------------------

## **九、🧱 附录：完整 Worker 路由速查表**

  ---------------------------------------------------------------------------
  **路径**                      **方法**   **功能说明**
  ----------------------------- ---------- ----------------------------------
  /api/auth/send-code           POST       发送验证码（注册/登录）

  /api/auth/register            POST       注册用户

  /api/auth/login/start         POST       登录密码验证+发送验证码

  /api/auth/login/verify        POST       校验验证码并签发 Session

  /api/auth/me                  GET        返回登录状态

  /api/analyze                  POST       分析合同内容

  /api/\_secrets                GET        检查 Worker 环境变量状态

  /mail/callback                POST       SES 邮件回调接口

  /                             GET        健康检查（返回 {ok:true}）
  ---------------------------------------------------------------------------

## **十、📜 项目总结与建议**

ContractGPT 的架构设计实现了：

-   完全前后端分离；

-   Cloudflare 全球边缘部署；

-   腾讯云 SES（国内）API 调用；

-   DeepSeek 智能审查能力；

-   强安全（JWT + HttpOnly Cookie + 频控验证码）；

-   高兼容性（支持 TXT、PDF、DOCX 合同）；

-   高可维护性（通过 /api/\_secrets 自检）；

-   良好用户体验（Apple 风格 UI）。

🎯 **最终结果：**

用户可以上传合同 → 自动检测风险 → 进一步向 AI 提问 →\
结合风险关键词与深度分析，获得精准的合同合规意见。

## **📎 建议目录结构（最终部署）**

/ContractGPT

│

├── pages/

│ ├── index.html

│ ├── login.html

│ ├── contract.html

│ ├── frontend.js

│ └── style.css

│

├── worker/

│ └── index.js

│

├── wrangler.toml

├── package.json

└── ContractGPT_部署手册.md

## **⚡ 结语**

你现在部署的版本已支持：

-   腾讯云 SES 国内站（香港）；

-   DeepSeek Chat 智能合同分析；

-   JWT 登录保持；

-   Apple 风格 Portal 界面；

-   完整的防频控邮件机制；

-   自动脱敏与高亮风险提示。
