// 离线回归测试：不需要 DSH、不读 ~/.dsh、不联网。
//
//   node test/run-tests.mjs
//
// 覆盖四块：
//   1. package 契约 —— DSH 怎么加载这个包（入口、bundle patch、client、files）
//   2. 词条词典 —— 28 条内置、每条都是纯中文、第三方与核心技能都在
//   3. Host 路由 —— GET / HEAD / 405、overrides 合并、align 透传、客户端自检上报
//   4. 客户端 bundle —— 在 vm 里跑 client.js：注入 <style>、换掉双语行和英文行、
//      核心技能也换、靠别名/首词认行（MisakaNet search → misakanet）、新出现的行
//      也会被补上、认不出的英文行会被汇报、清理时摘干净
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const readJson = (rel) => JSON.parse(read(rel))

let failures = 0
function group(label) {
  console.log(`\n${label}`)
}
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

// ---------------------------------------------------------------------------
// 1. package 契约
// ---------------------------------------------------------------------------
group('用例 1：package.json 是 DSH 认得的 bundle')

const pkg = readJson('package.json')
check('名字不带 scope，能被 profile 当包名引用', /^[a-z0-9-]+$/.test(pkg.name), pkg.name)
check('是 ESM', pkg.type === 'module', pkg.type)
check('main 指向仓库里真实存在的入口', pkg.main === 'index.js' && existsSync(join(ROOT, pkg.main)), String(pkg.main))
check('dsh.bundle.patch 指向真实存在的 patch', existsSync(join(ROOT, pkg.dsh?.bundle?.patch ?? 'nope')), String(pkg.dsh?.bundle?.patch))
check('dsh.client 声明为 web 平台并立即加载', pkg.dsh?.client?.platform === 'web' && pkg.dsh?.client?.immediately === true)
check('exports 有 "./client"（浏览器半边按这个路径取）', pkg.exports?.['./client'] === './client.js', String(pkg.exports?.['./client']))
check(
  'files 会把 index / client / patch / 图标 / README 带出去',
  ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md'].every((f) => pkg.files?.includes(f)),
  JSON.stringify(pkg.files),
)
check('files 不会把 test / examples 发出去', !pkg.files?.some((f) => /^(test|examples)\//.test(f)), JSON.stringify(pkg.files))

// ---------------------------------------------------------------------------
// 2. 词条词典
// ---------------------------------------------------------------------------
group('用例 2：内置词典')

const host = await import('../index.js')
const DICT = host.DICT
/** Third-party rows: commands, composer sources, skills from other packages. */
const thirdParty = ['acp', 'acp-cache', 'misakanet', 'answer-me-with-html', 'caveman', 'megacave', 'egm-review']
/** Core skills that ship inside app.asar — also covered, the user asked for every row. */
const core = [
  'office',
  'office-docx',
  'office-xlsx',
  'office-pptx',
  'office-export-pdf',
  'office-recalculate',
  'office-render',
  'diagnose-windows-sandbox-acl',
  'agent-experience',
  'cordis-composition-reference',
  'cordis-plugin-development',
  'editing-cordis-compositions',
]

check('共 28 条', Object.keys(DICT).length === 28, String(Object.keys(DICT).length))
check('第三方条目都在', thirdParty.every((name) => typeof DICT[name] === 'string'), thirdParty.filter((n) => !DICT[n]).join(','))
check('核心技能也都在（不再放过官方的英文）', core.every((name) => typeof DICT[name] === 'string'), core.filter((n) => !DICT[n]).join(','))
check(
  '每条都是中文、且不再带「｜」拼接',
  Object.entries(DICT).every(([, text]) => /[\u3400-\u9fff]/.test(text) && !text.includes('｜')),
  Object.keys(DICT).filter((k) => !/[\u3400-\u9fff]/.test(DICT[k]) || DICT[k].includes('｜')).join(','),
)
check('名字都是小写 kebab', Object.keys(DICT).every((name) => /^[a-z0-9-]+$/.test(name)), Object.keys(DICT).filter((n) => !/^[a-z0-9-]+$/.test(n)).join(','))

// ---------------------------------------------------------------------------
// 3. Host 路由
// ---------------------------------------------------------------------------
group('用例 3：Host 半边')

const ROUTE = '/plugin-slash-menu-zh/state'
const PING = '/plugin-slash-menu-zh/ping'

function fakeCtx() {
  const routes = []
  return {
    routes,
    effect(fn) {
      return fn()
    },
    webServer: {
      register(definition) {
        routes.push(definition)
        return () => {}
      },
    },
  }
}

function call(handler, { method = 'GET', url = ROUTE } = {}) {
  const chunks = []
  const res = {
    status: 0,
    headers: {},
    writeHead(status, headers = {}) {
      res.status = status
      Object.assign(res.headers, headers)
    },
    end(body) {
      if (body !== undefined) chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(String(body)))
    },
  }
  handler({ method, url }, res)
  return { status: res.status, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }
}

const ctx = fakeCtx()
host.apply(ctx, {})

check('注册了两条 exact 路由', ctx.routes.length === 2 && ctx.routes.every((r) => r.kind === 'exact'), JSON.stringify(ctx.routes.map((r) => r.path)))
check('路径与两端约定一致', ctx.routes.map((r) => r.path).sort().join(',') === [ROUTE, PING].sort().join(','), ctx.routes.map((r) => r.path).join(','))

const stateRoute = ctx.routes.find((r) => r.path === ROUTE).handler
const pingRoute = ctx.routes.find((r) => r.path === PING).handler

const okState = call(stateRoute)
const state = JSON.parse(okState.body)
check('GET state → 200 JSON', okState.status === 200 && okState.headers['content-type'].includes('application/json'), String(okState.status))
check('state 带版本 / 条数 / align / 全量词典', state.version === '1.1.0' && state.count === 28 && state.align === 'left' && state.entries.acp === DICT.acp, JSON.stringify({ v: state.version, c: state.count, a: state.align }))

const headState = call(stateRoute, { method: 'HEAD' })
check('HEAD 只回头不回体', headState.status === 200 && headState.body === '', `${headState.status} ${headState.body.length}`)

const postState = call(stateRoute, { method: 'POST' })
check('非 GET/HEAD → 405', postState.status === 405 && JSON.parse(postState.body).error === 'method not allowed', String(postState.status))

check('GET ping → 204 无体', call(pingRoute, { url: `${PING}?note=patched&rewritten=3&rows=12` }).status === 204)
const echoed = JSON.parse(call(stateRoute).body).client
check('state 回显客户端自检', echoed?.note === 'patched' && echoed?.rewritten === '3' && echoed?.rows === '12', JSON.stringify(echoed))

call(pingRoute, { url: `${PING}?note=patched&rewritten=2&rows=9&unknown=mystery-tool,another-one` })
const echoedUnknown = JSON.parse(call(stateRoute).body).client
check('state 回显漏翻清单', echoedUnknown?.unknown === 'mystery-tool,another-one', String(echoedUnknown?.unknown))

const keepCtx = fakeCtx()
host.apply(keepCtx, { align: 'keep', overrides: { office: '读写 Office 全家桶' } })
const keepState = JSON.parse(call(keepCtx.routes.find((r) => r.path === ROUTE).handler).body)
check('overrides 能覆盖内置条目', keepState.entries.office === '读写 Office 全家桶', String(keepState.entries.office))
check('align 透传给客户端', keepState.align === 'keep', keepState.align)
check('overrides 不污染内置词典', DICT.office !== '读写 Office 全家桶')

// ---------------------------------------------------------------------------
// 4. 客户端 bundle（vm + 假 DOM）
// ---------------------------------------------------------------------------
group('用例 4：客户端 bundle')

function node(tag, attrs = {}) {
  const el = {
    nodeType: 1,
    tag,
    attrs: { ...attrs },
    children: [],
    parentElement: null,
    _text: null,
    get className() {
      return el.attrs.class ?? ''
    },
    get textContent() {
      return el._text !== null ? el._text : el.children.map((child) => child.textContent).join('')
    },
    set textContent(value) {
      el._text = String(value)
      el.children = []
    },
    appendChild(child) {
      child.parentElement = el
      el.children.push(child)
      return child
    },
    setAttribute(key, value) {
      el.attrs[key] = String(value)
    },
    getAttribute(key) {
      return el.attrs[key] ?? null
    },
    removeAttribute(key) {
      delete el.attrs[key]
    },
    remove() {
      const parent = el.parentElement
      if (parent === null) return
      const index = parent.children.indexOf(el)
      if (index >= 0) parent.children.splice(index, 1)
      el.parentElement = null
    },
    matches(selector) {
      return matchAny(el, selector)
    },
    querySelector(selector) {
      return el.querySelectorAll(selector)[0] ?? null
    },
    querySelectorAll(selector) {
      const found = []
      const walk = (current) => {
        for (const child of current.children) {
          if (matchAny(child, selector)) found.push(child)
          walk(child)
        }
      }
      walk(el)
      return found
    },
    closest(selector) {
      let current = el
      while (current !== null) {
        if (matchAny(current, selector)) return current
        current = current.parentElement
      }
      return null
    },
  }
  return el
}

function matchOne(el, part) {
  const attr = /^\[\s*([\w-]+)\s*([*^$]?=)?\s*['"]?([^'"\]]*)['"]?\s*\]$/.exec(part)
  if (attr !== null) {
    const [, name, operator, want] = attr
    const have = name === 'class' ? el.attrs.class : el.attrs[name]
    if (have === undefined) return false
    if (operator === '*=') return String(have).includes(want)
    return String(have) === want
  }
  return el.tag.toLowerCase() === part.toLowerCase()
}

function matchAny(el, selector) {
  if (el === null || el === undefined || el.nodeType !== 1) return false
  return selector
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .some((part) => matchOne(el, part))
}

function menuRow({ name, alias = '', desc, role = 'option' }) {
  const row = node('button', { role })
  row.appendChild(node('span', { class: 'pc3rQa_itemIcon' }))
  const nameEl = row.appendChild(node('span', { class: 'pc3rQa_itemName' }))
  nameEl.textContent = name
  if (alias.length > 0) {
    const aliasEl = row.appendChild(node('span', { class: 'pc3rQa_itemAlias' }))
    aliasEl.textContent = alias
  }
  const descEl = row.appendChild(node('span', { class: 'pc3rQa_itemDescription' }))
  descEl.textContent = desc
  return row
}

const observers = []
class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback
    this.active = false
  }
  observe() {
    this.active = true
    observers.push(this)
  }
  disconnect() {
    this.active = false
  }
}
function emit(addedNodes) {
  for (const observer of observers) {
    if (observer.active) observer.callback([{ addedNodes }])
  }
}

const sandboxState = {
  entries: DICT,
  align: 'left',
}

function buildDocument(rows) {
  const documentElement = node('html')
  const head = documentElement.appendChild(node('head'))
  const body = documentElement.appendChild(node('body'))
  for (const row of rows) body.appendChild(row)
  const doc = {
    documentElement,
    head,
    body,
    createElement: (tag) => node(tag),
    querySelectorAll: (selector) => documentElement.querySelectorAll(selector),
    querySelector: (selector) => documentElement.querySelector(selector),
  }
  return { doc, body }
}

async function runClient({ rows, state = sandboxState, failState = false }) {
  observers.length = 0
  const { doc, body } = buildDocument(rows)
  const calls = []
  const sandbox = {
    document: doc,
    MutationObserver: FakeMutationObserver,
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout,
    fetch: async (url) => {
      calls.push(String(url))
      if (String(url).startsWith(ROUTE)) {
        if (failState) return { ok: false, status: 500, json: async () => ({}) }
        return { ok: true, status: 200, json: async () => state }
      }
      return { ok: true, status: 204, json: async () => ({}) }
    },
    window: {
      __ModuleLoader__: {
        load: (definition) => {
          sandbox.definition = definition
        },
      },
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(read('client.js'), sandbox)
  const definition = sandbox.definition
  const cleanups = []
  const ctx = {
    effect(fn) {
      cleanups.push(fn())
      return cleanups[cleanups.length - 1]
    },
    inject() {},
  }
  definition.factory({}).apply(ctx)
  await new Promise((resolve) => setTimeout(resolve, 30))
  return { definition, doc, body, calls, cleanup: () => cleanups.forEach((fn) => typeof fn === 'function' && fn()) }
}

const bilingual = '穴居人语气：先给答案，砍掉客套，技术事实一字不改；/caveman 开启 ｜ Terse caveman voice: answer first, fluff gone. Use for /caveman.'
const englishAcp = 'Show bili context-compression status'
const englishOffice = 'Create, edit, inspect, or convert Office documents, spreadsheets, presentations, and PDFs.'
const englishMisaka = 'Search the failure-lesson library without leaving the composer'

const first = await runClient({
  rows: [
    menuRow({ name: 'caveman', desc: bilingual }),
    menuRow({ name: 'acp', desc: englishAcp }),
    menuRow({ name: 'office', desc: englishOffice }),
    menuRow({ name: 'MisakaNet search', alias: 'misakanet', desc: englishMisaka }),
    menuRow({ name: 'mystery-tool', desc: 'Some English line nobody translated yet' }),
  ],
})

check('bundle id 与宿主包一致', first.definition.id === 'dsh-slash-menu-chinese', String(first.definition.id))
check('客户端半边不声明依赖注入', Array.isArray(first.definition.factory({}).inject) && first.definition.factory({}).inject.length === 0)

const styleTag = first.doc.head.children.find((child) => child.attrs['data-plugin'] === 'dsh-slash-menu-chinese')
check('注入了一条 <style data-plugin>', styleTag !== undefined)
check('CSS 把描述拉到左边缘', styleTag !== undefined && styleTag.textContent.includes('text-align:left') && styleTag.textContent.includes("html[data-slash-menu-zh='left']"), styleTag?.textContent?.slice(0, 60))
check('读过 Host 路由', first.calls.some((url) => url.startsWith(ROUTE)), first.calls.join(' '))
check('把 align 打到 <html> 上', first.doc.documentElement.attrs['data-slash-menu-zh'] === 'left', String(first.doc.documentElement.attrs['data-slash-menu-zh']))

const [cavemanDesc, acpDesc, officeDesc, misakaDesc, mysteryDesc] = first.doc.body
  .querySelectorAll("[class*='itemDescription']")
  .map((el) => el.textContent)
check('双语行只留中文那一半', cavemanDesc === '穴居人语气：先给答案，砍掉客套，技术事实一字不改；/caveman 开启', cavemanDesc)
check('英文行换成词典里那句', acpDesc === DICT.acp, acpDesc)
check('核心技能也换成中文', officeDesc === DICT.office, officeDesc)
check('靠别名认行（MisakaNet search → misakanet）', misakaDesc === DICT.misakanet, misakaDesc)
check('认不出的英文行原样留着', mysteryDesc === 'Some English line nobody translated yet', mysteryDesc)

const pingUrl = first.calls.find((url) => url.startsWith('/plugin-slash-menu-zh/ping'))
const pingParams = new URLSearchParams(String(pingUrl).slice(String(pingUrl).indexOf('?') + 1))
check('漏翻的行被汇报上去（unknown）', pingParams.get('unknown') === 'mystery-tool', String(pingParams.get('unknown')))
check('汇报里带行数与改写数', pingParams.get('rows') === '5' && pingParams.get('rewritten') === '4', `${pingParams.get('rows')}/${pingParams.get('rewritten')}`)

const late = menuRow({ name: 'answer-me-with-html', desc: 'Turns an answer into a one-page visual HTML explainer.' })
first.body.appendChild(late)
emit([late])
await new Promise((resolve) => setTimeout(resolve, 60))
check('后出现的行也会被补上（MutationObserver）', late.querySelector("[class*='itemDescription']").textContent === DICT['answer-me-with-html'], late.querySelector("[class*='itemDescription']").textContent)

first.cleanup()
await new Promise((resolve) => setTimeout(resolve, 10))
check('清理时摘掉 <style> 和 <html> 属性', first.doc.head.children.every((child) => child.attrs['data-plugin'] !== 'dsh-slash-menu-chinese') && first.doc.documentElement.attrs['data-slash-menu-zh'] === undefined)

const keepRun = await runClient({ rows: [menuRow({ name: 'acp', desc: englishAcp })], state: { entries: DICT, align: 'keep' } })
check('align=keep 时不动对齐、只换中文', keepRun.doc.documentElement.attrs['data-slash-menu-zh'] === undefined && keepRun.doc.body.querySelectorAll("[class*='itemDescription']")[0].textContent === DICT.acp)
keepRun.cleanup()

// Layout must not depend on the Host half answering: if the state route fails, the
// user still gets the left-aligned column (this was a real regression report).
const brokenRun = await runClient({ rows: [menuRow({ name: 'acp', desc: englishAcp })], failState: true })
check('Host 路由失败时仍然左对齐', brokenRun.doc.documentElement.attrs['data-slash-menu-zh'] === 'left', String(brokenRun.doc.documentElement.attrs['data-slash-menu-zh']))
check('注入的 <style> 还在', brokenRun.doc.head.children.some((child) => child.attrs['data-plugin'] === 'dsh-slash-menu-chinese'))
check('Host 路由失败后把失败报上去', brokenRun.calls.some((url) => url.startsWith('/plugin-slash-menu-zh/ping') && String(url).includes('fetch-status')), brokenRun.calls.join(' '))
brokenRun.cleanup()

// ---------------------------------------------------------------------------
console.log(failures === 0 ? '\n全部通过' : `\n${failures} 条失败`)
process.exit(failures === 0 ? 0 : 1)
