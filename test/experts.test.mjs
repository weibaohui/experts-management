import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile as execFileCb } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const plugin = require('../src/index.js')
const {
  extractFrontmatter, parseFrontmatter, parseAgentMd, parseSkillMd, parsePluginJson,
  localized, truncateDescription, resolveWithin, isSafeExpertName,
  buildSkillsContext, buildExpertPrompt, resolveLeadAgentFile,
  candidateName, KEBAB_NAME_RE,
} = plugin.__internals

// ── HTTP handler harness（同 skills-management 测试样式）─────────────────

function setupPlugin(config, snapshotSkills = []) {
  let handler
  let registered
  let invalidations = 0
  const ctx = {
    skills: {
      registerProvider: (create) => {
        registered = create({ signal: new AbortController().signal, invalidate: () => { invalidations += 1 } })
      },
      snapshot: async () => ({ skills: snapshotSkills }),
    },
    webServer: { register: (route) => { handler = route.handler } },
    effect: (fn) => fn(),
    logger: { warn: () => {} },
    settings: { register: (ns, schema, opts) => ({ get: () => ({ ...opts.base }), update: async () => {} }) },
  }
  plugin.apply(ctx, {
    builtinRepoDir: join(tmpdir(), 'dsh-experts-builtin-test-' + Math.random().toString(36).slice(2)),
    builtinSync: { syncOnStartup: false, autoSync: false },
    ...config,
  })
  const call = async (method, url, body) => {
    const req = new EventEmitter()
    req.method = method
    req.url = url
    req.headers = {}
    const chunks = []
    const res = {
      writeHead(status) { chunks.status = status },
      end(chunk) { chunks.body = chunk === undefined ? '' : String(chunk) },
    }
    if (body !== undefined) {
      setTimeout(() => { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end') }, 30)
    }
    await handler(req, res)
    return { status: chunks.status, payload: chunks.body ? JSON.parse(chunks.body) : undefined }
  }
  const callRaw = (method, url, rawBody) => new Promise((fulfil, reject) => {
    const req = new EventEmitter()
    req.method = method
    req.url = url
    req.headers = {}
    req.on('error', () => {})
    const parts = []
    const out = { status: undefined }
    const res = new EventEmitter()
    res.writeHead = (status) => { out.status = status }
    res.write = (chunk) => { parts.push(Buffer.from(chunk)) }
    res.end = (chunk) => { if (chunk !== undefined) parts.push(Buffer.from(chunk)); fulfil({ status: out.status, body: Buffer.concat(parts).toString('utf8') }) }
    Promise.resolve(handler(req, res)).catch(reject)
    if (rawBody !== undefined) setTimeout(() => { req.emit('data', rawBody); req.emit('end') }, 30) // avatar 端点先 locate 再挂 body 监听，等它就绪
  })
  return { call, callRaw, registered, getInvalidations: () => invalidations }
}

// ── Fixture: 写一个 agent 型 + 一个 team 型专家 ─────────────────────────

async function writeExpert(base, name, { team = false, agents = null, skills = [], avatar = false } = {}) {
  const dir = join(base, name)
  await mkdir(join(dir, '.codebuddy-plugin'), { recursive: true })
  const pluginJson = {
    name,
    version: '1.0.0',
    expertType: team ? 'team' : 'agent',
    displayName: { zh: `中文${name}`, en: `EN ${name}` },
    profession: { zh: '后端架构师', en: 'Backend Architect' },
    displayDescription: { zh: `${name} 的中文描述`, en: `${name} english description` },
    categoryId: '02-Engineering',
    tags: [{ zh: '后端', en: 'Backend' }],
    defaultInitPrompt: { zh: '开始吧', en: 'Start' },
    quickPrompts: [{ zh: '快指令', en: 'Quick' }],
    skills: skills.map((s) => `./skills/${s}`),
    ...(avatar ? { avatar: 'avatars/expert.png' } : {}),
    ...(team
      ? {
          teamInfo: { leadAgent: 'lead-a', memberAgents: ['lead-a', 'member-b'] },
          members: [
            { id: 'lead-a', name: { zh: '队长', en: 'Lead' }, profession: { zh: '交付总监', en: 'Delivery' }, role: 'lead' },
            { id: 'member-b', name: { zh: '队员', en: 'Member' }, role: 'member' },
          ],
        }
      : { agentName: name }),
  }
  await writeFile(join(dir, '.codebuddy-plugin', 'plugin.json'), JSON.stringify(pluginJson))
  const agentList = agents ?? (team ? ['lead-a', 'member-b'] : [name])
  await mkdir(join(dir, 'agents'), { recursive: true })
  for (const agent of agentList) {
    await writeFile(join(dir, 'agents', `${agent}.md`),
      `---\nname: ${agent}\ndescription: ${agent} 的角色定义\nemoji: 🏗️\n---\n\n你是 ${agent} 专家的完整角色定义。`)
  }
  for (const skill of skills) {
    await mkdir(join(dir, 'skills', skill), { recursive: true })
    await writeFile(join(dir, 'skills', skill, 'SKILL.md'),
      `---\nname: ${skill}\ndescription: ${skill} 技能\ndescription_zh: ${skill} 中文技能\n---\n技能正文`)
    await writeFile(join(dir, 'skills', skill, 'reference.md'), 'extra file')
  }
  if (avatar) {
    await mkdir(join(dir, 'avatars'), { recursive: true })
    await writeFile(join(dir, 'avatars', 'expert.png'), 'PNGBYTES')
  }
  return dir
}

// ── Pure parsing ─────────────────────────────────────────────────────────

test('plugin exports the host-plane contract', () => {
  assert.equal(plugin.name, 'experts-management')
  assert.deepEqual(plugin.inject, ['skills', 'webServer', 'settings'])
})

test('builtin sources never touch ntd application directories (~/.ntd/*)', () => {
  assert.deepEqual(plugin.__internals.SOURCE_DEFS.map((d) => d.key), ['dsh'])
  for (const def of plugin.__internals.SOURCE_DEFS) {
    assert.equal(def.sub, undefined, 'builtin sources must not point into $HOME-relative ntd dirs')
  }
})

test('extractFrontmatter requires standalone delimiters', () => {
  assert.equal(extractFrontmatter('no frontmatter here'), undefined)
  assert.equal(extractFrontmatter('---\nname: x\nno closer'), undefined)
  assert.equal(extractFrontmatter('---\nname: x\n---\nbody'), 'name: x')
  // YAML 值里的 foo---bar 不能误判为结束符（ntd parser 语义）
  assert.equal(extractFrontmatter('---\nname: foo---bar\n---\nbody'), 'name: foo---bar')
})

test('parseFrontmatter splits meta from body and tolerates malformed yaml', () => {
  const ok = parseFrontmatter('---\nname: a\n---\n\n正文')
  assert.equal(ok.meta.name, 'a')
  assert.equal(ok.body, '正文') // frontmatter 块与紧随空行被切掉
  const broken = parseFrontmatter('---\nname: [unclosed\n---\nbody text')
  assert.equal(broken.body, 'body text')
  const plain = parseFrontmatter('# just a body')
  assert.deepEqual(plain.meta, {})
})

test('localized reads {zh,en} objects with fallback, plain strings pass through', () => {
  assert.equal(localized({ zh: '中', en: 'E' }, 'zh'), '中')
  assert.equal(localized({ en: 'E' }, 'zh', 'en'), 'E')
  assert.equal(localized('plain', 'zh'), 'plain')
  assert.equal(localized(undefined, 'zh'), undefined)
})

test('truncateDescription keeps the first line only, capped', () => {
  assert.equal(truncateDescription('第一行\n第二行'), '第一行')
  assert.equal(truncateDescription('x'.repeat(200)), 'x'.repeat(140) + '…')
})

test('parseAgentMd falls back to the filename for a missing name', () => {
  const meta = parseAgentMd('---\ndescription: d\n---\nbody', 'from-file')
  assert.equal(meta.name, 'from-file')
  assert.equal(meta.description, 'd')
  assert.equal(meta.emoji, undefined)
})

test('parseSkillMd reads zh/en description variants', () => {
  const meta = parseSkillMd('---\nname: code-review\ndescription_zh: 评审\nversion: "2.0"\n---\nbody')
  assert.equal(meta.name, 'code-review')
  assert.equal(meta.descriptionZh, '评审')
  assert.equal(meta.version, '2.0')
})

test('parsePluginJson maps team fields and falls back like ntd', () => {
  const head = parsePluginJson(JSON.stringify({
    name: 'software-company',
    expertType: 'team',
    teamInfo: { leadAgent: 'ceo', memberAgents: ['ceo', 'cto'] },
    members: [{ id: 'ceo', name: { zh: 'CEO', en: 'CEO' }, profession: { zh: '首席执行官' }, role: 'lead' }],
    displayName: { en: 'Only English' },
    description: 'english-only desc',
    skills: ['./skills/pm'],
  }))
  assert.equal(head.expertType, 'team')
  assert.equal(head.leadAgent, 'ceo')
  assert.equal(head.members.length, 1)
  assert.equal(head.members[0].role, 'lead')
  assert.equal(head.displayNameZh, 'Only English') // zh 缺失回退 en
  assert.equal(head.descZh, 'english-only desc') // displayDescription 缺 → 旧格式 description 兜底
  assert.deepEqual(head.skills, ['./skills/pm'])
  // expertType 缺失/未知归一为 agent
  assert.equal(parsePluginJson(JSON.stringify({ name: 'x' })).expertType, 'agent')
})

test('resolveWithin blocks path escapes; isSafeExpertName follows ntd rules', () => {
  assert.equal(resolveWithin('/base', './agents/a.md'), join('/base', 'agents/a.md'))
  assert.equal(resolveWithin('/base', '../outside'), undefined)
  assert.equal(resolveWithin('/base', '/etc/passwd'), undefined)
  assert.equal(isSafeExpertName('backend-architect'), true)
  assert.equal(isSafeExpertName('刺桐说'), true) // 中文名合法（ntd 语义）
  assert.equal(isSafeExpertName('../escape'), false)
  assert.equal(isSafeExpertName('a/b'), false)
  assert.equal(isSafeExpertName(''), false)
})

test('buildSkillsContext renders markdown links to SKILL.md; empty skills → empty string', () => {
  assert.equal(buildSkillsContext([]), '')
  const text = buildSkillsContext([{ skillName: 'code-review', skillMdPath: '/e/skills/code-review/SKILL.md', descriptionZh: '代码评审' }])
  assert.match(text, /## 可用技能/)
  assert.match(text, /\*\*\[code-review\]\(\/e\/skills\/code-review\/SKILL\.md\)\*\*: 代码评审/)
})

test('buildExpertPrompt: two sections without skills, three with; always ends with the identity note', () => {
  const expert = { displayNameZh: '磐石石', professionZh: '后端架构师' }
  const withSkills = buildExpertPrompt('你是后端专家', buildSkillsContext([{ skillName: 's1', skillMdPath: '/x/SKILL.md', description: 'd' }]), expert)
  assert.match(withSkills, /^# 专家角色定义\n你是后端专家/)
  assert.match(withSkills, /## 可用技能/)
  assert.match(withSkills, /# 身份说明/)
  assert.match(withSkills, /「后端架构师」/)
  const noSkills = buildExpertPrompt('你是后端专家', '', expert)
  assert.doesNotMatch(noSkills, /可用技能/)
  assert.match(noSkills, /# 身份说明/)
})

test('candidateName prefixes expert- and must stay kebab', () => {
  assert.equal(candidateName('backend-architect'), 'expert-backend-architect')
  assert.equal(KEBAB_NAME_RE.test(candidateName('backend-architect')), true)
  // 中文名专家的候选名不是 kebab → provider 会跳过（fail-soft）
  assert.equal(KEBAB_NAME_RE.test(candidateName('中文专家')), false)
})

// ── Provider + API over fixtures ─────────────────────────────────────────

test('provider lists experts with expert- prefix, model-invisible + user-invocable, installed shadows builtin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-experts-'))
  try {
    const builtin = join(root, 'builtin', 'experts')
    await mkdir(builtin, { recursive: true })
    await writeExpert(builtin, 'backend-architect', { skills: ['fullstack-dev'] })
    await writeExpert(builtin, 'software-company', { team: true })
    const installed = join(root, 'installed')
    await mkdir(installed, { recursive: true })
    await writeExpert(installed, 'backend-architect', { skills: [] })

    const env = setupPlugin({ builtinRepoDir: join(root, 'builtin'), installedDir: installed })
    const candidates = await env.registered.list()
    assert.equal(candidates.length, 2)
    const byName = Object.fromEntries(candidates.map((c) => [c.name, c]))
    const backend = byName['expert-backend-architect']
    assert.equal(backend.source, 'user-installed')
    assert.equal(backend.rank, 100)
    assert.deepEqual(backend.invocation, { modelInvocable: false, userInvocable: true })
    const team = byName['expert-software-company']
    assert.equal(team.source, 'builtin')
    assert.equal(team.rank, 500)

    // get(): 已装副本生效（内容来自用户库）——市场副本带技能、用户库副本不带，
    // 结果里没有「可用技能」段，恰好证明读取的是用户库而非市场
    const loaded = await env.registered.get(backend)
    assert.match(loaded.content, /^# 专家角色定义\n/)
    assert.match(loaded.content, /你是 backend-architect 专家的完整角色定义/)
    assert.doesNotMatch(loaded.content, /## 可用技能/)
    assert.equal(loaded.invocation.modelInvocable, false)
    assert.equal(loaded.resourceBase.kind, 'directory')
    assert.ok(loaded.path.endsWith('.md'))

    // team 的 get(): 注入 lead 的角色定义
    const lead = await env.registered.get(team)
    assert.match(lead.content, /你是 lead-a 专家的完整角色定义/)
    assert.doesNotMatch(lead.content, /member-b 专家/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('list API: sources include the git builtin; mine/builtin buckets and summaries are correct', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-experts-api-'))
  try {
    const builtin = join(root, 'builtin', 'experts')
    await mkdir(builtin, { recursive: true })
    await writeExpert(builtin, 'backend-architect', { avatar: true, skills: ['fullstack-dev'] })
    const installed = join(root, 'installed')
    await mkdir(installed, { recursive: true })
    await writeExpert(installed, 'my-expert')

    const env = setupPlugin({ builtinRepoDir: join(root, 'builtin'), installedDir: installed })
    const res = await env.call('GET', '/experts-management/api')
    assert.equal(res.status, 200)
    const { sources, mine: mineRows, builtin: builtinRows } = res.payload
    assert.ok(sources.some((s) => s.key === 'builtin' && s.dir.endsWith(join('builtin', 'experts'))))
    assert.deepEqual(mineRows.map((e) => e.name), ['my-expert'])
    assert.deepEqual(builtinRows.map((e) => e.name), ['backend-architect'])
    const row = builtinRows[0]
    assert.equal(row.displayName, '中文backend-architect')
    assert.equal(row.profession, '后端架构师')
    assert.equal(row.expertType, 'agent')
    assert.equal(row.hasAvatar, true)
    assert.equal(row.installed, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('detail / agent-md / avatar / file endpoints serve and stay within the expert dir', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-experts-detail-'))
  try {
    const builtin = join(root, 'builtin', 'experts')
    await mkdir(builtin, { recursive: true })
    await writeExpert(builtin, 'backend-architect', { avatar: true, skills: ['fullstack-dev'] })

    const env = setupPlugin({ builtinRepoDir: join(root, 'builtin'), installedDir: join(root, 'installed') })

    const detail = await env.call('GET', '/experts-management/api/detail?name=backend-architect&source=builtin')
    assert.equal(detail.status, 200)
    assert.equal(detail.payload.expertType, 'agent')
    assert.equal(detail.payload.leadAgentFile, 'backend-architect')
    assert.equal(detail.payload.fileCount, 5) // plugin.json + agent md + SKILL.md + reference.md + 头像
    assert.ok(detail.payload.dir.length > 0)

    const md = await env.call('GET', '/experts-management/api/agent-md?name=backend-architect&source=builtin')
    assert.equal(md.status, 200)
    assert.equal(md.payload.agent, 'backend-architect')
    assert.match(md.payload.content, /完整角色定义/)

    const scoped = await env.call('GET', `/experts-management/api/agent-md?name=backend-architect&source=builtin&agent=${encodeURIComponent('agents/backend-architect.md')}`)
    assert.equal(scoped.status, 200)

    const avatar = await env.callRaw('GET', '/experts-management/api/avatar?name=backend-architect&source=builtin')
    assert.equal(avatar.status, 200)
    assert.equal(avatar.body, 'PNGBYTES')

    const file = await env.callRaw('GET', '/experts-management/api/file?name=backend-architect&source=builtin&path=skills%2Ffullstack-dev%2Freference.md')
    assert.equal(file.status, 200)
    assert.equal(file.body, 'extra file')

    // 越界路径被拒
    const escape = await env.call('GET', '/experts-management/api/file?name=backend-architect&source=builtin&path=..%2F..%2Fescape.md')
    assert.equal(escape.status, 400)
    // 未知专家 400
    const missing = await env.call('GET', '/experts-management/api/detail?name=nope')
    assert.equal(missing.status, 400)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('install copies into the dsh library and shadows the builtin row; delete removes only from dsh', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-experts-install-'))
  try {
    const builtin = join(root, 'builtin', 'experts')
    await mkdir(builtin, { recursive: true })
    await writeExpert(builtin, 'backend-architect', { skills: ['fullstack-dev'] })
    const installed = join(root, 'installed')
    await mkdir(installed, { recursive: true })
    await writeExpert(installed, 'local-only')

    const env = setupPlugin({ builtinRepoDir: join(root, 'builtin'), installedDir: installed })

    const res = await env.call('POST', '/experts-management/api/install', { name: 'backend-architect', source: 'builtin' })
    assert.equal(res.status, 201)
    await stat(join(installed, 'backend-architect', '.codebuddy-plugin', 'plugin.json'))
    await stat(join(installed, 'backend-architect', 'skills', 'fullstack-dev', 'SKILL.md'))
    assert.ok(env.getInvalidations() >= 1)

    // 已装后：installed 桶出现且市场行 installed=true；重复安装拒绝
    const list = await env.call('GET', '/experts-management/api')
    assert.ok(list.payload.mine.some((e) => e.name === 'backend-architect'))
    assert.ok(list.payload.builtin.find((e) => e.name === 'backend-architect').installed)
    const dup = await env.call('POST', '/experts-management/api/install', { name: 'backend-architect', source: 'builtin' })
    assert.equal(dup.status, 400)
    assert.match(dup.payload.error, /already installed/)
    const over = await env.call('POST', '/experts-management/api/install', { name: 'backend-architect', source: 'builtin', overwrite: true })
    assert.equal(over.status, 201)

    // 删除：仅对 dsh 用户库生效
    const del = await env.call('DELETE', '/experts-management/api', { name: 'backend-architect' })
    assert.equal(del.status, 200)
    await assert.rejects(stat(join(installed, 'backend-architect')))
    const delMissing = await env.call('DELETE', '/experts-management/api', { name: 'backend-architect' })
    assert.equal(delMissing.status, 400)
    // 非法名拒绝
    const bad = await env.call('DELETE', '/experts-management/api', { name: '../escape' })
    assert.equal(bad.status, 400)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// ── Builtin git sync（稀疏 experts/ 子树）─────────────────────────────────

const git = (args, cwd) => new Promise((fulfil, reject) => {
  execFileCb('git', args, { cwd }, (error, stdout, stderr) => {
    if (error) reject(new Error(`git ${args.join(' ')}: ${stderr || error.message}`)); else fulfil(stdout)
  })
})

async function makeRemoteRepo(dir) {
  await mkdir(join(dir, 'skills', 'demo'), { recursive: true })
  await writeFile(join(dir, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\n---\nS')
  await writeExpert(join(dir, 'experts'), 'backend-architect')
  await mkdir(join(dir, 'templates'), { recursive: true })
  await writeFile(join(dir, 'templates', 'a.yaml'), 'x: 1')
  await git(['init', '-q', '-b', 'main', '.'], dir)
  await git(['config', 'user.email', 't@t'], dir)
  await git(['config', 'user.name', 't'], dir)
  await git(['add', '-A'], dir)
  await git(['commit', '-qm', 'init'], dir)
}

test('builtin sync sparse-clones only the experts subtree; runtime repoDir switch follows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-experts-sync-'))
  try {
    const remote = join(root, 'remote')
    await makeRemoteRepo(remote)
    const local = join(root, 'local')

    const env = setupPlugin({
      installedDir: join(root, 'installed'),
      builtinRepoDir: local,
      builtinSync: { url: remote, branch: 'main', syncOnStartup: false, autoSync: false },
    })

    const first = await env.call('POST', '/experts-management/api/builtin/sync')
    assert.equal(first.status, 200)
    assert.equal(first.payload.isFirstClone, true)
    // experts 子树落地；skills/templates 被稀疏排除
    await stat(join(local, 'experts', 'backend-architect', '.codebuddy-plugin', 'plugin.json'))
    await assert.rejects(stat(join(local, 'skills')))
    await assert.rejects(stat(join(local, 'templates')))

    const st = await env.call('GET', '/experts-management/api/builtin/status')
    assert.equal(st.status, 200)
    assert.deepEqual(st.payload.sparsePaths, ['experts'])
    assert.equal(st.payload.repoExists, true)

    // 市场专家可见可装
    const list = await env.call('GET', '/experts-management/api')
    assert.ok(list.payload.builtin.some((e) => e.name === 'backend-architect'))

    // 远端更新 → fetch+reset 照常
    await writeExpert(join(remote, 'experts'), 'second-expert')
    await git(['add', '-A'], remote)
    await git(['commit', '-qm', 'add second'], remote)
    const second = await env.call('POST', '/experts-management/api/builtin/sync')
    assert.equal(second.status, 200)
    assert.equal(second.payload.hasUpdates, true)
    const list2 = await env.call('GET', '/experts-management/api')
    assert.ok(list2.payload.builtin.some((e) => e.name === 'second-expert'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// ── 编辑端点（v0.3）：agent-md / metadata / expert-skills / avatar ──────

const PNG_BUF = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)])

async function setupInstalledExpert({ withBundledSkill = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-experts-edit-'))
  const builtin = join(root, 'builtin', 'experts')
  await mkdir(builtin, { recursive: true })
  await writeExpert(builtin, 'backend-architect', { skills: withBundledSkill ? ['fullstack-dev'] : [] })
  const installed = join(root, 'installed')
  const env = setupPlugin(
    { builtinRepoDir: join(root, 'builtin'), installedDir: installed },
      [],
  )
  const ins = await env.call('POST', '/experts-management/api/install', { name: 'backend-architect', source: 'builtin' })
  assert.equal(ins.status, 201)
  return { root, env, installed, builtin }
}

test('agent-md PUT 更新角色定义并触发失效；未知 agent / 未安装专家拒绝', async () => {
  const { root, env, installed } = await setupInstalledExpert()
  try {
    const res = await env.call('PUT', '/experts-management/api/agent-md', { name: 'backend-architect', content: '---\nname: backend-architect\ndescription: 改过的角色\n---\n\n新角色定义全文' })
    assert.equal(res.status, 200)
    assert.ok(env.getInvalidations() >= 1)
    const onDisk = await readFile(join(installed, 'backend-architect', 'agents', 'backend-architect.md'), 'utf8')
    assert.match(onDisk, /新角色定义全文/)
    const bad = await env.call('PUT', '/experts-management/api/agent-md', { name: 'backend-architect', agent: 'ghost', content: 'x' })
    assert.equal(bad.status, 400)
    const missing = await env.call('PUT', '/experts-management/api/agent-md', { name: 'not-installed', content: 'x' })
    assert.equal(missing.status, 400)
    const empty = await env.call('PUT', '/experts-management/api/agent-md', { name: 'backend-architect', content: '  ' })
    assert.equal(empty.status, 400)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('metadata PUT 更新展示字段并保留未知键；形状非法拒绝', async () => {
  const { root, env, installed } = await setupInstalledExpert()
  try {
    // 预埋一个未知键，验证读-改-写不丢
    const pjPath = join(installed, 'backend-architect', '.codebuddy-plugin', 'plugin.json')
    const pj = JSON.parse(await readFile(pjPath, 'utf8'))
    pj.customFutureKey = 'keep-me'
    await writeFile(pjPath, JSON.stringify(pj))
    const res = await env.call('PUT', '/experts-management/api/metadata', { name: 'backend-architect', metadata: {
      displayName: { zh: '我的后端专家', en: 'My Backend' },
      tags: [{ zh: '后端', en: 'Backend' }, { zh: '架构', en: '' }],
    } })
    assert.equal(res.status, 200)
    const after = JSON.parse(await readFile(pjPath, 'utf8'))
    assert.equal(after.displayName.zh, '我的后端专家')
    assert.equal(after.customFutureKey, 'keep-me')
    assert.deepEqual(after.tags.map((t) => t.zh), ['后端', '架构'])
    // 原有其它字段保留（profession 未传不动）
    assert.equal(after.profession.zh, '后端架构师')
    const bad = await env.call('PUT', '/experts-management/api/metadata', { name: 'backend-architect', metadata: { tags: 'not-an-array' } })
    assert.equal(bad.status, 400)
    const tooMany = await env.call('PUT', '/experts-management/api/metadata', { name: 'backend-architect', metadata: { tags: Array.from({ length: 21 }, () => ({ zh: 'x' })) } })
    assert.equal(tooMany.status, 400)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('expert-skills PUT：attach 从用户技能库复制副本、detach 删除副本，plugin.json.skills 同步；缺失整体拒绝', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-experts-lib2-'))
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  let root
  let env
  let installed
  try {
    const lib = join(home, 'skills')
    await mkdir(join(lib, 'fullstack-dev'), { recursive: true })
    await writeFile(join(lib, 'fullstack-dev', 'SKILL.md'), '---\nname: fullstack-dev\ndescription: 全栈技能\n---\n')
    ;({ root, env, installed } = await setupInstalledExpert({ withBundledSkill: true }))
    // 初始：安装时带了一个 fullstack-dev 副本（来自内置），先 detach 验证删除
    const before = JSON.parse(await readFile(join(installed, 'backend-architect', '.codebuddy-plugin', 'plugin.json'), 'utf8'))
    assert.deepEqual(before.skills, ['./skills/fullstack-dev'])
    const det = await env.call('PUT', '/experts-management/api/expert-skills', { name: 'backend-architect', detach: ['fullstack-dev'] })
    assert.equal(det.status, 200)
    assert.deepEqual(det.payload.skills, [])
    await assert.rejects(readFile(join(installed, 'backend-architect', 'skills', 'fullstack-dev', 'SKILL.md')))
    // detach 未附技能 → 400
    const detMiss = await env.call('PUT', '/experts-management/api/expert-skills', { name: 'backend-architect', detach: ['fullstack-dev'] })
    assert.equal(detMiss.status, 400)
    // attach：从注册表快照解析的源目录复制副本
    const att = await env.call('PUT', '/experts-management/api/expert-skills', { name: 'backend-architect', attach: ['fullstack-dev'] })
    assert.equal(att.status, 200)
    assert.deepEqual(att.payload.skills, ['./skills/fullstack-dev'])
    const copied = await readFile(join(installed, 'backend-architect', 'skills', 'fullstack-dev', 'SKILL.md'), 'utf8')
    assert.match(copied, /name: fullstack-dev/)
    // 技能库缺失 → 400 且无半套变更
    const attMiss = await env.call('PUT', '/experts-management/api/expert-skills', { name: 'backend-architect', attach: ['ghost-skill'] })
    assert.equal(attMiss.status, 400)
    const pjNow = JSON.parse(await readFile(join(installed, 'backend-architect', '.codebuddy-plugin', 'plugin.json'), 'utf8'))
    assert.deepEqual(pjNow.skills, ['./skills/fullstack-dev'])
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
    await rm(root, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  }
})

test('avatar POST 写入 avatars/ 并更新 plugin.json.avatar；junk 拒绝', async () => {
  const { root, env, installed } = await setupInstalledExpert()
  try {
    const res = await env.callRaw('POST', '/experts-management/api/avatar?name=backend-architect', PNG_BUF)
    assert.equal(res.status, 200)
    const pj = JSON.parse(await readFile(join(installed, 'backend-architect', '.codebuddy-plugin', 'plugin.json'), 'utf8'))
    assert.equal(pj.avatar, 'avatars/expert.png')
    const stored = await readFile(join(installed, 'backend-architect', 'avatars', 'expert.png'))
    assert.ok(stored.equals(PNG_BUF))
    const junk = await env.callRaw('POST', '/experts-management/api/avatar?name=backend-architect', Buffer.from('junk-junk-junk'))
    assert.equal(junk.status, 400)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('available-skills GET 返回用户技能库清单（dshHome 隔离）', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-experts-lib-'))
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const lib = join(home, 'skills')
    await mkdir(join(lib, 'agent-browser-core'), { recursive: true })
    await writeFile(join(lib, 'agent-browser-core', 'SKILL.md'), '---\nname: agent-browser-core\ndescription: 浏览器技能\n---\n')
    await mkdir(join(lib, 'fullstack-dev'), { recursive: true })
    await writeFile(join(lib, 'fullstack-dev', 'SKILL.md'), '---\nname: fullstack-dev\ndescription: 全栈技能\n---\n')
    const { root, env } = await setupInstalledExpert()
    const res = await env.call('GET', '/experts-management/api/available-skills')
    assert.equal(res.status, 200)
    assert.deepEqual(res.payload.skills, [
      { name: 'agent-browser-core', description: '浏览器技能' },
      { name: 'fullstack-dev', description: '全栈技能' },
    ])
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
    await rm(home, { recursive: true, force: true })
  }
})
