# DSH-SlashMenuChinese-LeftAligned

> 把 DSH 输入框里 `/` 菜单的**每一条**描述都换成中文，并让每一行的描述落在同一条左边缘。
> 零依赖，只改界面那一层：不碰任何上游包的文件，不注册也不覆盖任何技能。

装之前：

```
/acp                    Show bili context-compression status          ← 英文，贴右
/MisakaNet search      Search the failure-lesson library without …    ← 英文，贴右
/caveman               穴居人语气：… ｜ Terse caveman voice: …          ← 两截，撑满后截断
/office                Create, edit, inspect, or convert Office …     ← 贴右
```

装之后：

```
/acp        看当前对话的上下文压缩状态（billion-context 提供）；/acp 触发
/MisakaNet search  直接在输入框里搜失败经验库，不用离开对话；/misakanet 触发
/caveman    穴居人语气：先给答案，砍掉客套，技术事实一字不改；说 stop caveman 恢复
/office     读写 Office：文档、表格、演示、PDF，先挑对的那条流程
```

每一行的描述都从名字右边一个固定间距处开始——短描述不再被推到右边缘。

---

## 1. 它修的是哪两个问题

两个问题的成因完全不同，所以修法也不同。

**语言不一。** 菜单行显示的就是注册方写的那句话，而注册方有四种：

| 来源 | 例子 | 描述写在哪 |
|---|---|---|
| 第三方命令 | `/acp`、`/acp-cache` | billion-context 的 `ctx.commands.register({ …, description })` |
| 第三方取词器 | `MisakaNet search` | misakanet 的 composer source（`label` / `description`） |
| 第三方技能 | `/answer-me-with-html`、`/caveman`、`/egm-*` | 各包的 SKILL.md frontmatter |
| 核心技能 | `/office*`、`/diagnose-windows-sandbox-acl`、`/cordis-*` | 打包在 `app.asar` 里 |

这些文件要么属于 npm（改了下一次升级就没了），要么根本改不到（asar 里的东西），
而且技能注册表没有「改别人的描述」这个接口。→ 这一层交给 Client 半边在浏览器里换字。

手工做过中文化的插件还会把中文拼在英文前面，变成「中文 ｜ English」，一行装不下就被
「…」切掉——Client 半边顺手把它截到「｜」之前。

**对齐不一。** 描述那一列是 `text-align: right`：短描述贴右边缘（看着右对齐），长描述
撑满整行、末尾被「…」截断（看着左对齐）。于是同一张列表里两种节奏，读起来像两套 UI。
→ 一条注入的 `<style>` 把它拉回左边缘。

排查时抓到的真实 DOM（`/` 菜单打开时）：

```
button.pc3rQa_item  justify-content: normal
  span.pc3rQa_itemIcon
  span.pc3rQa_itemName        ← 名字
  span.pc3rQa_itemAlias       ← 别名（有的行没有）
  span.pc3rQa_itemDescription ← 描述，"贴右 / 截断" 就是它的 text-align 造成的
```

`pc3rQa_` 是 CSS Modules 的 hash，随 DSH 版本变，所以选择器一律用
`span[class*='itemDescription']`，不写死 hash。

## 2. 文件

| 文件 | 作用 |
|---|---|
| [index.js](index.js) | Host 半边：内置 28 条中文词典，注册只读路由 `GET /plugin-slash-menu-zh/state` 与自检路由 `GET /plugin-slash-menu-zh/ping` |
| [client.js](client.js) | Client 半边：注入对齐用的 `<style>`，用 MutationObserver 换掉描述文字，并把「换完仍是英文」的行汇报回去 |
| [cordis.patch.yml](cordis.patch.yml) | 包自带的 patch：插入 `slash-menu-zh` 行，`align` / `overrides` 两个配置项都在这里 |
| [locale/en.json](locale/en.json)、[locale/zh.json](locale/zh.json) | 插件管理页显示用的 `meta.title` / `meta.description` |
| [icon.svg](icon.svg) | 插件行图标（自绘） |
| [test/run-tests.mjs](test/run-tests.mjs) | 离线回归：package 契约、词典、Host 路由、客户端 bundle（vm + 假 DOM） |
| [tools/check-assets.mjs](tools/check-assets.mjs) | 静态资源自检：svg、locale、exports/files、patch、注册 id、语法 |
| [examples/cordis.patch.snippet.yml](examples/cordis.patch.snippet.yml) | 装进 DSH 的两种写法 |

Host 半边只 import `node:` 内置模块；Client 半边不 import 任何模块——按包名加载的插件
解析不到额外的裸包名。

## 3. 内置的 28 条

| 来源 | 条目 |
|---|---|
| 第三方命令 | `acp`、`acp-cache`（billion-context） |
| 第三方取词器 | `misakanet`（菜单里显示为 `MisakaNet search`） |
| 第三方技能 | `answer-me-with-html`；caveman 家族 5 条；EGM 家族 7 条 |
| 核心技能 | `office`、`office-docx`、`office-xlsx`、`office-pptx`、`office-export-pdf`、`office-recalculate`、`office-render`、`diagnose-windows-sandbox-acl`、`agent-experience`、`cordis-composition-reference`、`cordis-plugin-development`、`editing-cordis-compositions` |

本来就是中文的行（`权限`、`模型`、`目标`、`计划`、`反馈`、`下载日志`、`文件`、`全部功能`）
不需要词条——Client 半边看到汉字就放过。

**认行的规则**：先按名字，再按别名，再按名字的第一个词；一律小写、去掉开头的 `/`、
忽略大小写与多余空格。所以 `MisakaNet search`（名字）能认到词典里的 `misakanet`，
`/caveman` 能认到 `caveman`。

**认不出的行怎么办**：原样保留，不乱翻；同时把它的名字汇报给 Host 半边，出现在
`GET /plugin-slash-menu-zh/state` 的 `client.unknown` 里。也就是说漏翻是可查的：

```bash
curl http://127.0.0.1:<port>/plugin-slash-menu-zh/state | jq .client
# { "note": "patched", "rows": "31", "rewritten": "28", "unknown": "mystery-tool" }
```

拿到 `unknown` 就往 `DICT`（[index.js](index.js)）里补一条，或者用 `overrides` 临时盖。

## 4. 装进 DSH

两种方式任选一种，改完**重启 DSH**（Host 半边在启动时装载），再**刷新页面**
（Client 半边在页面加载时取）。括号里的说明见 [examples/cordis.patch.snippet.yml](examples/cordis.patch.snippet.yml)。

**A. 作为包（推荐）**：在 profile 的 `package.json` 里加一条 `link:` 依赖，并把包名加进
`dsh.profile.bundles`。包自带的 patch 会把 Host 行挂上，不需要再手写 `name`。

```json
{
  "dependencies": {
    "dsh-slash-menu-chinese": "link:P:/path/to/DSH-SlashMenuChinese-LeftAligned"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-slash-menu-chinese"]
    }
  }
}
```

> 依赖名要和包的 `name` 一致（这个仓库是 `dsh-slash-menu-chinese`）。本地插件常见的
> `@local/dsh-xxx` 写法要求包自己就叫 `@local/dsh-xxx`，两者不一致时 DSH 认不到这个 bundle。

**B. 只加一行**：把下面这段追加到 `~/.dsh/profiles/<profile>/cordis.patch.yml` 的
`insert` 列表里（`name` 用本仓库 `index.js` 的绝对路径）。

```yaml
- insert:
    - id: slash-menu-zh
      name: "/absolute/path/to/DSH-SlashMenuChinese-LeftAligned/index.js"
      config:
        align: left
        overrides: {}
```

## 5. 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `align` | `left` | `left` = 所有描述统一左对齐；`keep` = 保留宿主原样，只做中文替换 |
| `overrides` | `{}` | `name → 中文` 字典，优先级高于内置词典；想换官方条目的说法就写这里 |

## 6. 怎么确认它真的在跑

```bash
curl http://127.0.0.1:<port>/plugin-slash-menu-zh/state
```

返回里 `count` 是词典条数、`entries` 是全部词条、`align` 是当前对齐策略；如果浏览器
半边已经跑过，还会多一个 `client` 字段，记着它最近一次改了几行、哪几行没认出来：

```json
{ "version": "1.1.0", "align": "left", "count": 28, "entries": { "acp": "…" },
  "client": { "note": "patched", "rows": "31", "rewritten": "28", "unknown": "" } }
```

`client.unknown` 为空 = 这一屏里没有漏翻的英文行了。桌面端没有可用的开发者工具，
这个自检字段是唯一能区分「一行都没改」「改了一半」「根本没加载」的手段。

## 7. 边界

- 只改描述**文字**和它的对齐，不动行的结构、图标、点击行为，也不碰输入框里的内容。
- `patchOne` 是幂等的：宿主每次重渲染都会再触发一次 observer，已经对了的行原样放过。
- 中文行一律不动——包括 DSH 自己写的中文条目和别的插件已经中文化的行。
- 只处理 Web 平台（`dsh.client.platform: web`）；远程客户端和桌面端用的是同一套界面。
- DSH 大改菜单结构（不再是 `span[class*=itemDescription]`）时，这个包需要跟着改一行
  选择器——它读不到未公开的扩展点，这是界面层方案的固有代价。

## 8. 测试

全部离线，不需要 DSH、不读 `~/.dsh`、不联网：

```bash
node test/run-tests.mjs      # 44 项：package 契约 / 词典 / Host 路由 / 客户端 bundle
node tools/check-assets.mjs  # 28 项：svg / locale / exports / patch / 注册 id / 语法
```

客户端那一组用例在 `vm` 里跑真实的 `client.js`，配一份假 DOM（含 CSS Modules 风格的
class、双语行、核心技能行、靠别名认的行、认不出的行、后出现的行、cleanup），所以
「换字 / 核心技能也换 / 靠别名认行 / 漏翻被汇报 / 新行也补上 / 清理摘干净」都是断言过的，
而不是靠肉眼看菜单。

## License

MIT
