# delete-session

在 DSH Web 的会话行「…」菜单里彻底删除一个会话。

DSH 本身没有删除会话的 API（`sessionPersistence` 只追加，归档只写标记）。这个 bundle 补上这一个动作：Host 半边提供同源 POST 路由并在磁盘上删除会话数据，Client 半边在会话菜单里加一行「删除会话」和确认框。

## 安装

要求 DSH `0.2.x`（在 `0.2.1-rc.2` 上开发与验证）。

```text
plugin_manager  install_bundle  target="F:\dsh-plugin\delete-session"
```

本地目录以 pnpm 的 `link:` 方式安装：插件文件只存在于源目录，profile 的 `node_modules` 里只有一个目录链接。安装后 Host 立即生效；Client 模块由 loader 加载，刷新页面即可。

卸载：

```text
plugin_manager  remove_bundle  target=delete-session
```

再删除 `<DSH_HOME>/delete-session/`（tombstone 与审计日志）即可。

## 使用

1. 点击任意会话行右侧的「…」。
2. 选择「删除会话」（在 Copy Session ID 之后，独立分组）。
3. 确认。冷会话会立即删除并从列表消失。

## 删除范围

会删除：

- 会话日志目录：`<DSH_HOME>/sessions/<project>/<sessionId>/`
- 投影缓存：`<DSH_HOME>/storages/session_projcache/sessions/<sessionId>.json`（及 `.bak.*`）
- 该会话的固定 / 归档标记（通过 Workspace registry 的公开方法）
- 前端列表行（Host 发出 `api-session/removed`）
- 审计记录：`<DSH_HOME>/delete-session/deleted.jsonl`（只记 id、时间、大小）

不会删除：

- 工作区里的文件（会话之外的内容一律不动）
- 附件对象（`<DSH_HOME>/attachments/v1`，跨会话共享、内容寻址、没有引用计数）
- 工具输出的溢出文件（OS 临时目录，30 天后自动清理）
- 其它会话，包括由它 fork 出来的会话和子代理会话

## 运行中的会话

一个会话被 prompt 过之后，Host 会为它保留一个 live Agent，日志文件处于写入状态，且 `agents` 没有对外 dispose API，所以不能立刻硬删。

- 直接删除会返回 `409 session/live`，界面提示「停止并稍后删除」。
- 选择「停止并稍后删除」后：停止运行中的工作、归档该会话、把 id 写入 `<DSH_HOME>/delete-session/pending.json`。
- 下次 DSH 启动 1.5 秒后，插件会自动删除这些待处理会话并清空 tombstone。

注意：`pending.json` 是**硬删除意图**；在重启前即使把会话 unarchive，也不会取消删除。要反悔只能删掉 pending 里对应的记录。

## HTTP 接口（Host）

```text
POST /delete-session/delete
content-type: application/json
{ "sessionId": "session-…", "mode": "delete" | "defer" }
```

- 安全闸门只有一处：`ctx.connection.requestRejection`（Host/Origin fence + 浏览器登录 cookie + trusted/bind authority）。Host 没有 `connection` 服务时，退回到插件自己的 loopback + Origin 校验。
- 请求体上限 4 KiB；`sessionId` 必须匹配 `^session-[A-Za-z0-9._-]{1,180}$`。
- 路径安全：只接受 `sessions` 根目录下、与 id 完全同名的真实目录；`lstat` 拒绝符号链接，`realpath` 必须仍在根目录内。
- 响应：`200 { deleted: true, bytes, dirs, cache }`、`202 { deferred: true }`、`400/401/403/409/413/415/500`。
- 同一个 id 同时只允许一个删除请求（`409 session/busy`）。

## 配置

`cordis.patch.yml` 的 `config` 可覆盖以下路径（一般不需要）：

| 键 | 默认值 |
|---|---|
| `dshHome` | `$DSH_HOME`，否则 `~/.dsh` |
| `sessionsRoot` | `<dshHome>/sessions` |
| `storagesRoot` | `<dshHome>/storages` |

## 开发

- 纯 JS，无构建、无依赖。Host 入口 `index.js`（`apply` + `inject: ['webServer']`），Client 入口 `client.js`（`window.__ModuleLoader__.load({ id, factory })` 产物，id 与包名一致）。
- 不 import 任何 Harness Client 包：菜单行、对话框、按钮、图标全部是自带 React + `--dsw-alias-*` 主题 token；唯一页面资源是由 `apply` 安装、由 `ctx.effect` 清理的 `<style>`。
- 改 `index.js` 后需要重启 DSH；开发时也可以用 `plugin_manager set_bundle` 关闭再打开来重新加载 Host 模块。只改 `client.js` 刷新页面即可。
- 可用的扩展点：`sidebar.workspaces.session.menu.item`（order 500）和 `shell.overlay`（order 800），均通过 `ctx.slots.inject` 注册，声明坍缩时自动移除。

## English summary

Adds a "Delete session" row to the Session "…" menu. The Host half registers an authenticated same-origin `POST /delete-session/delete` route and removes the session log directory, projection cache, pin/archive marks, and the client list row. A session with a live Agent cannot be deleted immediately; `mode: "defer"` stops and archives it and records a tombstone purged at the next DSH start. Workspace files and shared attachments are never touched. No Harness Client package is imported; the UI is plain React over theme tokens.

## License

MIT © 2026 Plusle
