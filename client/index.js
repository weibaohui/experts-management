/**
 * dsh-plugin-experts-management - Browser half.
 *
 * One React app for every surface (sidebar overlay + settings section):
 * expert management page (installed / market views + detail modal + market
 * sync settings). Plus the composer integration:
 * - an `expert` input-trigger source on `/` (candidates from the plugin's own
 *   HTTP API; pick inserts the literal `/expert-<name> ` token whose send the
 *   host's user-explicit gesture boundary turns into the expert prompt), and
 * - a `＋专家` button in the composer tool row (`conversation.input.left`)
 *   that opens exactly that source via the per-session `toggleSource`.
 *
 * All interactive controls are host primitives
 * (@deepseek-ai/dsh-client-ui-primitives); all colors come from the ui-theme
 * `--dsw-*` token layers so light/dark follows the shell; all copy comes from
 * the locale registry (`zh`/`en`).
 */

// React is a loader platform module. Under plain Node (contract tests) a
// minimal createElement/hook shim keeps the source loadable for assertions.
let __React = null
try { __React = require('react') } catch {}
if (!__React || typeof __React.createElement !== 'function') {
  __React = {
    createElement(type, props, ...kids) {
      return { type, props: props || {}, kids: kids.flat(9).filter(k => k !== null && k !== undefined && k !== false && k !== true) }
    },
    useState(init) { const v = [typeof init === 'function' ? init() : init]; return [v[0], x => { v[0] = typeof x === 'function' ? x(v[0]) : x }] },
    useEffect() {}, useMemo(fn) { return fn() }, useRef(v = null) { return { current: v } },
  }
}
const { createElement: h, useState, useEffect, useMemo, useRef } = __React

// Platform module — always present in the loader's seeded require table.
// Under plain Node (tests) a shim keeps the tree structurally testable.
let P = null
try { P = require('@deepseek-ai/dsh-client-ui-primitives') } catch {}
let RDP = null
try { RDP = require('react-dom') } catch {}

const CLIENT_NAME = '@weibaohui/experts-management'
const API = '/experts-management/api'

/** Idempotent stylesheet injection. */
function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById('exp-styles')) return
  const holder = document.createElement('div')
  holder.id = 'exp-styles'
  holder.style.display = 'none'
  holder.innerHTML = STYLE
  document.head.appendChild(holder)
}

const prim = (name) => P && P[name]
  ? P[name]
  : function Shim(props) {
      const { children, ...rest } = props
      return h('button', { ...rest, 'data-p-shim': name }, children)
    }

// ── Locale ───────────────────────────────────────────────────────────────

const NS = 'expertsManagement'

const ZH = {
  title: '专家市场',
  close: '关闭',
  tabInstalled: '已安装',
  tabMarket: '市场',
  searchPlaceholder: '搜索专家名称、职业、描述…',
  installedEmpty: '用户库还没有专家。去「市场」页浏览并安装。',
  marketEmpty: '市场为空。请在设置中同步市场仓库。',
  expertTypeAgent: '专家',
  expertTypeTeam: '团队',
  sourceLabel: '来源',
  installedTag: '已安装',
  detail: '详情',
  install: '安装',
  installing: '安装中…',
  installedDone: '已安装到用户库',
  overwrite: '覆盖安装',
  remove: '删除',
  removing: '删除中…',
  removedDone: '已从用户库删除',
  deleteConfirm: '确定从用户库删除该专家？',
  members: '团队成员',
  lead: '负责人',
  member: '成员',
  agents: '角色定义（Agent MD）',
  skills: '关联技能',
  quickPrompts: '快捷指令',
  initPrompt: '默认开场',
  viewAgentMd: '查看角色定义全文',
  hideAgentMd: '收起',
  pluginJson: 'plugin.json',
  dirLabel: '目录',
  filesLabel: '文件',
  versionLabel: '版本',
  sourceReadonly: '只读来源（可在 NTD 中管理，或安装到用户库）',
  marketSettings: '市场设置',
  syncNow: '立即同步',
  syncing: '同步中，可能需要一分钟…',
  syncDoneUpdated: '同步完成，市场已更新',
  syncDoneLatest: '已是最新版本',
  firstCloneDone: '首次克隆完成',
  repoUrlLabel: '仓库地址',
  branchLabel: '分支',
  repoDirLabel: '本地目录（稀疏检出 experts 子树）',
  tokenLabel: '访问令牌（私有仓库需要）',
  tokenConfigured: '已配置',
  clearToken: '清除',
  lastSyncLabel: '上次同步',
  localCommitLabel: '本地版本',
  remoteCommitLabel: '远程版本',
  needsUpdateTag: '有更新',
  autoSyncLabel: '每天自动同步',
  syncOnStartupLabel: '启动时同步',
  save: '保存',
  saved: '设置已保存',
  gitMissing: '未检测到 git',
  never: '从未',
  loadFailed: '加载失败',
  noDescription: '暂无描述',
  avatarLoadFailed: '头像加载失败',
  menuGroup: '专家',
  pickExpert: '＋专家',
  pickExpertTitle: '选择一位专家，以该专家的身份执行本条任务',
}

const EN = {
  title: 'Expert Market',
  close: 'Close',
  tabInstalled: 'Installed',
  tabMarket: 'Market',
  searchPlaceholder: 'Search experts by name, profession, description…',
  installedEmpty: 'No experts in the user library yet. Browse the Market tab and install one.',
  marketEmpty: 'Market is empty. Sync the market repo in settings.',
  expertTypeAgent: 'Expert',
  expertTypeTeam: 'Team',
  sourceLabel: 'Source',
  installedTag: 'Installed',
  detail: 'Details',
  install: 'Install',
  installing: 'Installing…',
  installedDone: 'Installed to the user library',
  overwrite: 'Overwrite install',
  remove: 'Delete',
  removing: 'Deleting…',
  removedDone: 'Removed from the user library',
  deleteConfirm: 'Delete this expert from the user library?',
  members: 'Team members',
  lead: 'Lead',
  member: 'Member',
  agents: 'Role definitions (Agent MD)',
  skills: 'Skills',
  quickPrompts: 'Quick prompts',
  initPrompt: 'Default opener',
  viewAgentMd: 'View full role definition',
  hideAgentMd: 'Collapse',
  pluginJson: 'plugin.json',
  dirLabel: 'Directory',
  filesLabel: 'Files',
  versionLabel: 'Version',
  sourceReadonly: 'Read-only source (manage in NTD, or install into the user library)',
  marketSettings: 'Market settings',
  syncNow: 'Sync now',
  syncing: 'Syncing, may take a minute…',
  syncDoneUpdated: 'Sync complete, market updated',
  syncDoneLatest: 'Already up to date',
  firstCloneDone: 'First clone done',
  repoUrlLabel: 'Repository URL',
  branchLabel: 'Branch',
  repoDirLabel: 'Local directory (sparse checkouts the experts subtree)',
  tokenLabel: 'Access token (required for private repos)',
  tokenConfigured: 'Configured',
  clearToken: 'Clear',
  lastSyncLabel: 'Last sync',
  localCommitLabel: 'Local commit',
  remoteCommitLabel: 'Remote commit',
  needsUpdateTag: 'Update available',
  autoSyncLabel: 'Auto sync daily',
  syncOnStartupLabel: 'Sync on startup',
  save: 'Save',
  saved: 'Settings saved',
  gitMissing: 'git not found',
  never: 'Never',
  loadFailed: 'Load failed',
  noDescription: 'No description',
  avatarLoadFailed: 'Avatar failed to load',
  menuGroup: 'Experts',
  pickExpert: '+ Expert',
  pickExpertTitle: 'Pick an expert to handle this message in their persona',
}

// ── Styles ───────────────────────────────────────────────────────────────

const STYLE = `
.exp-page{position:relative;display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:var(--dsw-font-sm-14,14px)}
.exp-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.exp-tabs{display:flex;gap:4px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:3px}
.exp-tab{border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:5px 14px;border-radius:8px;cursor:pointer;font:inherit}
.exp-tab[data-on="true"]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
.exp-search{flex:1;min-width:180px;max-width:420px}
.exp-count{color:var(--dsw-alias-label-tertiary);font-size:12px}
.exp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.exp-card{display:flex;flex-direction:column;gap:10px;padding:14px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;cursor:pointer;transition:border-color .15s}
.exp-card:hover{border-color:var(--dsw-alias-border-l3)}
.exp-card-head{display:flex;gap:10px;align-items:center}
.exp-avatar{width:44px;height:44px;border-radius:12px;object-fit:cover;background:var(--dsw-alias-bg-layer-2)}
.exp-avatar-fallback{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;background:var(--dsw-alias-bg-layer-2)}
.exp-name{font-weight:600;font-size:14px;line-height:1.3}
.exp-profession{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:2px}
.exp-desc{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.exp-tags{display:flex;gap:4px;flex-wrap:wrap}
.exp-tag{font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:6px;padding:2px 7px}
.exp-badges{display:flex;gap:6px;align-items:center;margin-left:auto}
.exp-badge{font-size:11px;border-radius:6px;padding:2px 7px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.exp-badge[data-kind="type"]{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.exp-badge[data-kind="installed"]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.exp-card-actions{display:flex;gap:8px;justify-content:flex-end}
.exp-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 12px;cursor:pointer;font:inherit;font-size:13px}
.exp-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.exp-btn[data-primary="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted)}
.exp-btn[data-danger="true"]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.exp-btn:disabled{opacity:.5;cursor:default}
.exp-empty{color:var(--dsw-alias-label-tertiary);padding:36px 0;text-align:center}
.exp-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:60}
.exp-modal{width:min(860px,92vw);max-height:86vh;overflow:auto;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:14px}
.exp-modal-head{display:flex;gap:14px;align-items:center}
.exp-modal-close{margin-left:auto}
.exp-section{display:flex;flex-direction:column;gap:6px}
.exp-section-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.04em}
.exp-kv{display:flex;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.exp-kv b{color:var(--dsw-alias-label-primary);font-weight:500}
.exp-pre{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px;font-size:12px;line-height:1.55;overflow:auto;max-height:320px;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary)}
.exp-member-grid{display:flex;gap:10px;flex-wrap:wrap}
.exp-member{display:flex;gap:8px;align-items:center;background:var(--dsw-alias-bg-layer-2);border-radius:10px;padding:8px 12px}
.exp-member-avatar{width:32px;height:32px;border-radius:8px;object-fit:cover;background:var(--dsw-alias-bg-layer-3)}
.exp-skill-row{display:flex;flex-direction:column;gap:2px;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.exp-skill-row:last-child{border-bottom:0}
.exp-settings{display:flex;flex-direction:column;gap:10px;padding:14px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:14px}
.exp-form-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.exp-form-row label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary);flex:1;min-width:160px}
.exp-input{background:var(--dsw-alias-specific-input-major);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;width:100%}
.exp-status-line{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary)}
.exp-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary);border-radius:10px;padding:8px 18px;font-size:13px;z-index:80;box-shadow:0 8px 24px rgba(0,0,0,.25)}
.exp-checkline{display:flex;gap:6px;align-items:center;font-size:13px;color:var(--dsw-alias-label-secondary)}
.exp-checkline input{accent-color:var(--dsw-alias-brand-primary)}
.exp-chip{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.exp-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
`

// ── Helpers ──────────────────────────────────────────────────────────────

async function fetchJson(url, options) {
  const res = await fetch(url, options)
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(payload && payload.error ? payload.error : `HTTP ${res.status}`)
  return payload
}

function formatSize(bytes) {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(iso) {
  if (typeof iso !== 'string' || iso === '') return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

function avatarUrl(name, source, member) {
  const q = new URLSearchParams({ name, source: source || '' })
  if (member) q.set('member', member)
  return `${API}/avatar?${q.toString()}`
}

function matchExpert(e, lower) {
  if (lower === '') return true
  const hay = [e.name, e.displayName, e.profession, e.description, ...(e.tags || [])].join(' ').toLowerCase()
  return hay.includes(lower)
}

// ── Composer integration: `expert` trigger source + ＋专家 button ─────────

/** Menu group title (slash.menu dictionaries key titles by source name). */
const EXPERT_SOURCE_NAME = 'expert'

/** Roster cache: candidates for the trigger menu + the chip-decoration lexicon. */
let expertRoster = null
let expertRosterAt = 0
const rosterListeners = new Set()
const ROSTER_TTL = 60_000

async function fetchRoster(force) {
  if (!force && expertRoster !== null && Date.now() - expertRosterAt < ROSTER_TTL) return expertRoster
  try {
    const data = await fetchJson(API)
    const installed = Array.isArray(data.installed) ? data.installed : []
    const market = (Array.isArray(data.market) ? data.market : []).filter((e) => !e.installed)
    expertRoster = [...installed, ...market].map((e) => ({
      name: `expert-${e.name}`,
      description: e.description || e.profession || '',
      icon: e.expertType === 'team' ? '👥' : '🧑‍💼',
    }))
    expertRosterAt = Date.now()
    for (const listener of [...rosterListeners]) { try { listener() } catch {} }
  } catch { /* 菜单失败静默：候选组保持 pending/缺席 */ }
  return expertRoster
}

/** InputTriggerSource（ui-skill 同构）：pick 落 `/expert-<name> ` 字面量，宿主手势边界注入角色。
 *  候选声明 section 取代源标题行——slash.menu 命名空间已被宿主注册，无法叠加本地化。 */
function makeExpertSource(t) {
  const tt = t || ((key) => EN[key] ?? key)
  return {
    trigger: '/',
    name: EXPERT_SOURCE_NAME,
    order: 300,
    async candidates(session, { query, signal }) {
      const rows = (await fetchRoster()) || []
      if (signal && signal.aborted) return []
      return rows.filter((r) => r.name.startsWith(String(query || ''))).slice(0, 80)
        .map((r) => ({ ...r, section: tt('menuGroup') }))
    },
    warm() { void fetchRoster() },
    lexicon() {
      return expertRoster !== null ? expertRoster.map((r) => r.name) : undefined
    },
    subscribeLexicon(session, listener) {
      rosterListeners.add(listener)
      return () => { rosterListeners.delete(listener) }
    },
    onPick({ candidate }) {
      return { text: `/${candidate.name} ` }
    },
  }
}

/**
 * Open one registered '/' source over a synthetic span appended at the draft
 * end (host toggleCommandMenu 同款调用形状）。The standard kit exposes no
 * caret, so the pick replaces a collapsed span at draft end — picks die
 * quietly on span-CAS if the draft moved since the click.
 */
function openTriggerSource(composerScope, sessionId, input, sourceName) {
  const inputTriggers = composerScope && composerScope.inputTriggers
  const sessions = composerScope && composerScope.sessions
  if (!inputTriggers || !sessions) return false
  let actx
  try { actx = sessions.scope(sessionId) } catch { return false }
  if (actx === undefined || actx === null) return false
  let controller
  try { controller = inputTriggers.sessionOf(actx) } catch { return false }
  const draft = (input && input.draft) || ''
  const at = draft.length
  controller.toggleSource(sourceName, {
    trigger: '/',
    query: '',
    quoted: false,
    position: draft.trim() === '' ? 'leading' : 'inline',
    span: { start: at, end: at, draftRev: (input && input.draftRev) || 0 },
  })
  return true
}

// ── Small components ─────────────────────────────────────────────────────

function Avatar({ expert, size }) {
  const [failed, setFailed] = useState(false)
  const box = size ?? 44
  if (failed || !expert.hasAvatar) {
    return h('div', { className: 'exp-avatar-fallback', style: { width: box, height: box } },
      expert.expertType === 'team' ? '👥' : '🧑‍💼')
  }
  return h('img', {
    className: 'exp-avatar',
    src: avatarUrl(expert.name, expert.source),
    style: { width: box, height: box },
    onError: () => setFailed(true),
    alt: expert.displayName || expert.name,
  })
}

function Badge({ kind, children }) {
  return h('span', { className: 'exp-badge', 'data-kind': kind }, children)
}

function ExpertCard({ row, t, onOpen, onInstall, onDelete, busy }) {
  const installedHere = row.source === 'dsh'
  return h('div', { className: 'exp-card', onClick: () => onOpen(row) },
    h('div', { className: 'exp-card-head' },
      h(Avatar, { expert: row }),
      h('div', { style: { minWidth: 0 } },
        h('div', { className: 'exp-name' }, row.displayName || row.name),
        h('div', { className: 'exp-profession' }, row.profession || '')),
      h('div', { className: 'exp-badges' },
        Badge({ kind: 'type', children: row.expertType === 'team' ? t('expertTypeTeam') : t('expertTypeAgent') }),
        row.installed ? Badge({ kind: 'installed', children: t('installedTag') }) : null)),
    h('div', { className: 'exp-desc' }, row.description || t('noDescription')),
    (row.tags || []).length > 0
      ? h('div', { className: 'exp-tags' }, row.tags.slice(0, 4).map((tag, i) => h('span', { className: 'exp-tag', key: i }, tag)))
      : null,
    h('div', { className: 'exp-card-actions', onClick: (e) => e.stopPropagation() },
      installedHere
        ? h('button', {
            className: 'exp-btn', 'data-danger': 'true', disabled: busy,
            onClick: () => { if (window.confirm(t('deleteConfirm'))) onDelete(row) },
          }, busy ? t('removing') : t('remove'))
        : h('button', {
            className: 'exp-btn', 'data-primary': 'true', disabled: busy,
            onClick: () => onInstall(row),
          }, busy ? t('installing') : t('install'))))
}

function PagedGrid({ items, render, pageSize = 120, grow = 240 }) {
  const [shown, setShown] = useState(pageSize)
  const sentinelRef = useRef(null)
  useEffect(() => { setShown(pageSize) }, [items])
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting)) setShown((n) => Math.min(n + grow, items.length))
    })
    io.observe(node)
    return () => io.disconnect()
  }, [items.length, shown < items.length])
  return h('div', { className: 'exp-grid' },
    items.slice(0, shown).map(render),
    shown < items.length ? h('div', { ref: sentinelRef, style: { gridColumn: '1 / -1', textAlign: 'center', color: 'var(--dsw-alias-label-tertiary)', padding: 8 } }, '…') : null)
}

function MemberAvatar({ expertName, source, member, t }) {
  const [failed, setFailed] = useState(false)
  return member.avatar && !failed
    ? h('img', { className: 'exp-member-avatar', src: avatarUrl(expertName, source, member.id), onError: () => setFailed(true), alt: member.nameZh || member.id })
    : h('div', { className: 'exp-member-avatar', title: t('avatarLoadFailed') }, '👤')
}

function DetailModal({ name, source, t, onClose, onInstalled, onDeleted }) {
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [agentMd, setAgentMd] = useState(null)
  useEffect(() => {
    let live = true
    fetchJson(`${API}/detail?name=${encodeURIComponent(name)}${source ? `&source=${encodeURIComponent(source)}` : ''}`)
      .then((d) => { if (live) setDetail(d) })
      .catch((e) => { if (live) setError(String(e && e.message)) })
    return () => { live = false }
  }, [name, source])
  const loadAgentMd = () => {
    fetchJson(`${API}/agent-md?name=${encodeURIComponent(name)}${source ? `&source=${encodeURIComponent(source)}` : ''}`)
      .then((r) => setAgentMd(r.content))
      .catch((e) => setAgentMd(`[${e && e.message}]`))
  }
  const install = async (overwrite) => {
    setBusy(true)
    try {
      await fetchJson(`${API}/install`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, source, overwrite }) })
      onInstalled()
    } catch (e) { setError(String(e && e.message)) }
    setBusy(false)
  }
  const remove = async () => {
    setBusy(true)
    try {
      await fetchJson(API, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      onDeleted()
    } catch (e) { setError(String(e && e.message)) }
    setBusy(false)
  }
  const kv = (label, value) => value ? h('div', { className: 'exp-kv' }, h('b', null, label), h('span', null, value)) : null
  return h('div', { className: 'exp-modal-backdrop', onClick: (e) => { if (e.target === e.currentTarget) onClose() } },
    h('div', { className: 'exp-modal' },
      h('div', { className: 'exp-modal-head' },
        detail ? h(Avatar, { expert: detail, size: 56 }) : null,
        h('div', null,
          h('div', { className: 'exp-name', style: { fontSize: 17 } }, detail ? (detail.displayNameZh || detail.name) : name),
          detail ? h('div', { className: 'exp-profession' }, detail.professionZh || detail.professionEn || '') : null),
        h('button', { className: 'exp-btn exp-modal-close', onClick: onClose }, t('close'))),
      error !== '' ? h('div', { className: 'exp-empty' }, `${t('loadFailed')}: ${error}`) : null,
      detail === null && error === '' ? h('div', { className: 'exp-empty' }, '…') : null,
      detail !== null ? h('div', { style: { display: 'contents' } },
        h('div', { className: 'exp-form-row' },
          (detail.descZh || detail.descEn) ? h('div', { className: 'exp-desc', style: { WebkitLineClamp: 'unset' } }, detail.descZh || detail.descEn) : null),
        h('div', { className: 'exp-status-line' },
          kv(t('sourceLabel'), `${detail.sourceLabel} (${detail.source})`),
          kv(t('versionLabel'), detail.version),
          kv(t('filesLabel'), `${detail.fileCount} / ${formatSize(detail.totalSize)}`),
          kv(t('dirLabel'), detail.dir)),
        detail.readOnly ? h('div', { className: 'exp-kv' }, h('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, t('sourceReadonly'))) : null,
        (detail.quickPromptsZh || []).length > 0 ? h('div', { className: 'exp-section' },
          h('div', { className: 'exp-section-title' }, t('quickPrompts')),
          ...detail.quickPromptsZh.slice(0, 5).map((q, i) => h('div', { className: 'exp-kv', key: i }, '• ', q))) : null,
        (detail.members || []).length > 0 ? h('div', { className: 'exp-section' },
          h('div', { className: 'exp-section-title' }, t('members')),
          h('div', { className: 'exp-member-grid' },
            ...detail.members.map((m) => h('div', { className: 'exp-member', key: m.id },
              h(MemberAvatar, { expertName: detail.name, source: detail.source, member: m, t }),
              h('div', null,
                h('div', { style: { fontSize: 13 } }, m.nameZh || m.nameEn || m.id),
                h('div', { className: 'exp-profession' }, `${m.professionZh || m.professionEn || ''} · ${m.role === 'lead' ? t('lead') : t('member')}`)))))) : null,
        (detail.skillMeta || []).length > 0 ? h('div', { className: 'exp-section' },
          h('div', { className: 'exp-section-title' }, t('skills')),
          ...detail.skillMeta.map((s) => h('div', { className: 'exp-skill-row', key: s.skillName },
            h('div', { style: { fontSize: 13 } }, `${s.emoji ? s.emoji + ' ' : ''}${s.skillName}`),
            h('div', { className: 'exp-profession' }, s.descriptionZh || s.descriptionEn || s.description || '')))) : null,
        (detail.agentFiles || []).length > 0 ? h('div', { className: 'exp-section' },
          h('div', { className: 'exp-section-title' }, t('agents')),
          ...detail.agentFiles.map((a) => h('div', { className: 'exp-skill-row', key: a.relPath },
            h('div', { style: { fontSize: 13 } }, `${a.emoji ? a.emoji + ' ' : ''}${a.name}${a.name === detail.leadAgentFile ? ' ★' : ''}`),
            h('div', { className: 'exp-profession' }, a.description || '')))) : null,
        h('div', { className: 'exp-form-row' },
          h('button', { className: 'exp-btn', onClick: () => (agentMd === null ? loadAgentMd() : setAgentMd(null)) }, agentMd === null ? t('viewAgentMd') : t('hideAgentMd')),
          detail.source !== 'dsh'
            ? h('button', { className: 'exp-btn', 'data-primary': 'true', disabled: busy, onClick: () => install(false) }, busy ? t('installing') : t('install'))
            : h('button', { className: 'exp-btn', 'data-danger': 'true', disabled: busy, onClick: () => { if (window.confirm(t('deleteConfirm'))) remove() } }, busy ? t('removing') : t('remove')),
          detail.source !== 'dsh' && detail.installed
            ? h('button', { className: 'exp-btn', disabled: busy, onClick: () => install(true) }, t('overwrite'))
            : null),
        agentMd !== null ? h('pre', { className: 'exp-pre' }, agentMd) : null,
        detail.plugin ? h('details', null,
          h('summary', { style: { cursor: 'pointer', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, t('pluginJson')),
          h('pre', { className: 'exp-pre' }, JSON.stringify(detail.plugin, null, 2))) : null,
      ) : null))
}

function MarketSettingsCard({ t, onToast, onSynced }) {
  const [status, setStatus] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = () => fetchJson(`${API}/market/status`).then((s) => { setStatus(s); setForm((f) => f ?? { url: s.url, branch: s.branch, repoDir: s.dir, token: '', autoSync: s.autoSync, syncOnStartup: s.syncOnStartup }) })
  useEffect(() => { load() }, [])
  const sync = async () => {
    setBusy(true)
    try {
      const r = await fetchJson(`${API}/market/sync`, { method: 'POST' })
      onToast(r.isFirstClone ? t('firstCloneDone') : r.hasUpdates ? t('syncDoneUpdated') : t('syncDoneLatest'))
      await load()
      onSynced()
    } catch (e) { onToast(String(e && e.message)) }
    setBusy(false)
  }
  const save = async () => {
    setBusy(true)
    try {
      const patch = { url: form.url, branch: form.branch, autoSync: !!form.autoSync, syncOnStartup: !!form.syncOnStartup }
      const dirText = (form.repoDir || '').trim()
      if (dirText !== '' && dirText !== (status && status.dir)) patch.repoDir = dirText
      if (typeof form.token === 'string' && form.token !== '') patch.token = form.token
      if (form.token === null) patch.token = null
      await fetchJson(`${API}/market/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      setForm((f) => ({ ...f, token: '' }))
      onToast(t('saved'))
      await load()
    } catch (e) { onToast(String(e && e.message)) }
    setBusy(false)
  }
  const field = (label, value, onChange, type) => h('label', null, label,
    h('input', { className: 'exp-input', type: type || 'text', value: value ?? '', onChange: (e) => onChange(e.target.value) }))
  if (status === null) return null
  return h('div', { className: 'exp-settings' },
    h('div', { className: 'exp-status-line' },
      h('b', null, t('marketSettings')),
      h('span', null, `${t('repoDirLabel')}: ${status.dir}`),
      h('span', null, `${t('lastSyncLabel')}: ${status.lastSyncAt ? formatTime(status.lastSyncAt) : t('never')}`),
      status.localCommit ? h('span', null, `${t('localCommitLabel')}: ${String(status.localCommit).slice(0, 8)}`) : null,
      status.remoteCommit ? h('span', null, `${t('remoteCommitLabel')}: ${String(status.remoteCommit).slice(0, 8)}`, status.needsUpdate ? Badge({ kind: 'type', children: t('needsUpdateTag') }) : null) : null,
      !status.gitAvailable ? h('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, t('gitMissing')) : null,
      status.sparsePaths ? h('span', null, `sparse: ${(status.sparsePaths || []).join(', ')}`) : null),
    h('div', { className: 'exp-form-row' },
      field(t('repoUrlLabel'), form.url, (v) => setForm({ ...form, url: v })),
      field(t('branchLabel'), form.branch, (v) => setForm({ ...form, branch: v }))),
    h('div', { className: 'exp-form-row' },
      field(t('repoDirLabel'), form.repoDir, (v) => setForm({ ...form, repoDir: v })),
      field(`${t('tokenLabel')}${status.hasToken ? ` (${t('tokenConfigured')})` : ''}`, form.token ?? '', (v) => setForm({ ...form, token: v }), 'password')),
    h('div', { className: 'exp-form-row' },
      h('label', { className: 'exp-checkline' },
        h('input', { type: 'checkbox', checked: !!form.autoSync, onChange: (e) => setForm({ ...form, autoSync: e.target.checked }) }), t('autoSyncLabel')),
      h('label', { className: 'exp-checkline' },
        h('input', { type: 'checkbox', checked: !!form.syncOnStartup, onChange: (e) => setForm({ ...form, syncOnStartup: e.target.checked }) }), t('syncOnStartupLabel')),
      h('span', { style: { flex: 1 } }),
      status.hasToken ? h('button', { className: 'exp-btn', disabled: busy, onClick: () => setForm({ ...form, token: null }) }, t('clearToken')) : null,
      h('button', { className: 'exp-btn', disabled: busy || status.syncing, onClick: sync }, busy || status.syncing ? t('syncing') : t('syncNow')),
      h(prim('Button'), { onClick: save, disabled: busy }, t('save'))))
}

// ── Page ─────────────────────────────────────────────────────────────────

function ExpertsPage({ t, embedded }) {
  const [tab, setTab] = useState('market')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null) // {name, source}
  const [busyName, setBusyName] = useState(null)
  const [toast, setToast] = useState(null)
  const showToast = (text) => { setToast(text); setTimeout(() => setToast(null), 2600) }
  const reload = () => fetchJson(API).then((d) => { setData(d); setError('') }).catch((e) => setError(String(e && e.message)))
  useEffect(() => { reload() }, [])
  const rows = useMemo(() => {
    if (!data) return []
    const lower = search.trim().toLowerCase()
    const list = tab === 'installed' ? data.installed : data.market
    return list.filter((e) => matchExpert(e, lower))
  }, [data, tab, search])
  const install = async (row) => {
    setBusyName(row.name)
    try {
      await fetchJson(`${API}/install`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: row.name, source: row.source }) })
      showToast(t('installedDone'))
      await reload()
    } catch (e) {
      const msg = String(e && e.message)
      if (msg.includes('already installed')) {
        try {
          await fetchJson(`${API}/install`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: row.name, source: row.source, overwrite: true }) })
          showToast(t('installedDone'))
          await reload()
        } catch (e2) { showToast(String(e2 && e2.message)) }
      } else showToast(msg)
    }
    setBusyName(null)
  }
  const remove = async (row) => {
    setBusyName(row.name)
    try {
      await fetchJson(API, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: row.name }) })
      showToast(t('removedDone'))
      await reload()
    } catch (e) { showToast(String(e && e.message)) }
    setBusyName(null)
  }
  return h('div', { className: 'exp-page' },
    h('div', { className: 'exp-toolbar' },
      h('div', { className: 'exp-tabs' },
        h('button', { className: 'exp-tab', 'data-on': tab === 'installed', onClick: () => setTab('installed') }, `${t('tabInstalled')}${data ? ` (${data.installed.length})` : ''}`),
        h('button', { className: 'exp-tab', 'data-on': tab === 'market', onClick: () => setTab('market') }, `${t('tabMarket')}${data ? ` (${data.market.length})` : ''}`)),
      h('input', { className: 'exp-input exp-search', placeholder: t('searchPlaceholder'), value: search, onChange: (e) => setSearch(e.target.value) }),
      h('span', { className: 'exp-count' }, `${rows.length}`)),
    tab === 'market' ? h(MarketSettingsCard, { t, onToast: showToast, onSynced: reload }) : null,
    error !== '' ? h('div', { className: 'exp-empty' }, `${t('loadFailed')}: ${error}`) : null,
    data !== null && rows.length === 0 ? h('div', { className: 'exp-empty' }, tab === 'installed' ? t('installedEmpty') : t('marketEmpty')) : null,
    rows.length > 0
      ? h(PagedGrid, {
          items: rows,
          render: (row) => h(ExpertCard, { key: `${row.source}/${row.name}`, row, t, busy: busyName === row.name, onOpen: (r) => setSelected({ name: r.name, source: r.source }), onInstall: install, onDelete: remove }),
        })
      : null,
    selected !== null ? h(DetailModal, {
      name: selected.name, source: selected.source, t, onClose: () => setSelected(null),
      onInstalled: () => { setSelected(null); showToast(t('installedDone')); reload() },
      onDeleted: () => { setSelected(null); showToast(t('removedDone')); reload() },
    }) : null,
    toast !== null ? h('div', { className: 'exp-toast' }, toast) : null)
}

// ── Plugin plane contract ────────────────────────────────────────────────

module.exports = {
  name: CLIENT_NAME,
  inject: ['slots', 'locale'],
  __internals: {
    NS, ZH, EN, matchExpert, formatSize, formatTime, avatarUrl,
    EXPERT_SOURCE_NAME, makeExpertSource, openTriggerSource, fetchRoster,
  },
  /** Test/host helper: mount a standalone page into any container. */
  __boot(container, opts = {}) {
    ensureStyles()
    let t = opts.t || ((key, vars) => {
      let out = EN[key] ?? key
      if (vars) for (const [k, v] of Object.entries(vars)) out = out.split('{' + k + '}').join(String(v))
      return out
    })
    const root = require('react-dom/client').createRoot(container)
    root.render(h(ExpertsPage, { t, embedded: !!opts.embedded }))
    return root
  },
  apply(ctx) {
    let t = (key, vars) => {
      let out = EN[key] ?? key
      if (vars) for (const [k, v] of Object.entries(vars)) out = out.split('{' + k + '}').join(String(v))
      return out
    }
    try {
      if (ctx.locale && typeof ctx.locale.register === 'function') {
        ctx.locale.register(NS, 'zh', ZH)
        ctx.locale.register(NS, 'en', EN)
        // 菜单组标题按源名走 slash.menu 命名空间；注册失败仅回退显示源名 'expert'
        try {
          ctx.locale.register('slash.menu', 'zh', { [EXPERT_SOURCE_NAME]: '专家' })
          ctx.locale.register('slash.menu', 'en', { [EXPERT_SOURCE_NAME]: 'Expert' })
        } catch {}
        const bound = typeof ctx.locale.bind === 'function' ? ctx.locale.bind(NS) : null
        if (bound) {
          t = (key, vars) => {
            let out = bound(key) || key
            if (vars) for (const [k, v] of Object.entries(vars)) out = out.split('{' + k + '}').join(String(v))
            return out
          }
        }
      }
    } catch (e) { try { console.error('[experts-management] locale init:', e) } catch {} }
    // Composer 集成走动态 inject（静态列服务会拖住插件激活；ui-commands 先例）。
    // 服务缺席（未组合 ui-input-trigger）时按钮隐藏、触发源不注册，管理页不受影响。
    let composerScope = null
    try {
      if (typeof ctx.inject === 'function') {
        ctx.inject(['inputTriggers', 'sessions'], (scope) => {
          composerScope = scope
          if (scope && scope.inputTriggers && typeof scope.inputTriggers.registerSource === 'function') {
            ctx.effect(() => scope.inputTriggers.registerSource(makeExpertSource(t)), 'experts-management: expert trigger source')
          }
        })
      }
    } catch (e) { try { console.error('[experts-management] composer inject:', e) } catch {} }
    ctx.effect(() => {
      try {
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: CLIENT_NAME,
          order: 60,
          locale: NS,
          label: () => t('title'),
          inject: () => ({ t }),
        }, function FooterSlot(apiProps) {
          return h(FooterSlotComponent, { __t: t, wide: apiProps && apiProps.wide })
        }))
      } catch (e) { (globalThis.__expErrors = globalThis.__expErrors || []).push('footer:' + (e && e.message)); throw e }
    }, 'experts-management: sidebar footer action')
    ctx.effect(() => {
      try {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: CLIENT_NAME,
          order: 91,
          locale: NS,
          label: () => t('title'),
          inject: () => ({}),
        }, function SettingsSectionSlot() {
          return h(SettingsSlotComponent, { __t: t })
        }))
      } catch (e) { (globalThis.__expErrors = globalThis.__expErrors || []).push('settings:' + (e && e.message)); throw e }
    }, 'experts-management: settings section')
    ctx.effect(() => {
      try {
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: CLIENT_NAME,
          order: 62,
          locale: NS,
          label: () => t('pickExpert'),
          inject: () => ({ t }),
        }, function ExpertButtonSlot(apiProps) {
          return h(ComposerButtonSlot, {
            __t: t, icon: '🧑‍💼', label: t('pickExpert'), title: t('pickExpertTitle'),
            source: EXPERT_SOURCE_NAME, composerScopeRef: () => composerScope,
            sessionId: apiProps && apiProps.sessionId, input: apiProps && apiProps.input,
          })
        }))
      } catch (e) { (globalThis.__expErrors = globalThis.__expErrors || []).push('input.left:' + (e && e.message)); throw e }
    }, 'experts-management: input left button')
  },
}

/** Footer slot entry: the button, and — when open — the whole experts page
 *  portaled to <body> as a fullscreen overlay (same pattern as the skills
 *  market footer entry). */
function FooterSlotComponent(props) {
  const t = props.__t
  const [open, setOpen] = useState(false)
  useEffect(ensureStyles, [])
  if (!open) {
    return h('button', { className: 'exp-btn', onClick: () => setOpen(true), title: t('title') }, t('title'))
  }
  const page = h(ExpertsPage, { t, embedded: false, onClose: () => setOpen(false) })
  if (RDP && typeof RDP.createPortal === 'function') return RDP.createPortal(page, document.body)
  return page
}

/** Composer tool-row button: opens one registered '/' source over the
 *  session's trigger controller. Hidden while the inputTriggers/sessions
 *  services are absent (plugin composed without the trigger pipeline). */
function ComposerButtonSlot(props) {
  useEffect(ensureStyles, [])
  const composerScope = props.composerScopeRef ? props.composerScopeRef() : null
  const ready = !!(composerScope && composerScope.inputTriggers && composerScope.sessions && props.sessionId)
  if (!ready) return null
  return h('button', {
    className: 'exp-chip',
    title: props.title || props.label,
    onClick: () => { openTriggerSource(composerScope, props.sessionId, props.input, props.source) },
  }, `${props.icon || ''}${props.icon ? ' ' : ''}${props.label}`)
}

/** Settings section slot entry: render the page directly in the host tree. */
function SettingsSlotComponent(props) {
  useEffect(ensureStyles, [])
  return h(ExpertsPage, { t: props.__t, embedded: true })
}
