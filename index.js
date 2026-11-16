// slash-menu-zh — Host half: hold the Chinese glossary for the "/" menu and answer
// one read-only web route that the Client half reads.
//
// Why the UI layer and not the skill registry: the entries this plugin translates
// are registered by *other* packages — `/acp` and `/acp-cache` by billion-context
// (`ctx.commands.register({ name: 'acp', description: 'Show bili …' })`),
// `/answer-me-with-html` by that package's SKILL.md frontmatter, the core skills
// (office*, cordis-*, …) inside app.asar, and `MisakaNet search` by misakanet's
// composer-source provider. Those files belong to npm or to the app bundle: a patch
// there is overwritten by the next update, and the skill registry offers no way to
// re-describe somebody else's entry. Rewriting the palette row in the browser is the
// only layer that survives updates — a package that changes its description changes
// it above us, and the override simply stops matching.
//
// This file imports no third-party package: a plugin loaded by absolute path cannot
// resolve bare specifiers, so only `node:` builtins are used (here: none).

export const name = 'slash-menu-zh'
export const inject = ['webServer']

/** Fixed in both halves; not configurable so the two can never disagree. */
const ROUTE_PATH = '/plugin-slash-menu-zh/state'
const PING_PATH = '/plugin-slash-menu-zh/ping'

/** Kept in step with package.json; the Client half shows it in its report. */
const VERSION = '1.1.0'

const REPORT_LIMIT = 300

/**
 * name → 一句话中文解释.
 *
 * Coverage is "every row the "/" menu can show": third-party commands, third-party
 * skills, the core skills that ship inside app.asar, and the composer sources other
 * plugins add. Rows that arrive already in Chinese (权限 / 模型 / 目标 / 计划 / 反馈 /
 * 下载日志 / 文件 / 全部功能) need no entry — the Client half leaves Chinese alone.
 *
 * Whatever is missing after a run is reported back by the Client half and echoed on
 * ROUTE_PATH as `unknown`, so gaps are findable instead of invisible.
 */
export const DICT = {
  // --- third-party commands / sources -------------------------------------
  acp: '看当前对话的上下文压缩状态（billion-context 提供）；/acp 触发',
  'acp-cache': '校对提示词缓存：新增 / 压缩重付 / 上游失效各占多少；/acp-cache 触发',
  misakanet: '直接在输入框里搜失败经验库，不用离开对话；/misakanet 触发',

  // --- third-party skills --------------------------------------------------
  'answer-me-with-html': '把回答画成一张单页 HTML 图解：模型写短稿，自带 CLI 生成整页；页面比文字好读时主动用',
  caveman: '穴居人语气：先给答案，砍掉客套，技术事实一字不改；/caveman 开启，说 stop caveman 恢复',
  ultracave: '极限压缩语气：只剩碎片词，一个事实只说一次；/ultracave 开启',
  megacave: '文言文语气：用文言文写，字数大减，技术名词照原样；/megacave 开启',
  'caveman-stats': '查本次会话的输出量、缓存命中，以及各语气模式的用量归因；/caveman-stats 触发',
  'caveman-compress': '把 CLAUDE.md、待办这类记忆文件压成穴居人文体，留一份可读备份；/caveman-compress 触发',
  'egm-bootstrap': '铺底：给仓库子树批量生成 README 和书写规矩；/egm-bootstrap 触发',
  'egm-brainstorm': '头脑风暴：把半成品想法追问成结构化假设，产出概念简报（EGM 第一步）',
  'egm-draft': '写设计稿：照概念简报一节一节起草（EGM 第二步）',
  'egm-review': '金鱼评审：换一副新上下文做五阶段挑刺（拉远看／理解／批判／再看／可实施性）',
  'egm-resolve': '收敛意见：把评审提的缺陷逐条落到稿子里（改稿，不是辩解）',
  'egm-review-loop': '评审循环：多智能体对抗评审跑到不再出新问题，并自动应用批准项',
  'egm-drift-report': '漂移体检：核对设计文档和代码是否一致，出差异报告',

  // --- core skills (ship inside app.asar) ---------------------------------
  office: '读写 Office：文档、表格、演示、PDF，先挑对的那条流程',
  'office-docx': '读写 .docx：创建、读取、编辑、校验 Word 文档',
  'office-xlsx': '读写 .xlsx：数据、公式、校验 Excel 工作簿',
  'office-pptx': '读写 .pptx：创建、读取、编辑、校验 PowerPoint',
  'office-export-pdf': '用 LibreOffice 把 Office 文档导出成 PDF',
  'office-recalculate': '用 LibreOffice 重算表格公式，并核对算出来的值',
  'office-render': '用 LibreOffice 把文档渲染成图片，检查版式',
  'diagnose-windows-sandbox-acl': 'Windows 上沙箱莫名拒绝读写时：查这个路径和每一级父目录的权限，并当场修好',
  'agent-experience': '写改工具定义、技能描述、上下文加载这类「让信息可被发现」的活时照着做',
  'cordis-composition-reference': '查本 harness 的 Cordis 补丁语法、可装载包清单、预设怎么写',
  'cordis-plugin-development': '设计、评审、安装、调试本 harness 的插件 / bundle / 面板 / 工具 / MCP 连接',
  'editing-cordis-compositions': '写或校验 agent 预设与 Cordis composition：放哪、挂哪、有没有真挂上',
}

/** Last report from the Client half; null until a browser page calls PING_PATH. */
let lastClientReport = null

function reportField(params, key) {
  const raw = params.get(key)
  return raw === null || raw.length === 0 ? undefined : raw.slice(0, REPORT_LIMIT)
}

/** cordis config values may arrive as live refs (`.get()`) or plain values. */
function value(input, fallback) {
  const raw = input !== null && typeof input === 'object' && typeof input.get === 'function' ? input.get() : input
  return raw === undefined || raw === null ? fallback : raw
}

/** `overrides` is a name → Chinese map that wins over the built-in glossary. */
export function merged(overrides) {
  const extra = value(overrides, {})
  const patch = {}
  if (extra !== null && typeof extra === 'object' && !Array.isArray(extra)) {
    for (const [key, text] of Object.entries(extra)) {
      if (typeof key === 'string' && typeof text === 'string' && text.trim().length > 0) {
        patch[key.trim()] = text.trim()
      }
    }
  }
  return { ...DICT, ...patch }
}

/** `left` (default) or `keep`: whether the Client half left-aligns descriptions. */
export function alignOf(config) {
  const align = value(value(config, {})?.align, 'left')
  return align === 'keep' ? 'keep' : 'left'
}

export function apply(ctx, config) {
  const settings = value(config, {})

  const respond = (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'GET, HEAD' })
      res.end(JSON.stringify({ error: 'method not allowed' }))
      return
    }
    let payload
    try {
      const entries = merged(settings?.overrides)
      payload = {
        version: VERSION,
        at: new Date().toISOString(),
        align: alignOf(settings),
        count: Object.keys(entries).length,
        entries,
      }
      if (lastClientReport !== null) payload.client = lastClientReport
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: String(error?.message ?? error) }))
      return
    }
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': String(body.byteLength),
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler: respond,
      }),
    'slash-menu-zh: state route',
  )

  // No devtools are reachable in the desktop shell, so the Client half reports what
  // it patched (or threw) here, and ROUTE_PATH echoes the last report. That is the
  // only way to tell "rewrote 3 rows" from "never loaded", and `unknown` is the list
  // of rows that stayed English — the gap list for the next release.
  const ping = (req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'GET' })
      res.end(JSON.stringify({ error: 'method not allowed' }))
      return
    }
    const params = new URL(req.url, 'http://localhost').searchParams
    lastClientReport = {
      at: new Date().toISOString(),
      note: reportField(params, 'note'),
      aligned: reportField(params, 'aligned'),
      rows: reportField(params, 'rows'),
      rewritten: reportField(params, 'rewritten'),
      unknown: reportField(params, 'unknown'),
      sample: reportField(params, 'sample'),
      error: reportField(params, 'error'),
    }
    res.writeHead(204, { 'cache-control': 'no-store' })
    res.end()
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: PING_PATH,
        handler: ping,
      }),
    'slash-menu-zh: client report route',
  )

  console.warn(`[slash-menu-zh] serving GET ${ROUTE_PATH} and GET ${PING_PATH}`)
}
