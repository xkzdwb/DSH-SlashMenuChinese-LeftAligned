// slash-menu-zh — Client half: give the "/" menu one language and one left edge.
//
// Two things wrong with the shipped palette, both visible in the same list:
//
//   1. Mixed languages. The row description is whatever the registering package put
//      in `description`; third-party commands (`/acp`, `/acp-cache`), skills
//      (`/answer-me-with-html`), composer sources (`MisakaNet search`) and the core
//      skills inside app.asar (office*, cordis-*) are English, and a package that was
//      localised by hand by gluing two strings ends up as "中文 ｜ English" — one line
//      never fits both.
//   2. Two alignments in one list. The description span is `text-align: right`, so a
//      short description hugs the right edge (looks right-aligned) while a long one
//      fills the row and is clipped with an ellipsis (looks left-aligned). Same list,
//      two visual rhythms.
//
// The rows are host-rendered (`button[role=option]` → `span[class*=itemName]`,
// `span[class*=itemAlias]`, `span[class*=itemDescription]`, with the class names
// hashed per build), and the slot catalog exposes no extension point for the
// palette. So: one <style> tag fixes the alignment, and a MutationObserver rewrites
// the description text of the rows the Host half knows a Chinese line for — never
// the row itself, and never a description that is already Chinese.
//
// Rewriting text in someone else's DOM is the last resort; it is used here because
// the alternative — patching those packages' files — is undone by their next update.
//
// Rows that stay English are collected and reported to the Host half (`unknown`), so
// a gap shows up in `GET /plugin-slash-menu-zh/state` instead of waiting for a
// screenshot.

window.__ModuleLoader__.load({
  id: 'dsh-slash-menu-chinese',
  factory() {
    const ROUTE = '/plugin-slash-menu-zh/state'
    const PING = '/plugin-slash-menu-zh/ping'
    /** What DSH joins the two languages with: "中文 ｜ English". */
    const SEP = '｜'
    const DESC_SEL = "[class*='itemDescription']"
    const NAME_SEL = "[class*='itemName']"
    const ALIAS_SEL = "[class*='itemAlias']"
    const ALIGN_ATTR = 'data-slash-menu-zh'
    const TAG = 'dsh-slash-menu-chinese'
    const DEBOUNCE_MS = 24
    /** How many still-English rows to report; enough to fix the dictionary, cheap to send. */
    const UNKNOWN_LIMIT = 12

    // No devtools are reachable in the desktop shell, so this half reports what it
    // did (or threw) to the Host half, which echoes the last report on ROUTE.
    const report = (fields) => {
      try {
        const params = new URLSearchParams()
        for (const [key, value] of Object.entries(fields)) {
          if (value !== undefined && value !== null) params.set(key, String(value).slice(0, 280))
        }
        fetch(`${PING}?${params}`, { credentials: 'same-origin', cache: 'no-store' }).catch(() => {})
      } catch {
        /* Reporting is diagnostics; it must never break the menu. */
      }
    }

    // `data-slash-menu-zh` carries the alignment choice. It is set eagerly (default
    // `left`) instead of waiting for the Host half: layout is the fix users feel first,
    // and it must not disappear just because the state route failed to answer. If the
    // config says `keep`, the attribute is removed once that answer arrives.
    const CSS = `
html[${ALIGN_ATTR}='left'] ${DESC_SEL}{
  text-align:left !important;
  margin-left:10px !important;
  margin-right:auto !important;
}
`

    const isHan = (text) => /[\u3400-\u9fff]/.test(text)

    /** "中文 ｜ English" → "中文"; anything else → "". */
    const chineseHalf = (text) => {
      const cut = text.indexOf(SEP)
      if (cut <= 0) return ''
      const head = text.slice(0, cut).trim()
      return isHan(head) ? head : ''
    }

    /**
     * Lookup keys for a row, cheapest first: the bare name, the alias, and the first
     * word of the name ("MisakaNet search" is registered as `misakanet`). Everything
     * is lowercased and stripped of "/" and inner spaces so a package that reflows
     * its label still matches.
     */
    const keysOf = (row) => {
      const out = []
      for (const selector of [NAME_SEL, ALIAS_SEL]) {
        const el = row.querySelector(selector)
        const raw = String(el?.textContent ?? '').trim()
        if (raw.length === 0) continue
        const bare = raw
          .replace(/^\/+/, '')
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .trim()
        out.push(bare, bare.replace(/ /g, ''))
        const first = bare.split(' ')[0]
        if (first.length > 0 && first !== bare) out.push(first)
      }
      return out
    }

    /**
     * Rewrite one description in place. Returns true when the text changed.
     * Idempotent: a row that is already right is left alone, so the observer can run
     * on every keystroke without fighting React.
     */
    const patchOne = (desc, dict, unknown) => {
      const current = String(desc.textContent ?? '')
      if (current.length === 0) return false

      const half = chineseHalf(current)
      if (half.length > 0) {
        if (half !== current) {
          desc.textContent = half
          return true
        }
        return false
      }
      const row = desc.closest("button,[role='option'],[role='menuitem']") ?? desc.parentElement
      if (row === null) return false
      const keys = keysOf(row)
      const key = keys.find((candidate) => typeof dict[candidate] === 'string' && dict[candidate].length > 0)
      if (key !== undefined) {
        desc.textContent = dict[key]
        return true
      }
      // Chinese already (nothing to do) or a language we have no line for: only the
      // latter is a gap worth reporting.
      if (!isHan(current) && unknown.length < UNKNOWN_LIMIT) {
        const label = keys[0] ?? ''
        if (label.length > 0) unknown.push(label)
      }
      return false
    }

    /** Patch every description currently in the document. */
    const patchAll = (dict) => {
      const rows = document.querySelectorAll(DESC_SEL)
      const unknown = []
      let rewritten = 0
      for (const desc of rows) {
        if (patchOne(desc, dict, unknown)) rewritten += 1
      }
      return { rows: rows.length, rewritten, unknown: unknown.join(',') }
    }

    return {
      inject: [],
      apply(ctx) {
        const doc = document

        ctx.effect(() => {
          let dict = {}
          let align = 'left'
          let timer = 0
          let disposed = false
          let lastReport = ''

          const styleTag = doc.createElement('style')
          styleTag.setAttribute('data-plugin', TAG)
          styleTag.textContent = CSS
          doc.head?.appendChild(styleTag)

          const run = (note) => {
            if (disposed) return
            const result = patchAll(dict)
            const stamp = `${result.rows}/${result.rewritten}/${result.unknown}`
            if (stamp === lastReport) return
            lastReport = stamp
            report({
              note,
              aligned: align,
              rows: result.rows,
              rewritten: result.rewritten,
              unknown: result.unknown,
            })
          }

          const schedule = (note) => {
            if (disposed) return
            clearTimeout(timer)
            timer = setTimeout(() => run(note), DEBOUNCE_MS)
          }

          // Rows exist only while the palette is open, and React rebuilds them on
          // every keystroke; the observer therefore patches whatever appears next.
          const observer = new MutationObserver((records) => {
            for (const record of records) {
              for (const node of record.addedNodes) {
                if (node.nodeType !== 1) continue
                if (node.matches?.(DESC_SEL) || node.querySelector?.(DESC_SEL)) {
                  schedule('patched')
                  return
                }
              }
            }
          })

          const start = () => {
            if (disposed) return
            if (align === 'left') doc.documentElement?.setAttribute(ALIGN_ATTR, 'left')
            try {
              observer.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true })
            } catch {
              /* body not ready; the fetch below still patches once */
            }
            schedule('opened')
          }

          const load = async () => {
            try {
              const response = await fetch(ROUTE, { credentials: 'same-origin', cache: 'no-store' })
              if (!response.ok) {
                report({ note: 'fetch-status', error: `HTTP ${response.status}` })
                return
              }
              const state = await response.json()
              if (disposed) return
              const entries = state?.entries
              if (entries !== null && typeof entries === 'object' && !Array.isArray(entries)) {
                dict = entries
              }
              align = state?.align === 'keep' ? 'keep' : 'left'
              if (align === 'left') {
                doc.documentElement?.setAttribute(ALIGN_ATTR, 'left')
              } else {
                doc.documentElement?.removeAttribute(ALIGN_ATTR)
              }
              schedule('loaded')
            } catch (error) {
              report({ note: 'fetch-failed', error: String(error?.message ?? error) })
            }
          }

          start()
          load()

          return () => {
            disposed = true
            clearTimeout(timer)
            try {
              observer.disconnect()
            } catch {
              /* already gone */
            }
            styleTag.remove()
            doc.documentElement?.removeAttribute(ALIGN_ATTR)
          }
        }, 'slash-menu-zh: palette')
      },
    }
  },
})
