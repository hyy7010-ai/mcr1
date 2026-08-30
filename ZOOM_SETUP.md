# Zoom 集成 — 部署与配置

GraceFlow 的 Zoom 集成走 **B 方案：每个教会绑定自己的 Zoom 账号**。
会议开在教会自己的 Zoom 下，会议容量、云录制空间、会议归属都是他们的，
平台方不需要上架 Zoom Marketplace 审核。

---

## 一、平台方要做的（一次性，你来做）

### 1. 跑数据库迁移

```bash
psql "$DATABASE_URL" -f supabase/migrations/20260830000001_zoom_integration.sql
```

或在 Supabase Dashboard → SQL Editor 里粘贴执行。迁移是幂等的，重复跑安全。

它会：
- 建 `church_integrations` 表（存各教会的 Zoom 凭证）
- 建 `zoom_integration_status()` RPC（前端查连接状态用，不含密钥）
- 给 `church_events` 加 `zoom_meeting_id` / `zoom_join_url` / `zoom_passcode`
- 给 `attendance_records` 加 `zoom_meeting_id` / `zoom_synced_at` / `zoom_unmatched`
- 给 `church_publications` 加 `source` / `external_id` 及去重唯一索引

### 2. 部署 Edge Function

```bash
supabase functions deploy zoom
```

**不需要 `supabase secrets set`。** Zoom 凭证是每个教会各自填的，存在数据库里；
这个函数只用到 Supabase 自带的 `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` /
`SUPABASE_ANON_KEY`，平台会自动注入。

### 3. 部署前端

照常 `npm run build` + 推送触发 GitHub Actions。没有新增 npm 依赖。

---

## 二、每个教会的管理员要做的（一次性，他们自己做）

界面里「管理工具 → 集成」已经内置了图文步骤，下面是同一份内容备查。

1. 用**账号所有者或管理员**身份登录 <https://marketplace.zoom.us>
2. **Develop → Build App → Server-to-Server OAuth**
3. 名字随便起（例如 `GraceFlow`）。**App Credentials** 页就有三串值：
   `Account ID`、`Client ID`、`Client Secret`
4. **Scopes** 页添加：

   | Scope | 用途 |
   |---|---|
   | `meeting:write` | 创建 / 修改 / 删除会议 |
   | `meeting:read` | 读会议详情（取主持人链接） |
   | `report:read:admin` | 拉参会名单做出席统计 |
   | `cloud_recording:read` | 列云录制 |
   | `user:read` | 探测账号套餐（判断有没有云录制） |

5. 点 **Activate** 激活应用
6. 回到 GraceFlow →「管理工具 → 集成」→ 粘贴三串值 → 连接

连接时 GraceFlow 会立刻拿这组凭证向 Zoom 换一次 token 验证，填错当场报错。

### 可选：页内开会（Meeting SDK）

如果希望会众不跳转 Zoom 客户端、直接在 GraceFlow 页面里开会，还需要**再建一个
应用**（Zoom 里 Meeting SDK 是独立的应用类型，凭证和上面那套不通用）：

1. **Develop → Build App → Meeting SDK**
2. 拿到它的 `Client ID` / `Client Secret`
3. 填进「管理工具 → 集成」的「Meeting SDK 凭证」两栏

不填也不影响其它功能，只是「在此加入」按钮不出现。

---

## 三、功能与套餐限制

| 功能 | 免费（Basic）账号 | 付费（Licensed）账号 |
|---|---|---|
| 日历一键开会议 | ✅ 可用，但会议限时 40 分钟 | ✅ |
| 线上出席导入 | ⚠️ 拿不到参会者邮箱，只能靠昵称匹配 | ✅ 邮箱精确匹配 |
| 云录制归档 | ❌ 免费账号没有云录制，入口自动隐藏 | ✅ |
| 页内开会 | ✅（另需 Meeting SDK 凭证） | ✅ |

GraceFlow 在连接时会自动探测套餐，并据此隐藏用不了的入口，
而不是给一个点了报错的按钮。

---

## 四、安全说明

- `church_integrations` 表 **RLS 开启且不设任何策略** —— anon / authenticated
  角色完全够不着，只有 Edge Function 用 service_role 能读写。
  **永远不要给这张表加 SELECT 策略**，那等于把 client_secret 交出去。
- 前端查连接状态走 `zoom_integration_status()`，只返回脱敏后的 client_id
  和套餐信息，永远不返回 secret。
- 会议的**主持人链接**（start_url）刻意不落库：它带一次性 token 且约 2 小时
  过期，存了既会失效，又等于把主持权限摊给任何能读活动表的人。需要时由
  Edge Function 现取，且只发给管理员。
- Meeting SDK 的主持人角色（role=1）由服务端按调用者角色裁决，前端传什么
  都不作数。

---

## 五、常见问题

**「Zoom 拒绝了这组凭证」**
多半是把 Meeting SDK 的凭证填到了 Server-to-Server 那三栏（两者不通用），
或者应用建好后没点 Activate。

**导入出席时说「Zoom 还没有这场会议的参会记录」**
Zoom 的参会报表通常在会议结束后约 30 分钟才生成，太早拉是空的。

**归档的录制点进去要密码**
Zoom 给录制单独设了播放密码。归档时 GraceFlow 已经把密码写进了出版物的说明
里，列表上带 🔒 标记的就是这种。
