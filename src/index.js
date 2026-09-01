'use strict'

/**
 * dsh-plugin-experts-management — Host half
 *
 * Manages ntd-format experts (WorkBuddy plugin.json + Agent MD + skills)
 * WITHOUT touching the ntd application's own directories:
 * - Builtin: ntd-resource's experts/ subtree via git sparse checkout into the
 *   plugin's own dir ($DSH_HOME/experts-management/builtin). Read-only shelf;
 *   install copies into the user library.
 * - User library: $DSH_HOME/experts (writable, the only built-in source).
 *   Additional directories are opt-in via config.extraSources.
 * - Model integration: every expert registers on the host skills registry as
 *   a USER-INVOCABLE, MODEL-INVISIBLE skill (`disable-model-invocation`
 *   semantics, name `expert-<name>`). Typing `/expert-<name>` in a message
 *   (or picking it from the composer menu) makes the host's user-explicit
 *   gesture boundary deterministically inject the expert's role prompt —
 *   ntd's three-section injection, zero model-catalog tokens, zero host code.
 */

const { createReadStream } = require('node:fs')
const { execFile } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const fsP = require('node:fs/promises')
const { basename, join, relative, resolve, sep } = require('node:path')
const { homedir } = require('node:os')
const YAML = require('yaml')
// settings 服务要求 schemastery schema（可调用 + toJSON；zod 不兼容，register 会抛错被吞）。
// 宿主沙箱内解析打包依赖可能抛 ERR_INTERNAL_ASSERTION（.pnpm 软链），因此优先沿
// dsh 全局安装取 settings 服务自用的那份副本，本地开发/测试再退回标准 require。
function loadSchemastery() {
  const errors = []
  const { createRequire } = require('node:module')
  for (const prefix of [process.env.DSH_GLOBAL_PREFIX, join(homedir(), '.local')].filter(Boolean)) {
    const hostCopy = join(prefix, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'schemastery', 'lib', 'index.cjs')
    try { return createRequire(hostCopy)(hostCopy) } catch (e) { errors.push(String(e && e.code || e)) }
  }
  try { return require('@deepseek-ai/schemastery') } catch (e) { errors.push(String(e && e.code || e)) }
  if (process.env.EXPERTS_SETTINGS_DEBUG) console.warn(`[experts-management] schemastery unavailable: ${errors.join(' | ')}`)
  return null
}
const Schema = loadSchemastery()

/** dsh 数据根（与宿主一致：$DSH_HOME，缺省 ~/.dsh）。 */
function dshHome() {
  return process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh')
}

const BUILTIN_SCAN_SKIP = new Set(['.git', 'node_modules'])
const RANK_INSTALLED = 100
const RANK_BUILTIN = 500
const MAX_BODY_BYTES = 64 * 1024
const DESCRIPTION_LIMIT = 140
// 同款正则见 skill/skill/src/index.ts SKILL_NAME —— 不合规的候选会让 registry 抛错
const KEBAB_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
// 专家在宿主技能注册表里的名字前缀：expert-<plugin.name>，防与真实技能撞名
const EXPERT_NAME_PREFIX = 'expert-'

/**
 * Built-in sources: ONLY the dsh user library. ntd 应用自身的目录
 * （~/.ntd/*）一律不扫描不读取；需要纳管其他目录时经 config.extraSources
 * 显式加入（可标 readOnly）。
 */
const SOURCE_DEFS = [
  { key: 'dsh', label: 'DSH' },
]

/** plugin.json 的固定入口目录（WorkBuddy/CodeBuddy 兼容格式）。 */
const PLUGIN_JSON_REL = '.codebuddy-plugin/plugin.json'

/** Absolute path with the $HOME prefix folded to `~` (no username leaks in UI). */
function displayPath(p) {
  const home = homedir()
  if (p === home) return '~'
  if (p.startsWith(home + sep)) return '~' + p.slice(home.length)
  return p
}

// ── Parsing: frontmatter + plugin.json ───────────────────────────────────

function extractFrontmatter(content) {
  const lines = content.split(/\r?\n/)
  if (lines[0] === undefined || lines[0].trim() !== '---') return undefined
  const yamlLines = []
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '---') return yamlLines.join('\n')
    yamlLines.push(line)
  }
  return undefined
}

function parseFrontmatter(content) {
  const yamlText = extractFrontmatter(content)
  if (yamlText === undefined) return { meta: {}, body: content }
  let meta = {}
  try {
    const parsed = YAML.parse(yamlText)
    if (parsed !== null && typeof parsed === 'object') meta = parsed
  } catch {}
  const lines = content.split(/\r?\n/)
  let closer = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') { closer = index; break }
  }
  // body 切掉 frontmatter 块（含紧随的空行）：注入 prompt 只携带正文
  const body = closer >= 0 ? lines.slice(closer + 1).join('\n').replace(/^\r?\n/, '') : content
  return { meta, body }
}

/** 取 LocalizedText（{zh,en} 或纯字符串）某一语言，带回退。 */
function localized(value, lang, fallbackLang) {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object') {
    const primary = typeof value[lang] === 'string' ? value[lang] : undefined
    const secondary = fallbackLang !== undefined && typeof value[fallbackLang] === 'string' ? value[fallbackLang] : undefined
    return primary ?? secondary
  }
  return undefined
}

function truncateDescription(text) {
  if (typeof text !== 'string') return ''
  const single = text.split(/\r?\n/)[0].trim()
  return single.length > DESCRIPTION_LIMIT ? single.slice(0, DESCRIPTION_LIMIT) + '…' : single
}

/** 解析 agents/<name>.md 的 YAML frontmatter（name/description/color/emoji/vibe）。 */
function parseAgentMd(content, fallbackName) {
  const { meta } = parseFrontmatter(content)
  return {
    name: typeof meta.name === 'string' && meta.name !== '' ? meta.name : fallbackName,
    description: typeof meta.description === 'string' ? meta.description : undefined,
    color: typeof meta.color === 'string' ? meta.color : undefined,
    emoji: typeof meta.emoji === 'string' ? meta.emoji : undefined,
    vibe: typeof meta.vibe === 'string' ? meta.vibe : undefined,
  }
}

/** 解析 skills/<name>/SKILL.md 的 frontmatter 摘要。 */
function parseSkillMd(content) {
  const { meta } = parseFrontmatter(content)
  return {
    name: typeof meta.name === 'string' && meta.name !== '' ? meta.name : undefined,
    description: typeof meta.description === 'string' ? meta.description : undefined,
    descriptionZh: typeof meta.description_zh === 'string' ? meta.description_zh : undefined,
    descriptionEn: typeof meta.description_en === 'string' ? meta.description_en : undefined,
    version: typeof meta.version === 'string' ? meta.version : undefined,
    emoji: typeof meta.emoji === 'string' ? meta.emoji : undefined,
  }
}

/**
 * 解析 plugin.json → 专家记录的“头部”字段（不含 agent/skill 明细）。
 * 展示字段按 ntd 语义回退：displayName.zh → .en → name。
 */
function parsePluginJson(raw) {
  const plugin = typeof raw === 'string' ? JSON.parse(raw) : raw
  const name = String(plugin.name || '')
  const expertType = plugin.expertType === 'team' ? 'team' : 'agent'
  const members = Array.isArray(plugin.members) ? plugin.members.map((m) => ({
    id: String(m.id || ''),
    nameZh: localized(m.name, 'zh', 'en'),
    nameEn: localized(m.name, 'en'),
    professionZh: localized(m.profession, 'zh', 'en'),
    professionEn: localized(m.profession, 'en'),
    avatar: typeof m.avatar === 'string' ? m.avatar : undefined,
    role: m.role === 'lead' ? 'lead' : 'member',
  })) : []
  const teamInfo = plugin.teamInfo !== null && typeof plugin.teamInfo === 'object' ? plugin.teamInfo : {}
  return {
    name,
    expertType,
    version: typeof plugin.version === 'string' ? plugin.version : undefined,
    displayNameZh: localized(plugin.displayName, 'zh', 'en') ?? (name || undefined),
    displayNameEn: localized(plugin.displayName, 'en') ?? (name || undefined),
    professionZh: localized(plugin.profession, 'zh', 'en'),
    professionEn: localized(plugin.profession, 'en'),
    descZh: localized(plugin.displayDescription, 'zh', 'en') ?? (typeof plugin.description_zh === 'string' ? plugin.description_zh : undefined) ?? (typeof plugin.description === 'string' ? plugin.description : undefined),
    descEn: localized(plugin.displayDescription, 'en') ?? (typeof plugin.description === 'string' ? plugin.description : undefined),
    avatar: typeof plugin.avatar === 'string' && plugin.avatar !== '' ? plugin.avatar : undefined,
    categoryId: typeof plugin.categoryId === 'string' ? plugin.categoryId : undefined,
    agents: Array.isArray(plugin.agents) ? plugin.agents.map(String) : undefined,
    agentName: typeof plugin.agentName === 'string' && plugin.agentName !== '' ? plugin.agentName : undefined,
    leadAgent: typeof teamInfo.leadAgent === 'string' && teamInfo.leadAgent !== '' ? teamInfo.leadAgent : undefined,
    memberAgents: Array.isArray(teamInfo.memberAgents) ? teamInfo.memberAgents.map(String) : [],
    members,
    skills: Array.isArray(plugin.skills) ? plugin.skills.map(String) : [],
    defaultInitPromptZh: localized(plugin.defaultInitPrompt, 'zh', 'en'),
    defaultInitPromptEn: localized(plugin.defaultInitPrompt, 'en'),
    quickPromptsZh: Array.isArray(plugin.quickPrompts) ? plugin.quickPrompts.map((q) => localized(q, 'zh', 'en')).filter(Boolean) : [],
    tags: Array.isArray(plugin.tags) ? plugin.tags.map((t) => ({ zh: localized(t, 'zh', 'en') || '', en: localized(t, 'en') || '' })) : [],
  }
}

// ── Path safety（ntd resolve_within 语义）────────────────────────────────

/** 解析相对路径并校验仍位于 base 内，防 plugin.json 里的 .. / 绝对路径越界读文件。 */
function resolveWithin(base, rel) {
  if (typeof rel !== 'string' || rel === '') return undefined
  const target = resolve(base, rel)
  const baseResolved = resolve(base)
  if (target === baseResolved || target.startsWith(baseResolved + sep)) return target
  return undefined
}

/** ntd is_safe_expert_name：目录名只拒绝路径分隔符、父级引用与控制字符（中文名合法）。 */
function isSafeExpertName(name) {
  if (typeof name !== 'string' || name === '') return false
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false
  if ([...name].some((ch) => { const c = ch.codePointAt(0); return c < 32 || c === 127 })) return false
  return true
}

// ── Scanning ─────────────────────────────────────────────────────────────

/**
 * 扫描一个专家来源根目录（ntd 语义：只看一层子目录，每个含
 * .codebuddy-plugin/plugin.json 的目录是一个专家）。
 * 失败的专家跳过并返回 errors，单个坏专家不拖垮整个市场。
 */
async function scanExpertsRoot(root, sourceKey) {
  const experts = []
  const errors = []
  let entries
  try { entries = await fsP.readdir(root, { withFileTypes: true }) } catch { return { experts, errors } }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (BUILTIN_SCAN_SKIP.has(entry.name)) continue
    const dir = join(root, entry.name)
    try {
      experts.push(await readExpertDir(root, dir, sourceKey))
    } catch (e) {
      errors.push(`${entry.name}: ${e && e.message}`)
    }
  }
  experts.sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1)
  return { experts, errors }
}

/** 读取单个专家目录 → 完整记录（plugin.json 头部 + agent MD 明细 + skills 明细）。 */
async function readExpertDir(root, dir, sourceKey) {
  const pluginJsonPath = join(dir, PLUGIN_JSON_REL)
  const raw = await fsP.readFile(pluginJsonPath, 'utf8')
  const head = parsePluginJson(raw)
  if (head.name === '') throw new Error('plugin.json missing name')
  let stat
  try { stat = await fsP.stat(pluginJsonPath) } catch { stat = undefined }

  // agents 列表：plugin.agents 优先；缺失时扫描 agents/*.md 兜底（旧版 team 格式）
  let agentRels = head.agents
  if (agentRels === undefined) {
    agentRels = []
    try {
      const found = []
      for (const ent of await fsP.readdir(join(dir, 'agents'), { withFileTypes: true })) {
        if (ent.isFile() && ent.name.endsWith('.md')) found.push(`./agents/${ent.name}`)
      }
      agentRels = found.sort()
    } catch { agentRels = [] }
  }

  const agentFiles = []
  for (const rel of agentRels) {
    const mdPath = resolveWithin(dir, rel)
    if (mdPath === undefined) continue // 路径逃逸：拒绝
    try {
      const content = await fsP.readFile(mdPath, 'utf8')
      const meta = parseAgentMd(content, basename(mdPath).replace(/\.md$/, ''))
      agentFiles.push({ ...meta, relPath: rel, mdPath })
    } catch { /* 单个 agent 文件坏了不影响其余 */ }
  }

  const skillMeta = []
  for (const rel of head.skills) {
    const skillDir = resolveWithin(dir, rel)
    if (skillDir === undefined) continue
    const skillMdPath = join(skillDir, 'SKILL.md')
    let content
    try { content = await fsP.readFile(skillMdPath, 'utf8') } catch { continue }
    const parsed = parseSkillMd(content)
    skillMeta.push({
      ...parsed,
      skillName: parsed.name ?? basename(skillDir),
      skillDir,
      skillMdPath,
    })
  }

  return {
    ...head,
    source: sourceKey,
    dir,
    root,
    relPath: relative(root, dir).split(sep).join('/'),
    pluginJsonPath,
    mtime: stat !== undefined ? stat.mtime.toISOString() : undefined,
    agentFiles,
    skillMeta,
  }
}

/** ntd resolve_agent_name：team 用 leadAgent，agent 用 agentName，最后兜底第一个 agent 文件。 */
function resolveLeadAgentFile(expert) {
  const wanted = expert.leadAgent ?? expert.agentName
  if (expert.agentFiles.length === 0) return undefined
  if (wanted !== undefined) {
    const hit = expert.agentFiles.find((a) => a.name === wanted || a.relPath.endsWith(`/${wanted}.md`) || basename(a.mdPath).replace(/\.md$/, '') === wanted)
    if (hit !== undefined) return hit
  }
  return expert.agentFiles[0]
}

// ── Prompt assembly（ntd 三段式注入的 skill-content 适配）────────────────

/** 技能清单段：名称渲染为指向 SKILL.md 的链接，模型按需读完整定义（ntd build_skills_context）。 */
function buildSkillsContext(skillMeta) {
  if (!Array.isArray(skillMeta) || skillMeta.length === 0) return ''
  const parts = ['## 可用技能', '你可以使用以下技能来辅助完成任务。技能名称是 markdown 链接，指向技能定义文件，如需了解技能详细用法可查看该文件：', '']
  for (const skill of skillMeta) {
    const desc = skill.descriptionZh ?? skill.descriptionEn ?? skill.description ?? '(无描述)'
    parts.push(`- **[${skill.skillName}](${skill.skillMdPath})**: ${desc}`)
  }
  parts.push('', '请根据需要自行调用上述技能。')
  return parts.join('\n')
}

/**
 * 拼专家 prompt：角色定义 → 可用技能（有才出现）→ 身份说明。
 * ntd 在 todo 执行前拼接“# 任务 + 原消息”；这里内容经宿主手势边界作为
 * <skill_content> 注入，用户消息随草稿单独送达，故以一句身份说明收尾。
 */
function buildExpertPrompt(agentMdBody, skillsText, expert) {
  const displayName = (expert && (expert.displayNameZh ?? expert.displayNameEn)) || ''
  const profession = (expert && (expert.professionZh ?? expert.professionEn)) || ''
  const closing = `\n\n# 身份说明\n你现在是${profession ? `「${profession}」` : ''}专家${displayName ? `「${displayName}」` : ''}。用户的消息中包含具体任务，请严格以上述角色定义的身份、标准与技能完成它。`
  if (skillsText === '') {
    return `# 专家角色定义\n${agentMdBody}${closing}`
  }
  return `# 专家角色定义\n${agentMdBody}\n\n${skillsText}${closing}`
}

// ── Shared route helpers ─────────────────────────────────────────────────

function readJsonBody(req) {
  return new Promise((fulfil, reject) => {
    let size = 0, chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) { reject(new Error('request body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { fulfil(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch (error) { reject(new Error(`invalid JSON body: ${error && error.message}`)) }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function contentTypeFor(p) {
  const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase()
  const map = { md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', json: 'application/json; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', ts: 'text/typescript', tsx: 'text/typescript', css: 'text/css', html: 'text/html', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', yaml: 'text/yaml', yml: 'text/yaml' }
  return map[ext]
}

async function sendFile(res, filePath) {
  const stat = await fsP.stat(filePath)
  if (!stat.isFile()) throw new Error('file not found')
  res.writeHead(200, { 'content-type': contentTypeFor(filePath) ?? 'application/octet-stream', 'content-length': stat.size })
  const stream = createReadStream(filePath)
  stream.pipe(res)
  await new Promise((fulfil, reject) => {
    stream.on('error', reject)
    res.on('close', () => fulfil())
    stream.on('end', () => fulfil())
  })
}

async function countFilesAndSize(dir) {
  let fileCount = 0, totalSize = 0
  const walk = async (current) => {
    const entries = await fsP.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = join(current, entry.name)
      let stat = await fsP.stat(entryPath).catch(() => undefined)
      if (stat === undefined) continue
      if (stat.isDirectory()) { await walk(entryPath) }
      else if (stat.isFile()) { fileCount += 1; totalSize += stat.size }
    }
  }
  await walk(dir)
  return { fileCount, totalSize }
}

async function copyDir(from, to) {
  await fsP.mkdir(to, { recursive: true })
  const entries = await fsP.readdir(from, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git') continue
    const source = join(from, entry.name), target = join(to, entry.name)
    let stat
    try { stat = await fsP.stat(source) } catch { continue }
    if (stat.isDirectory()) { await copyDir(source, target) }
    else if (stat.isFile()) { await fsP.copyFile(source, target) }
  }
}

async function atomicWriteJs(file, content) {
  await fsP.mkdir(join(file, '..'), { recursive: true })
  const temp = join(join(file, '..'), `.${randomUUID()}.tmp`)
  await fsP.writeFile(temp, content, 'utf8')
  await fsP.rename(temp, file)
}

// ── Builtin git sync（与 skills-management 同款管线；稀疏检出 experts/ 子树）──

function gitExec(binary, args, cwd) {
  return new Promise((fulfil, reject) => {
    execFile(binary, args, { cwd, timeout: 10 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const tail = String(stderr || error.message || '').split(/\r?\n/).filter(Boolean).slice(-3).join(' ')
        reject(new Error(`git ${args[0]}: ${tail || error.message}`))
        return
      }
      fulfil(String(stdout).trim())
    })
  })
}

async function gitAvailable(binary) {
  try { await gitExec(binary, ['--version']); return true } catch { return false }
}

async function gitCurrentCommit(binary, repo) {
  try { return await gitExec(binary, ['rev-parse', 'HEAD'], repo) } catch { return undefined }
}

async function gitRemoteCommit(binary, repo, remote, branch) {
  try {
    const out = await gitExec(binary, ['ls-remote', '--heads', remote, branch], repo)
    return out.split(/\s+/)[0] || undefined
  } catch { return undefined }
}

function authedUrl(url, token) {
  if (!token) return url
  return String(url).replace(/^(https?:\/\/)([^@/]+@)?/, `$1oauth2:${encodeURIComponent(token)}@`)
}

/** Clone (first time) or fetch+reset (update); sparse checkout只落地指定子树。 */
async function gitSyncRepo(binary, url, branch, repoDir, token, sparsePaths) {
  const remote = authedUrl(url, token)
  const sparse = Array.isArray(sparsePaths) && sparsePaths.length > 0 ? sparsePaths : undefined
  let repoExists = false
  try { await fsP.access(join(repoDir, '.git')); repoExists = true } catch { repoExists = false }
  if (!repoExists) {
    await fsP.rm(repoDir, { recursive: true, force: true })
    await fsP.mkdir(join(repoDir, '..'), { recursive: true })
    if (sparse) {
      await gitExec(binary, ['clone', '-b', branch, '--depth', '1', '--filter=blob:none', '--sparse', remote, repoDir])
      await gitExec(binary, ['sparse-checkout', 'set', '--cone', ...sparse], repoDir)
    } else {
      await gitExec(binary, ['clone', '-b', branch, '--depth', '1', remote, repoDir])
    }
    return { isFirstClone: true, hasUpdates: true, before: undefined, after: await gitCurrentCommit(binary, repoDir) }
  }
  if (sparse) {
    try { await gitExec(binary, ['sparse-checkout', 'set', '--cone', ...sparse], repoDir) }
    catch (e) { console.warn(`experts-management: sparse-checkout conversion failed, continuing full: ${e && e.message}`) }
  }
  const before = await gitCurrentCommit(binary, repoDir)
  await gitExec(binary, ['fetch', remote, branch], repoDir)
  await gitExec(binary, ['reset', '--hard', 'FETCH_HEAD'], repoDir)
  const after = await gitCurrentCommit(binary, repoDir)
  return { isFirstClone: false, hasUpdates: before !== after, before, after }
}

const DEFAULT_BUILTIN_SYNC = {
  url: 'https://gitcode.com/weibaohui/ntd-resource.git',
  branch: 'main',
  gitBinary: 'git',
  autoSync: true,        // periodic: sync when lastSyncAt is older than a day
  syncOnStartup: true,
}
// ntd-resource 同时携带 skills（~400MB），专家市场只稀疏检出 experts/ 子树
const DEFAULT_BUILTIN_SPARSE_PATHS = ['experts']

const BUILTIN_SETTINGS_NS = 'experts-management-builtin'

function builtinSettingsSchema() {
  if (!Schema) return null
  return Schema.object({
    url: Schema.string(),
    branch: Schema.string(),
    gitBinary: Schema.string(),
    repoDir: Schema.string(),
    autoSync: Schema.boolean(),
    syncOnStartup: Schema.boolean(),
    token: Schema.string(),
  })
}

function baseSettings(config) {
  const cfg = (config.builtinSync && typeof config.builtinSync === 'object') ? config.builtinSync : {}
  const base = { ...DEFAULT_BUILTIN_SYNC }
  for (const key of ['url', 'branch', 'gitBinary', 'autoSync', 'syncOnStartup']) {
    if (cfg[key] !== undefined) base[key] = cfg[key]
  }
  if (config.builtinRepoDir !== undefined) base.repoDir = resolve(String(config.builtinRepoDir))
  return base
}

// ── 编辑端点（v0.3）：只写 dsh 用户库；内置只读 ─────────────────────────
const EDIT_BODY_MAX_BYTES = 8 * 1024 * 1024

/** 魔数嗅探图片类型；非白名单格式返回 null。 */
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: 'png', type: 'image/png' }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' }
  const head = buf.slice(0, 12)
  if (head.toString('latin1').startsWith('GIF8')) return { ext: 'gif', type: 'image/gif' }
  if (head.toString('latin1').startsWith('RIFF') && head.toString('latin1').slice(8) === 'WEBP') return { ext: 'webp', type: 'image/webp' }
  return null
}

const readRawBody = (req, cap) => new Promise((fulfil, reject) => {
  let size = 0
  const chunks = []
  req.on('data', (chunk) => {
    size += chunk.length
    if (size > cap) { reject(new Error(`image exceeds ${cap} bytes`)); if (typeof req.destroy === 'function') req.destroy(); return }
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  })
  req.on('end', () => fulfil(Buffer.concat(chunks)))
  req.on('error', reject)
})

/** 编辑端点公共前置：只解析 dsh 用户库副本（内置只读）；名字围栏。 */
async function locateEditable(locateExpert, name) {
  if (typeof name !== 'string' || name === '') throw new Error('body must provide name')
  const { expert } = await locateExpert(name, 'dsh')
  if (!isSafeExpertName(expert.name)) throw new Error(`invalid expert name: ${expert.name}`)
  return expert
}

const MD_MAX_CHARS = 512 * 1024

// ── Module export ────────────────────────────────────────────────────────

module.exports = {
  name: 'experts-management',
  inject: ['skills', 'webServer', 'settings'],
  __internals: {
    extractFrontmatter, parseFrontmatter, parseAgentMd, parseSkillMd, parsePluginJson,
    localized, truncateDescription, resolveWithin, isSafeExpertName,
    buildSkillsContext, buildExpertPrompt, resolveLeadAgentFile,
    candidateName: (name) => EXPERT_NAME_PREFIX + name,
    SOURCE_DEFS, EXPERT_NAME_PREFIX, KEBAB_NAME_RE,
  },

  apply(ctx, config = {}) {
    const installedDir = resolve(String(config.installedDir !== undefined ? config.installedDir : join(dshHome(), 'experts')))
    const providerName = config.providerName !== undefined ? config.providerName : 'ntd-experts'

    // ── Source rows：内置只有 dsh 用户库；其他目录一律经 extraSources 显式加入 ──
    const disabledSources = new Set(Array.isArray(config.disabledSources) ? config.disabledSources : [])
    const seenKeys = new Set()
    const sourceRows = []
    for (const def of SOURCE_DEFS) {
      if (disabledSources.has(def.key)) continue
      const root = def.key === 'dsh' ? installedDir : def.dir !== undefined ? resolve(String(def.dir)) : undefined
      if (seenKeys.has(def.key)) continue
      seenKeys.add(def.key)
      sourceRows.push({ key: def.key, label: def.label, root, readOnly: def.readOnly === true })
    }
    for (const extra of Array.isArray(config.extraSources) ? config.extraSources : []) {
      if (extra === null || typeof extra !== 'object') continue
      if (typeof extra.key !== 'string' || extra.key === '') continue
      if (typeof extra.dir !== 'string' || extra.dir === '') continue
      if (seenKeys.has(extra.key)) continue
      seenKeys.add(extra.key)
      sourceRows.push({
        key: extra.key,
        label: typeof extra.label === 'string' && extra.label !== '' ? extra.label : extra.key,
        root: resolve(String(extra.dir)),
        readOnly: extra.readOnly === true,
      })
    }
    const findSourceRow = (key) => allSourceRows().find((row) => row.key === key)
    // git 市场检出（稀疏 experts/ 子树）也是一路来源：root 运行期可变，按调用时解析
    const allSourceRows = () => [
      ...sourceRows,
      { key: 'builtin', label: '内置', root: join(builtinRootDir(), 'experts'), readOnly: true },
    ]

    // ── Market sync state / settings（skills-management 同款管线）────────
    const builtinRootDir = () => {
      const eff = builtinSettings()
      return resolve(typeof eff.repoDir === 'string' && eff.repoDir !== '' ? eff.repoDir
        : config.builtinRepoDir !== undefined ? resolve(String(config.builtinRepoDir))
        : join(dshHome(), 'experts-management', 'builtin'))
    }
    const builtinSparsePaths = () => config.builtinSparsePaths === null
      ? undefined
      : (Array.isArray(config.builtinSparsePaths) && config.builtinSparsePaths.length > 0 ? config.builtinSparsePaths.map(String) : DEFAULT_BUILTIN_SPARSE_PATHS)

        // v0.1 → v0.2 落盘迁移：market 命名 → builtin（检出目录 + 同步状态文件）
    const migrateV1Layout = async () => {
      const base = join(dshHome(), 'experts-management')
      for (const [oldName, newName] of [['market', 'builtin'], ['market-sync.json', 'builtin-sync.json']]) {
        const from = join(base, oldName)
        const to = join(base, newName)
        try {
          await fsP.access(from)
          try { await fsP.access(to); continue } catch {}
          await fsP.rename(from, to)
          ctx.logger.info && ctx.logger.info(`experts-management: migrated ${oldName} → ${newName}`)
        } catch { /* 旧布局不存在：跳过 */ }
      }
    }
    const builtinStateFile = join(dshHome(), 'experts-management', 'builtin-sync.json')
    let builtinState = { lastSyncAt: undefined, lastResult: undefined }
    let settingsScope = null
    const settingsOverrides = {}  // fallback sheet when the settings service is absent
    const builtinStateLoaded = migrateV1Layout()
      .then(() => fsP.readFile(builtinStateFile, 'utf8'))
      .then((raw) => {
        let parsed
        try { parsed = JSON.parse(raw) } catch { parsed = null }
        if (parsed) builtinState = { lastSyncAt: parsed.lastSyncAt, lastResult: parsed.lastResult }
      })
      .catch(() => {})
    if (Schema && ctx.settings && typeof ctx.settings.register === 'function') {
      try {
        settingsScope = ctx.settings.register(BUILTIN_SETTINGS_NS, builtinSettingsSchema(), { base: baseSettings(config) })
      } catch (e) { ctx.logger.warn(`experts-management: settings register: ${e && e.message}`) }
    }
    const saveBuiltinState = async () => {
      try {
        await fsP.mkdir(join(builtinStateFile, '..'), { recursive: true })
        await atomicWriteJs(builtinStateFile, JSON.stringify(builtinState, null, 2))
        await fsP.chmod(builtinStateFile, 0o600)
      } catch {}
    }
    const builtinSettings = () => {
      if (settingsScope && typeof settingsScope.get === 'function') {
        const v = settingsScope.get()
        if (v && typeof v === 'object') return { ...baseSettings(config), ...v }
      }
      return { ...baseSettings(config), ...settingsOverrides }
    }

    let builtinSyncRun = null
    const runBuiltinSync = async () => {
      if (builtinSyncRun !== null) return builtinSyncRun
      builtinSyncRun = (async () => {
        await builtinStateLoaded
        const eff = builtinSettings()
        const ok = await gitAvailable(eff.gitBinary)
        if (!ok) throw new Error('git is not available on PATH')
        const started = Date.now()
        const repoDir = builtinRootDir()
        const result = await gitSyncRepo(eff.gitBinary, eff.url, eff.branch, repoDir, eff.token, builtinSparsePaths())
        builtinState.lastSyncAt = new Date().toISOString()
        builtinState.lastResult = { ...result, at: builtinState.lastSyncAt, durationMs: Date.now() - started }
        await saveBuiltinState()
        invalidate()
        return { ...builtinState.lastResult, url: eff.url, branch: eff.branch, dir: repoDir }
      })().finally(() => { builtinSyncRun = null })
      return builtinSyncRun
    }

    // Startup + periodic auto-sync (fire-and-forget; failures only warn)
    ctx.effect(() => {
      const eff = builtinSettings()
      if (eff.syncOnStartup) {
        builtinStateLoaded.then(() => runBuiltinSync()).catch(e => ctx.logger.warn(`experts-management: startup builtin sync: ${e && e.message}`))
      }
      const timer = setInterval(() => {
        const eff2 = builtinSettings()
        if (!eff2.autoSync) return
        const last = builtinState.lastSyncAt ? Date.parse(builtinState.lastSyncAt) : 0
        if (Date.now() - last > 24 * 3600 * 1000) {
          runBuiltinSync().catch(e => ctx.logger.warn(`experts-management: auto builtin sync: ${e && e.message}`))
        }
      }, 6 * 3600 * 1000)
      if (typeof timer.unref === 'function') timer.unref()
      return () => clearInterval(timer)
    }, 'experts-management: builtin auto-sync')

    // ── Discovery ────────────────────────────────────────────────────────
    async function discoverAll() {
      const mine = [], builtin = []
      const errors = []
      for (const row of allSourceRows()) {
        const { experts, errors: errs } = await scanExpertsRoot(row.root, row.key)
        errors.push(...errs)
        if (row.key === 'dsh') mine.push(...experts)
        else builtin.push(...experts)
      }
      return { mine, builtin, errors }
    }

    async function locateExpert(name, sourceKey) {
      const rows = sourceKey !== undefined && sourceKey !== null && sourceKey !== '' && sourceKey !== 'auto'
        ? [findSourceRow(sourceKey)].filter(Boolean)
        : allSourceRows()
      if (sourceKey !== undefined && sourceKey !== null && sourceKey !== '' && sourceKey !== 'auto' && findSourceRow(sourceKey) === undefined) {
        throw new Error(`unknown source '${sourceKey}'`)
      }
      for (const row of rows) {
        const { experts } = await scanExpertsRoot(row.root, row.key)
        const hit = experts.find((e) => e.name === name)
        if (hit !== undefined) return { expert: hit, row }
      }
      throw new Error(`expert '${name}' not found${sourceKey ? ` in ${sourceKey}` : ''}`)
    }

    // ── Skill provider：每个专家 = 仅用户可调用的技能 ────────────────────
    let providerControl
    const invalidate = () => { if (providerControl !== undefined) providerControl.invalidate() }

    ctx.skills.registerProvider((control) => {
      providerControl = control
      control.signal.addEventListener('abort', () => { if (providerControl === control) providerControl = undefined }, { once: true })
      return {
        name: providerName,
        async list() {
          const { mine, builtin } = await discoverAll()
          const candidates = []
          const seen = new Set()
          // 专家一律 modelInvocable:false：不进模型目录（零 token 污染），
          // 仅保留 /expert-名称 用户手势（宿主 pre-step 确定性注入 <skill_content>）。
          const invocation = { modelInvocable: false, userInvocable: true }
          const describe = (e) => truncateDescription([e.professionZh ?? e.professionEn, e.descZh ?? e.descEn].filter(Boolean).join(' · '))
          const push = (e, source, rank) => {
            const candName = EXPERT_NAME_PREFIX + e.name
            if (!KEBAB_NAME_RE.test(candName)) {
              ctx.logger.warn(`experts-management: skipping expert '${e.name}' (${e.dir}): invalid candidate name '${candName}'`)
              return
            }
            if (describe(e) === '') {
              ctx.logger.warn(`experts-management: skipping expert '${e.name}' (${e.dir}): empty description`)
              return
            }
            if (seen.has(candName)) return
            seen.add(candName)
            candidates.push({
              name: candName,
              description: describe(e),
              invocation,
              source,
              provider: providerName,
              rank,
              locator: { name: e.name, dir: e.dir, source: e.source, agent: (resolveLeadAgentFile(e) || {}).mdPath },
              path: (resolveLeadAgentFile(e) || {}).mdPath,
              resourceBase: { kind: 'directory', path: e.dir },
              metadata: { expertType: e.expertType, profession: e.professionZh ?? e.professionEn, version: e.version },
            })
          }
          for (const e of mine) push(e, 'user-installed', RANK_INSTALLED)
          const mineNames = new Set(mine.map((e) => e.name))
          for (const e of builtin) {
            if (mineNames.has(e.name)) continue // 用户库覆盖内置同名专家
            push(e, 'builtin', RANK_BUILTIN)
          }
          return candidates
        },
        async get(candidate) {
          try {
            // list→get 之间文件可能变化：按 locator 重新读取角色定义
            const pluginRaw = await fsP.readFile(join(candidate.locator.dir, PLUGIN_JSON_REL), 'utf8')
            const expert = { ...parsePluginJson(pluginRaw), dir: candidate.locator.dir }
            const agentPath = candidate.locator.agent
            if (agentPath === undefined) return undefined
            const mdRaw = await fsP.readFile(agentPath, 'utf8')
            const { body } = parseFrontmatter(mdRaw)
            // 技能清单现场重建：链接指向当前磁盘上的 SKILL.md
            const head = expert
            const skillMeta = []
            for (const rel of head.skills) {
              const skillDir = resolveWithin(candidate.locator.dir, rel)
              if (skillDir === undefined) continue
              try {
                const parsed = parseSkillMd(await fsP.readFile(join(skillDir, 'SKILL.md'), 'utf8'))
                skillMeta.push({ ...parsed, skillName: parsed.name ?? basename(skillDir), skillMdPath: join(skillDir, 'SKILL.md') })
              } catch { /* skip */ }
            }
            return {
              name: candidate.name,
              description: candidate.description,
              invocation: { modelInvocable: false, userInvocable: true },
              source: candidate.source,
              provider: providerName,
              resourceBase: { kind: 'directory', path: candidate.locator.dir },
              content: buildExpertPrompt(body, buildSkillsContext(skillMeta), expert),
              path: agentPath,
              metadata: candidate.metadata,
            }
          } catch { return undefined }
        },
      }
    })

    // ── HTTP API ─────────────────────────────────────────────────────────
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/experts-management/api',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://dsh.local')
          const apiPath = url.pathname.replace(/\/+$/, '')
          const query = url.searchParams

          // GET /experts-management/api → { sources, mine, builtin }
          if (req.method === 'GET' && apiPath === '/experts-management/api') {
            const { mine, builtin, errors } = await discoverAll()
            const mineNames = new Set(mine.map((e) => e.name))
            const summarize = (e) => ({
              name: e.name,
              displayName: e.displayNameZh ?? e.displayNameEn ?? e.name,
              profession: e.professionZh ?? e.professionEn ?? '',
              description: truncateDescription(e.descZh ?? e.descEn ?? ''),
              expertType: e.expertType,
              tags: e.tags.filter((t) => t.zh || t.en).map((t) => t.zh || t.en),
              hasAvatar: e.avatar !== undefined,
              source: e.source,
              installed: mineNames.has(e.name),
              mtime: e.mtime,
            })
            sendJson(res, 200, {
              sources: allSourceRows().map((row) => ({ key: row.key, label: row.label, dir: displayPath(row.root), readOnly: row.readOnly })),
              mine: mine.map(summarize),
              builtin: builtin.map(summarize),
              errors,
            })
            return
          }

          // GET /experts-management/api/detail?name=&source=
          if (req.method === 'GET' && apiPath.endsWith('/experts-management/api/detail')) {
            const name = query.get('name') || ''
            const { expert, row } = await locateExpert(name, query.get('source') || undefined)
            const { fileCount, totalSize } = await countFilesAndSize(expert.dir)
            const rawPluginText = await fsP.readFile(expert.pluginJsonPath, 'utf8')
            sendJson(res, 200, {
              ...expert,
              plugin: parsePluginJson(rawPluginText),
              pluginJson: JSON.parse(rawPluginText),
              leadAgentFile: resolveLeadAgentFile(expert)?.name,
              dir: displayPath(expert.dir),
              sourceLabel: row.label,
              readOnly: row.readOnly,
              fileCount, totalSize,
            })
            return
          }

          // GET /experts-management/api/agent-md?name=&source=&agent=
          if (req.method === 'GET' && apiPath.endsWith('/experts-management/api/agent-md')) {
            const { expert } = await locateExpert(query.get('name') || '', query.get('source') || undefined)
            const wanted = query.get('agent') || undefined
            const normRel = (p) => String(p || '').replace(/^\.\//, '')
            const agentFile = wanted !== undefined
              ? expert.agentFiles.find((a) => a.name === wanted || normRel(a.relPath) === normRel(wanted) || basename(a.mdPath) === wanted)
              : resolveLeadAgentFile(expert)
            if (agentFile === undefined) throw new Error(`agent not found in expert '${expert.name}'`)
            sendJson(res, 200, { expert: expert.name, agent: agentFile.name, content: await fsP.readFile(agentFile.mdPath, 'utf8') })
            return
          }

          // GET /experts-management/api/avatar?name=&source=&member=
          if (req.method === 'GET' && apiPath.endsWith('/experts-management/api/avatar')) {
            const { expert } = await locateExpert(query.get('name') || '', query.get('source') || undefined)
            const memberId = query.get('member')
            let rel
            if (memberId !== null && memberId !== '') {
              const member = expert.members.find((m) => m.id === memberId)
              rel = member !== undefined ? member.avatar : undefined
            } else {
              rel = expert.avatar
            }
            if (rel === undefined) { res.writeHead(404); res.end(); return }
            const full = resolveWithin(expert.dir, rel)
            if (full === undefined) { res.writeHead(404); res.end(); return }
            try { await sendFile(res, full) } catch { res.writeHead(404); res.end() }
            return
          }

          // GET /experts-management/api/file?name=&source=&path= （预览 references 等）
          if (req.method === 'GET' && apiPath.endsWith('/experts-management/api/file')) {
            const { expert } = await locateExpert(query.get('name') || '', query.get('source') || undefined)
            const rel = query.get('path') || ''
            const full = resolveWithin(expert.dir, rel)
            if (full === undefined) throw new Error('invalid file path')
            await sendFile(res, full)
            return
          }

          // POST /experts-management/api/install {name, from?, overwrite?}
          if (req.method === 'POST' && apiPath.endsWith('/experts-management/api/install')) {
            const body = await readJsonBody(req)
            if (typeof body.name !== 'string' || body.name === '') { sendJson(res, 400, { error: 'body must provide name' }); return }
            // from 兼容 client 的 source 字段；'auto'/缺省一律钉死为 builtin——
            // 若解析到 dsh 源，overwrite 会先 rm 自己再空拷（v0.2.0 数据丢失事故），此路彻底封死
            const from = typeof body.from === 'string' && body.from !== '' ? body.from
              : typeof body.source === 'string' && body.source !== '' ? body.source : 'builtin'
            if (from === 'dsh') throw new Error('cannot install from the dsh library (it is the install destination)')
            const { expert } = await locateExpert(body.name, from)
            if (!isSafeExpertName(expert.name)) throw new Error(`invalid expert name: ${expert.name}`)
            const target = join(installedDir, expert.name)
            if (body.overwrite !== true) {
              try { await fsP.access(target); throw new Error(`expert '${expert.name}' already installed`) }
              catch (e) { if (e.code !== 'ENOENT') throw e }
            } else {
              await fsP.rm(target, { recursive: true, force: true })
            }
            await copyDir(expert.dir, target)
            invalidate()
            sendJson(res, 201, { installed: { name: expert.name, dir: target, from: expert.source } })
            return
          }

          // DELETE /experts-management/api {name} → 仅允许删除 dsh 用户库
          if (req.method === 'DELETE' && apiPath.endsWith('/experts-management/api')) {
            const body = await readJsonBody(req)
            if (typeof body.name !== 'string' || body.name === '') { sendJson(res, 400, { error: 'body must provide name' }); return }
            if (!isSafeExpertName(body.name)) throw new Error('invalid expert name')
            const target = join(installedDir, body.name)
            const stat = await fsP.stat(target).catch(() => undefined)
            if (stat === undefined || !stat.isDirectory()) throw new Error(`expert '${body.name}' not found in the dsh library`)
            await fsP.rm(target, { recursive: true })
            invalidate()
            sendJson(res, 200, { removed: body.name, source: 'dsh' })
            return
          }

          // ── 编辑端点（v0.3）：仅 dsh 用户库可编辑，内置只读 ──

          // PUT /experts-management/api/agent-md {name, agent?, content} — 角色定义全文
          if (req.method === 'PUT' && apiPath.endsWith('/experts-management/api/agent-md')) {
            const body = await readJsonBody(req)
            const expert = await locateEditable(locateExpert, body.name)
            if (typeof body.content !== 'string' || body.content.trim() === '') throw new Error('content must be a non-empty string')
            if (body.content.length > MD_MAX_CHARS) throw new Error(`content exceeds ${MD_MAX_CHARS} chars`)
            const normRel = (p0) => String(p0 || '').replace(/^\.\//, '')
            const agentFile = body.agent !== undefined && body.agent !== ''
              ? expert.agentFiles.find((a) => a.name === body.agent || normRel(a.relPath) === normRel(body.agent) || basename(a.mdPath) === body.agent)
              : resolveLeadAgentFile(expert)
            if (agentFile === undefined) throw new Error(`agent not found in expert '${expert.name}'`)
            const full = resolveWithin(expert.dir, agentFile.relPath)
            if (full === undefined || resolve(full) !== resolve(agentFile.mdPath)) throw new Error('agent file path escaped the expert dir')
            await atomicWriteJs(full, body.content)
            invalidate()
            sendJson(res, 200, { ok: true, agent: agentFile.name })
            return
          }

          // PUT /experts-management/api/metadata {name, metadata} — plugin.json 展示字段（读-改-写保留未知键）
          if (req.method === 'PUT' && apiPath.endsWith('/experts-management/api/metadata')) {
            const body = await readJsonBody(req)
            const meta = body.metadata
            if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('metadata must be an object')
            const expert = await locateEditable(locateExpert, body.name)
            const pluginJson = JSON.parse(await fsP.readFile(expert.pluginJsonPath, 'utf8'))
            const normLocalized = (v) => ({ zh: typeof v.zh === 'string' ? v.zh : '', en: typeof v.en === 'string' ? v.en : '' })
            for (const key of ['displayName', 'profession', 'displayDescription', 'defaultInitPrompt']) {
              if (meta[key] === undefined) continue
              const v = meta[key]
              if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${key} must be an object`)
              for (const lang of ['zh', 'en']) {
                if (v[lang] !== undefined && (typeof v[lang] !== 'string' || v[lang].length > 2000)) throw new Error(`${key}.${lang} must be a string (≤2000 chars)`)
              }
              pluginJson[key] = normLocalized(v)
            }
            const listOfLocalized = (v, label) => {
              if (!Array.isArray(v) || v.length > 20) throw new Error(`${label} must be an array (≤20)`)
              return v.map((item) => {
                if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${label} items must be objects`)
                return { zh: typeof item.zh === 'string' ? item.zh.slice(0, 2000) : '', en: typeof item.en === 'string' ? item.en.slice(0, 2000) : '' }
              }).filter((item) => item.zh !== '' || item.en !== '')
            }
            if (meta.tags !== undefined) pluginJson.tags = listOfLocalized(meta.tags, 'tags')
            if (meta.quickPrompts !== undefined) pluginJson.quickPrompts = listOfLocalized(meta.quickPrompts, 'quickPrompts')
            await atomicWriteJs(expert.pluginJsonPath, JSON.stringify(pluginJson, null, 2))
            invalidate()
            sendJson(res, 200, { ok: true, plugin: pluginJson })
            return
          }

          // PUT /experts-management/api/expert-skills {name, attach?, detach?} — 技能副本同步
          if (req.method === 'PUT' && apiPath.endsWith('/experts-management/api/expert-skills')) {
            const body = await readJsonBody(req)
            const attach = Array.isArray(body.attach) ? body.attach.map(String) : []
            const detach = Array.isArray(body.detach) ? body.detach.map(String) : []
            if (attach.length === 0 && detach.length === 0) throw new Error('attach and detach must not both be empty')
            const kebab = (n) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(n)
            for (const n of [...attach, ...detach]) {
              if (!kebab(n)) throw new Error(`invalid skill name: ${n}`)
            }
            const expert = await locateEditable(locateExpert, body.name)
            const pluginJson = JSON.parse(await fsP.readFile(expert.pluginJsonPath, 'utf8'))
            // detach 先验后删（任一未附 → 整体拒绝，避免半套变更）
            const detachDirs = []
            for (const n of detach) {
              const dir = resolveWithin(expert.dir, `./skills/${n}`)
              if (dir === undefined) throw new Error(`skill '${n}' is not attached to expert '${expert.name}'`)
              const st = await fsP.stat(dir).catch(() => undefined)
              if (st === undefined || !st.isDirectory()) throw new Error(`skill '${n}' is not attached to expert '${expert.name}'`)
              detachDirs.push({ n, dir })
            }
            // attach 全部先在用户技能库解析源目录（任一缺失整体拒绝）
            const libRoot = join(dshHome(), 'skills')
            const attachDirs = []
            for (const n of attach) {
              const from = join(libRoot, n)
              const st = await fsP.stat(join(from, 'SKILL.md')).catch(() => undefined)
              if (st === undefined || !st.isFile()) throw new Error(`skill '${n}' not found in the user skill library (${libRoot})`)
              attachDirs.push({ n, from })
            }
            for (const d of detachDirs) await fsP.rm(d.dir, { recursive: true, force: true })
            for (const a of attachDirs) {
              const target = join(expert.dir, 'skills', a.n)
              await fsP.rm(target, { recursive: true, force: true }) // 同名覆盖 = 技能库更新同步进专家
              await copyDir(a.from, target)
            }
            // plugin.json.skills = 声明同步：原序保留存活项 + 追加新 attach（以 skills/ 目录实况为准）
            const skillRoot = join(expert.dir, 'skills')
            const present = new Set()
            try {
              for (const ent of await fsP.readdir(skillRoot, { withFileTypes: true })) if (ent.isDirectory()) present.add(ent.name)
            } catch { /* 无 skills 目录 */ }
            const oldNames = (Array.isArray(pluginJson.skills) ? pluginJson.skills : []).map((r) => String(r).replace(/^\.\/skills\//, '').replace(/^\.\//, ''))
            const finalNames = []
            for (const n of [...oldNames, ...attach]) {
              if (present.has(n) && !finalNames.includes(n)) finalNames.push(n)
            }
            pluginJson.skills = finalNames.map((n) => `./skills/${n}`)
            await atomicWriteJs(expert.pluginJsonPath, JSON.stringify(pluginJson, null, 2))
            invalidate()
            sendJson(res, 200, { ok: true, skills: pluginJson.skills })
            return
          }

          // POST /experts-management/api/avatar?name= — 原始图片体（魔数嗅探）
          if (req.method === 'POST' && apiPath.endsWith('/experts-management/api/avatar')) {
            const expert = await locateEditable(locateExpert, query.get('name') || '')
            const imgBody = await readRawBody(req, EDIT_BODY_MAX_BYTES)
            const img = sniffImage(imgBody)
            if (img === null) throw new Error('unsupported image (png/jpg/gif/webp only)')
            const rel = `avatars/expert.${img.ext}`
            await atomicWriteJs(join(expert.dir, rel), imgBody)
            const pluginJson = JSON.parse(await fsP.readFile(expert.pluginJsonPath, 'utf8'))
            pluginJson.avatar = rel
            await atomicWriteJs(expert.pluginJsonPath, JSON.stringify(pluginJson, null, 2))
            invalidate()
            sendJson(res, 200, { ok: true, avatar: rel })
            return
          }

          // GET /experts-management/api/available-skills — 技能关联选择器数据源：
          // 用户技能库（~/.dsh/skills）目录直读。刻意不走 skills 注册表——那会把
          // 市场货架库存（5900+ 条）漏进来；也不附 bundled/项目级技能。
          if (req.method === 'GET' && apiPath.endsWith('/experts-management/api/available-skills')) {
            const libRoot = join(dshHome(), 'skills')
            const list = []
            let libEntries = []
            try { libEntries = await fsP.readdir(libRoot, { withFileTypes: true }) } catch { /* 无技能库 */ }
            for (const ent of libEntries) {
              if (!ent.isDirectory() || !isSafeExpertName(ent.name)) continue
              let content
              try { content = await fsP.readFile(join(libRoot, ent.name, 'SKILL.md'), 'utf8') } catch { continue }
              const parsed = parseSkillMd(content)
              const description = String(parsed.descriptionZh ?? parsed.descriptionEn ?? parsed.description ?? '').slice(0, 200)
              list.push({ name: ent.name, description })
            }
            list.sort((a, b) => a.name.localeCompare(b.name))
            sendJson(res, 200, { skills: list })
            return
          }

          // GET /experts-management/api/builtin/status
          if (req.method === 'GET' && apiPath.endsWith('/experts-management/api/builtin/status')) {
            await builtinStateLoaded
            const eff = builtinSettings()
            const repoDir = builtinRootDir()
            const repoExists = await fsP.access(join(repoDir, '.git')).then(() => true).catch(() => false)
            const ok = await gitAvailable(eff.gitBinary)
            const [localCommit, remoteCommit] = repoExists && ok
              ? [await gitCurrentCommit(eff.gitBinary, repoDir), await gitRemoteCommit(eff.gitBinary, repoDir, 'origin', eff.branch)]
              : [undefined, undefined]
            sendJson(res, 200, {
              url: eff.url, branch: eff.branch, dir: displayPath(repoDir),
              gitAvailable: ok, repoExists,
              localCommit, remoteCommit,
              needsUpdate: localCommit !== undefined && remoteCommit !== undefined ? localCommit !== remoteCommit : undefined,
              lastSyncAt: builtinState.lastSyncAt, lastResult: builtinState.lastResult,
              autoSync: eff.autoSync, syncOnStartup: eff.syncOnStartup,
              hasToken: typeof eff.token === 'string' && eff.token !== '',
              syncing: builtinSyncRun !== null,
              sparsePaths: builtinSparsePaths() ?? null,
            })
            return
          }

          // POST /experts-management/api/builtin/sync
          if (req.method === 'POST' && apiPath.endsWith('/experts-management/api/builtin/sync')) {
            try {
              const result = await runBuiltinSync()
              sendJson(res, 200, result)
            } catch (e) { sendJson(res, 400, { error: String(e && e.message || e) }) }
            return
          }

          // PUT /experts-management/api/builtin/settings {url?, branch?, repoDir?, token?, autoSync?, syncOnStartup?}
          if (req.method === 'PUT' && apiPath.endsWith('/experts-management/api/builtin/settings')) {
            const body = await readJsonBody(req)
            await builtinStateLoaded
            const patch = {}
            for (const key of ['url', 'branch', 'gitBinary']) {
              if (typeof body[key] === 'string' && body[key] !== '') patch[key] = body[key]
            }
            if (typeof body.token === 'string' && body.token !== '') patch.token = body.token
            if (body.token === null || body.token === '') patch.token = undefined
            if (typeof body.repoDir === 'string' && body.repoDir !== '') patch.repoDir = resolve(body.repoDir)
            for (const key of ['autoSync', 'syncOnStartup']) {
              if (typeof body[key] === 'boolean') patch[key] = body[key]
            }
            if (settingsScope && typeof settingsScope.update === 'function') {
              await settingsScope.update(patch)
            } else {
              Object.assign(settingsOverrides, patch)
            }
            const eff = builtinSettings()
            const { token, ...safe } = eff  // token 只写不回读
            sendJson(res, 200, { settings: safe, hasToken: typeof token === 'string' && token !== '' })
            return
          }

          sendJson(res, 404, { error: 'not found' })
        } catch (error) { sendJson(res, 400, { error: String(error && error.message || error) }) }
      },
    }), 'experts-management: api route')
  },
}
