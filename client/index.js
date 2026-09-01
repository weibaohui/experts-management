/**
 * dsh-plugin-experts-management - Browser half.
 *
 * One React app for every surface (settings section; the former sidebar
 *  fullscreen-overlay entry was retired — pair with dsh-settings-ui):
 * expert management page (mine / built-in views + detail modal + built-in
 * sync settings). Plus the composer integration:
 * - an `expert` input-trigger source on `/` (candidates from the plugin's own
 *   HTTP API; pick inserts the literal `/expert-<name> ` token whose send the
 *   host's user-explicit gesture boundary turns into the expert prompt), and
 * - a `＋ 专家` button in the composer tool row (`conversation.input.left`)
 *   that opens the plugin's own searchable picker popover (the host slash menu
 *   filters only by a typed query, which a button click cannot provide); the
 *   pick is written into the draft through the same scoped
 *   `slash/input-insert-text` event the host menu uses.
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
  title: '专家管理',
  close: '关闭',
  tabMine: '我的',
  tabBuiltin: '内置',
  searchPlaceholder: '搜索专家名称、职业、描述…',
  mineEmpty: '用户库还没有专家。去「内置」页浏览并安装。',
  builtinEmpty: '内置专家为空。请在设置中同步内置仓库。',
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
  builtinSettings: '内置设置',
  syncNow: '立即同步',
  syncing: '同步中，可能需要一分钟…',
  syncDoneUpdated: '同步完成，内置已更新',
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
  pickExpert: '＋ 专家',
  pickExpertTitle: '选择一位专家，以该专家的身份执行本条任务',
  pickerLoading: '正在加载专家目录…',
  pickerEmpty: '没有匹配的专家',
  pickerTabAgents: '专家',
  pickerTabTeams: '专家团',
}

const EN = {
  title: 'Expert Management',
  close: 'Close',
  tabMine: 'Mine',
  tabBuiltin: 'Built-in',
  searchPlaceholder: 'Search experts by name, profession, description…',
  mineEmpty: 'No experts in the user library yet. Browse the Built-in tab and install one.',
  builtinEmpty: 'Built-in experts are empty. Sync the built-in repo in settings.',
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
  builtinSettings: 'Built-in settings',
  syncNow: 'Sync now',
  syncing: 'Syncing, may take a minute…',
  syncDoneUpdated: 'Sync complete, built-in updated',
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
  pickerLoading: 'Loading experts…',
  pickerEmpty: 'No matching experts',
  pickerTabAgents: 'Experts',
  pickerTabTeams: 'Teams',
}

// ── Styles ───────────────────────────────────────────────────────────────

const STYLE = `<style>
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
.exp-form-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.exp-form-row label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary);flex:1;min-width:160px}
.exp-input{background:var(--dsw-alias-specific-input-major);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;width:100%}
.exp-status-line{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary)}
.exp-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary);border-radius:10px;padding:8px 18px;font-size:13px;z-index:80;box-shadow:0 8px 24px rgba(0,0,0,.25)}
.exp-checkline{display:flex;gap:6px;align-items:center;font-size:13px;color:var(--dsw-alias-label-secondary)}
.exp-checkline input{accent-color:var(--dsw-alias-brand-primary)}
.exp-chip{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.exp-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.exp-picker-backdrop{position:fixed;inset:0;z-index:2147483200}
.exp-picker{position:fixed;z-index:2147483201;width:400px;max-width:92vw;max-height:360px;display:flex;flex-direction:column;gap:4px;padding:6px;background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;box-shadow:var(--dsw-shadow-lv3)}
.exp-picker-input{flex:none}
.exp-picker-tabs{flex:none;align-self:flex-start}
.exp-picker-list{display:flex;flex-direction:column;min-height:40px;overflow-y:auto}
.exp-picker-row{display:flex;align-items:center;gap:8px;width:100%;min-height:36px;padding:6px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;font:inherit;font-size:13px}
.exp-picker-row[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover)}
.exp-picker-icon{width:18px;flex:none;text-align:center}
.exp-picker-name{flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.exp-picker-literal{flex:none;max-width:32%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:11px}
.exp-picker-desc{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px}
.exp-picker-empty{padding:12px 10px;text-align:center;color:var(--dsw-alias-label-dimmed);font-size:13px}
.exp-overlay{position:fixed;inset:0;z-index:2147483000;background:var(--dsw-alias-bg-base);overflow:auto;padding:20px 26px}
.exp-head{display:flex;align-items:center;gap:10px;margin-bottom:4px}
.exp-title{font-weight:600;font-size:16px}
.exp-spacer{flex:1}
</style>`

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

/**
 * Roster row mapping (pure, testable). The host slash menu renders only
 * name + description per row, so the human-readable displayName is prefixed
 * into the description — expert teams (👥) and single experts both show
 * their real name next to the `expert-<id>` literal. The picker popover
 * renders `displayName` as the primary label and `plainDescription` as the
 * secondary line instead. Rows come out sorted by displayName（中文按拼音），
 * the picker splits them into 专家/专家团 tabs by `team`.
 */
function toRosterRows(mine, builtin) {
  const rows = [...(Array.isArray(mine) ? mine : []), ...(Array.isArray(builtin) ? builtin : [])].map((e) => {
    const displayName = e.displayName || e.name
    const desc = e.description || e.profession || ''
    return {
      name: `expert-${e.name}`,
      displayName,
      description: displayName && displayName !== e.name ? (desc === '' ? displayName : `${displayName} · ${desc}`) : desc,
      plainDescription: desc,
      team: e.expertType === 'team',
      icon: e.expertType === 'team' ? '👥' : '🧑‍💼',
    }
  })
  rows.sort((a, b) => String(a.displayName).localeCompare(String(b.displayName), 'zh'))
  return rows
}

/** Picker tab split (pure, testable): single experts vs expert teams. */
function splitRosterByType(rows) {
  const agents = [], teams = []
  for (const r of Array.isArray(rows) ? rows : []) (r.team ? teams : agents).push(r)
  return { agents, teams }
}

/** Picker filter predicate (pure): match the displayed fields, not the `expert-` prefix. */
function pickerRowMatch(r, lower) {
  return matchExpert({ name: r.name.replace(/^expert-/, ''), displayName: r.displayName, description: r.plainDescription }, lower)
}

async function fetchRoster(force) {
  if (!force && expertRoster !== null && Date.now() - expertRosterAt < ROSTER_TTL) return expertRoster
  try {
    const data = await fetchJson(API)
    const mine = Array.isArray(data.mine) ? data.mine : []
    const builtin = (Array.isArray(data.builtin) ? data.builtin : []).filter((e) => !e.installed)
    expertRoster = toRosterRows(mine, builtin)
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
 *
 * NOTE: the ＋ 专家 button no longer uses this — the host menu cannot offer
 * a search box, so the button opens ExpertPicker instead. Kept for the
 * contract tests and as the documented toggleSource path.
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

/**
 * Insert `text` at the end of the session draft through the same scoped
 * event the host slash menu executes (`slash/input-insert-text`). The span
 * CAS uses the freshest input snapshot handed to the slot props — while the
 * picker popover is open the composer draft cannot move (focus is in the
 * picker), so the splice applies; a stale snapshot quietly no-ops, same as
 * the host menu's span-CAS.
 */
function insertComposerText(scope, sessionId, input, text) {
  const sessions = scope && scope.sessions
  if (!sessions) return false
  let actx
  try { actx = sessions.scope(sessionId) } catch { return false }
  if (actx === undefined || actx === null || typeof actx.bail !== 'function') return false
  const draft = (input && input.draft) || ''
  const at = draft.length
  try {
    return actx.bail(actx, 'slash/input-insert-text', {
      text,
      span: { start: at, end: at, draftRev: (input && input.draftRev) || 0 },
    }) === true
  } catch { return false }
}

/** Best-effort refocus of the composer textarea after the picker closes. */
function refocusComposer() {
  try {
    const card = document.querySelector('[data-composer-card]')
    const ta = card && card.querySelector('textarea')
    if (ta && typeof ta.focus === 'function') ta.focus()
  } catch {}
}

/** Picker popover list cap — beyond this the search input is the filter. */
const PICKER_ROW_CAP = 200

/**
 * ＋ 专家 picker：锚定在按钮上方、自带搜索框的候选浮层（portal 到 body）。
 * 宿主斜杠菜单靠「输入的 query」过滤，按钮打开的菜单没有输入载体——候选
 * 太多时无从筛选，所以浮层自带搜索框。专家/专家团分两个 tab（tab 标签上的
 * 计数跟随当前搜索过滤），各 tab 内按显示名排序（toRosterRows 已排好）。
 * 键盘 ↑/↓/Enter/Esc，鼠标 hover+点击；tab 按钮 mousedown 不抢输入框焦点。
 */
function ExpertPicker(props) {
  const t = props.t
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('agent') // 'agent' | 'team'
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  useEffect(() => { try { if (inputRef.current) inputRef.current.focus() } catch {} }, [])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !(e.isComposing === true)) props.onClose() }
    try { document.addEventListener('keydown', onKey) } catch {}
    return () => { try { document.removeEventListener('keydown', onKey) } catch {} }
  }, [])
  const lower = query.trim().toLowerCase()
  const { agents, teams } = splitRosterByType(props.rows)
  const filteredAgents = lower === '' ? agents : agents.filter((r) => pickerRowMatch(r, lower))
  const filteredTeams = lower === '' ? teams : teams.filter((r) => pickerRowMatch(r, lower))
  const shown = (tab === 'team' ? filteredTeams : filteredAgents).slice(0, PICKER_ROW_CAP)
  useEffect(() => { setActive(0) }, [lower, tab, props.rows])
  useEffect(() => {
    const list = listRef.current
    const el = list && list.children[active]
    if (el && typeof el.scrollIntoView === 'function') { try { el.scrollIntoView({ block: 'nearest' }) } catch {} }
  }, [active])
  const onKeyDown = (e) => {
    // IME 组词中的按键不触发选择（回车是选定拼音候选，不是 pick）
    if (e.nativeEvent && e.nativeEvent.isComposing === true) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, shown.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const row = shown[active]; if (row) props.onPick(row) }
  }
  const width = 400
  const winW = typeof window !== 'undefined' ? window.innerWidth : 800
  const winH = typeof window !== 'undefined' ? window.innerHeight : 600
  const left = Math.max(8, Math.min(props.anchor.left, winW - width - 8))
  const bottom = Math.max(8, winH - props.anchor.top + 6)
  const tabBtn = (key, labelKey, count) => h('button', {
    type: 'button', role: 'tab', className: 'exp-tab', 'data-on': tab === key, 'aria-selected': tab === key,
    onMouseDown: (e) => { e.preventDefault(); setTab(key) }, onClick: () => setTab(key),
  }, `${t(labelKey)} (${count})`)
  return h('div', { className: 'exp-picker-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) props.onClose() } },
    h('div', { className: 'exp-picker', style: { left, bottom, width }, role: 'dialog', 'aria-label': t('pickExpertTitle') },
      h('input', {
        ref: inputRef, className: 'exp-input exp-picker-input', value: query,
        placeholder: t('searchPlaceholder'), onChange: (e) => setQuery(e.target.value), onKeyDown,
      }),
      h('div', { className: 'exp-tabs exp-picker-tabs', role: 'tablist' },
        tabBtn('agent', 'pickerTabAgents', filteredAgents.length),
        tabBtn('team', 'pickerTabTeams', filteredTeams.length)),
      h('div', { className: 'exp-picker-list', ref: listRef, role: 'listbox' },
        props.rows === null
          ? h('div', { className: 'exp-picker-empty' }, t('pickerLoading'))
          : shown.length === 0
            ? h('div', { className: 'exp-picker-empty' }, t('pickerEmpty'))
            : shown.map((row, i) => h('button', {
                key: row.name, type: 'button', role: 'option', 'aria-selected': i === active,
                className: 'exp-picker-row', 'data-active': i === active,
                onMouseEnter: () => setActive(i),
                onMouseDown: (e) => { e.preventDefault(); props.onPick(row) },
              },
                row.icon ? h('span', { className: 'exp-picker-icon', 'aria-hidden': 'true' }, row.icon) : null,
                h('span', { className: 'exp-picker-name' }, row.displayName || row.name),
                row.displayName && row.displayName !== row.name ? h('span', { className: 'exp-picker-literal' }, row.name) : null,
                h('span', { className: 'exp-picker-desc' }, row.plainDescription || ''))))))
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

function BuiltinSettingsDialog({ t, onClose, onToast, onSynced }) {
  const [status, setStatus] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = () => fetchJson(`${API}/builtin/status`).then((s) => { setStatus(s); setForm((f) => f ?? { url: s.url, branch: s.branch, repoDir: s.dir, token: '', autoSync: s.autoSync, syncOnStartup: s.syncOnStartup }) })
  useEffect(() => { load() }, [])
  const sync = async () => {
    setBusy(true)
    try {
      const r = await fetchJson(`${API}/builtin/sync`, { method: 'POST' })
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
      await fetchJson(`${API}/builtin/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      setForm((f) => ({ ...f, token: '' }))
      onToast(t('saved'))
      await load()
    } catch (e) { onToast(String(e && e.message)) }
    setBusy(false)
  }
  const clearToken = async () => {
    setBusy(true)
    try {
      await fetchJson(`${API}/builtin/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: null }) })
      onToast(t('saved'))
      await load()
    } catch (e) { onToast(String(e && e.message)) }
    setBusy(false)
  }
  // 布局逐行对齐技能市场的市场设置弹窗：状态区 = 左标签/右值成行；
  // 输入区 = 全宽堆叠、placeholder 即标签；底部 = 右对齐 保存 + 立即同步(主按钮)。
  const short = (c) => (c ? String(c).slice(0, 8) : '-')
  const row = (label, value) => h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0' } },
    h('span', { className: 'exp-profession' }, label), h('span', { style: { wordBreak: 'break-all', textAlign: 'right', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, value))
  return h('div', { className: 'exp-modal-backdrop', onClick: (e) => { if (e.target === e.currentTarget) onClose() } },
    h('div', { className: 'exp-modal', style: { maxWidth: 640 } },
      h('div', { className: 'exp-modal-head' },
        h('span', { className: 'exp-title' }, t('builtinSettings')),
        h('button', { className: 'exp-btn exp-modal-close', onClick: onClose }, t('close'))),
      status === null ? h('div', { className: 'exp-empty' }, '…')
        : h('div', { style: { display: 'contents' } },
          !status.gitAvailable ? h('div', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12 } }, t('gitMissing')) : null,
          h('div', null,
            row(t('repoUrlLabel'), status.url),
            row(t('branchLabel'), status.branch),
            row(t('localCommitLabel'), short(status.localCommit)),
            status.remoteCommit ? h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
              status.needsUpdate ? Badge({ kind: 'type', children: t('needsUpdateTag') }) : null) : null,
            row(t('remoteCommitLabel'), short(status.remoteCommit)),
            row(t('lastSyncLabel'), status.lastSyncAt ? formatTime(status.lastSyncAt) : t('never')),
            row(t('repoDirLabel'), status.dir),
            status.sparsePaths ? row('sparse', (status.sparsePaths || []).join(', ')) : null),
          h('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' } },
            h('label', { className: 'exp-checkline' },
              h('input', { type: 'checkbox', checked: !!form.autoSync, onChange: (e) => setForm({ ...form, autoSync: e.target.checked }) }), t('autoSyncLabel')),
            h('label', { className: 'exp-checkline' },
              h('input', { type: 'checkbox', checked: !!form.syncOnStartup, onChange: (e) => setForm({ ...form, syncOnStartup: e.target.checked }) }), t('syncOnStartupLabel'))),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h('input', { className: 'exp-input', value: form.url ?? '', placeholder: t('repoUrlLabel'), onChange: (e) => setForm({ ...form, url: e.target.value }), style: { width: '100%', boxSizing: 'border-box' } }),
            h('input', { className: 'exp-input', value: form.branch ?? '', placeholder: t('branchLabel'), onChange: (e) => setForm({ ...form, branch: e.target.value }), style: { width: '100%', boxSizing: 'border-box' } }),
            h('input', { className: 'exp-input', value: form.repoDir ?? '', placeholder: t('repoDirLabel'), onChange: (e) => setForm({ ...form, repoDir: e.target.value }), style: { width: '100%', boxSizing: 'border-box' } }),
            h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
              h('input', { className: 'exp-input', type: 'password', value: form.token ?? '', onChange: (e) => setForm({ ...form, token: e.target.value }),
                placeholder: status.hasToken ? `${t('tokenLabel')} · ${t('tokenConfigured')}` : t('tokenLabel'), style: { flex: 1 } }),
              status.hasToken ? h('button', { className: 'exp-btn', disabled: busy, onClick: clearToken }, t('clearToken')) : null)),
          h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 } },
            h('button', { className: 'exp-btn', disabled: busy, onClick: save }, t('save')),
            h('button', { className: 'exp-btn', 'data-primary': 'true', disabled: busy || status.syncing, onClick: sync }, busy || status.syncing ? t('syncing') : t('syncNow'))))))
}

// ── Page ─────────────────────────────────────────────────────────────────

function ExpertsPage({ t, embedded, onClose }) {
  const [tab, setTab] = useState('builtin')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null) // {name, source}
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [busyName, setBusyName] = useState(null)
  const [toast, setToast] = useState(null)
  const showToast = (text) => { setToast(text); setTimeout(() => setToast(null), 2600) }
  const reload = () => fetchJson(API).then((d) => { setData(d); setError('') }).catch((e) => setError(String(e && e.message)))
  useEffect(() => { reload() }, [])
  const rows = useMemo(() => {
    if (!data) return []
    const lower = search.trim().toLowerCase()
    const list = tab === 'mine' ? data.mine : data.builtin
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
  return h('div', { className: 'exp-page' + (embedded ? '' : ' exp-overlay') },
    !embedded ? h('div', { className: 'exp-head' },
      h('span', { className: 'exp-title' }, t('title')),
      h('span', { className: 'exp-spacer' }),
      h('button', { className: 'exp-btn', onClick: () => { if (onClose) onClose() } }, t('close'))) : null,
    h('div', { className: 'exp-toolbar' },
      h('div', { className: 'exp-tabs' },
        h('button', { className: 'exp-tab', 'data-on': tab === 'mine', onClick: () => setTab('mine') }, `${t('tabMine')}${data ? ` (${data.mine.length})` : ''}`),
        h('button', { className: 'exp-tab', 'data-on': tab === 'builtin', onClick: () => setTab('builtin') }, `${t('tabBuiltin')}${data ? ` (${data.builtin.length})` : ''}`)),
      h('input', { className: 'exp-input exp-search', placeholder: t('searchPlaceholder'), value: search, onChange: (e) => setSearch(e.target.value) }),
      h('span', { className: 'exp-count' }, `${rows.length}`),
      tab === 'builtin' ? h('button', { className: 'exp-btn', title: t('builtinSettings'), onClick: () => setSettingsOpen(true) }, t('builtinSettings')) : null),
    error !== '' ? h('div', { className: 'exp-empty' }, `${t('loadFailed')}: ${error}`) : null,
    data !== null && rows.length === 0 ? h('div', { className: 'exp-empty' }, tab === 'mine' ? t('mineEmpty') : t('builtinEmpty')) : null,
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
    settingsOpen ? h(BuiltinSettingsDialog, {
      t, onClose: () => setSettingsOpen(false), onToast: showToast, onSynced: reload,
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
    toRosterRows, insertComposerText, splitRosterByType, pickerRowMatch,
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
            __t: t, label: t('pickExpert'), title: t('pickExpertTitle'),
            composerScopeRef: () => composerScope,
            sessionId: apiProps && apiProps.sessionId, input: apiProps && apiProps.input,
          })
        }))
      } catch (e) { (globalThis.__expErrors = globalThis.__expErrors || []).push('input.left:' + (e && e.message)); throw e }
    }, 'experts-management: input left button')
  },
}

/** Composer tool-row button: 加号+文字 chip，点击在按钮上方打开自带搜索的
 *  专家 picker 浮层；pick 经 slash/input-insert-text 写入 `/expert-<name> `。
 *  浮层面板盖住按钮以外的区域，再点一次按钮会先落在背板上——天然形成开关切换。
 *  inputTriggers/sessions 服务缺席时按钮隐藏（管理页不受影响）。 */
function ComposerButtonSlot(props) {
  useEffect(ensureStyles, [])
  const [picker, setPicker] = useState(null) // {left, top} 锚点快照；null = 关闭
  const [rows, setRows] = useState(null)     // null = 加载中
  const btnRef = useRef(null)
  const liveInput = useRef(props.input)
  liveInput.current = props.input
  const composerScope = props.composerScopeRef ? props.composerScopeRef() : null
  const ready = !!(composerScope && composerScope.sessions && props.sessionId)
  if (!ready) return null
  const close = () => setPicker(null)
  const open = () => {
    let anchor = { left: 16, top: 160 }
    try { if (btnRef.current) anchor = btnRef.current.getBoundingClientRect() } catch {}
    setPicker({ left: anchor.left, top: anchor.top })
    setRows(null)
    Promise.resolve(fetchRoster())
      .then((list) => setRows(Array.isArray(list) ? list : []))
      .catch(() => setRows([]))
  }
  const pick = (row) => {
    insertComposerText(composerScope, props.sessionId, liveInput.current, `/${row.name} `)
    close()
    refocusComposer()
  }
  const popover = picker !== null && RDP && typeof RDP.createPortal === 'function'
    ? RDP.createPortal(h(ExpertPicker, { t: props.__t, anchor: picker, rows, onClose: close, onPick: pick }), document.body)
    : null
  return h('button', {
    className: 'exp-chip',
    ref: btnRef,
    title: props.title || props.label,
    'aria-haspopup': 'dialog',
    'aria-expanded': picker !== null,
    onClick: open,
  }, props.label, popover)
}

/** Settings section slot entry: render the page directly in the host tree. */
function SettingsSlotComponent(props) {
  useEffect(ensureStyles, [])
  return h(ExpertsPage, { t: props.__t, embedded: true })
}
