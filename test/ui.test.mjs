import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// Plain-Node 契约测试：client/index.js 自带 React/primitives shim，可直接 require
const client = require('../client/index.js')
const { NS, ZH, EN, matchExpert, avatarUrl, EXPERT_SOURCE_NAME, makeExpertSource, openTriggerSource, toRosterRows, insertComposerText, splitRosterByType, pickerRowMatch } = client.__internals

test('client exports the browser-plane contract', () => {
  assert.equal(client.name, '@weibaohui/experts-management')
  assert.deepEqual(client.inject, ['slots', 'locale'])
  assert.equal(typeof client.apply, 'function')
  assert.equal(typeof client.__boot, 'function')
})

test('zh/en locale dictionaries cover the same key set', () => {
  const zhKeys = Object.keys(ZH).sort()
  const enKeys = Object.keys(EN).sort()
  assert.deepEqual(zhKeys, enKeys)
  assert.ok(zhKeys.length > 20)
})

test('apply registers dictionaries and all slot entries', () => {
  const locales = []
  const injected = []
  const ctx = {
    locale: {
      register: (ns, lang, dict) => locales.push({ ns, lang, dict }),
      bind: () => null,
    },
    slots: {
      inject: (name, factory) => injected.push(name),
    },
    effect: (fn) => fn(),
    inject: (services, fn) => fn({}),
  }
  client.apply(ctx)
  const own = locales.filter((l) => l.ns === NS)
  assert.deepEqual(own.map((l) => l.lang).sort(), ['en', 'zh'])
  assert.ok(own.length >= 2)
  // slash.menu 组标题（expert 源的中英文案）也一并注册
  const menuNs = locales.filter((l) => l.ns === 'slash.menu')
  assert.deepEqual(menuNs.map((l) => l.lang).sort(), ['en', 'zh'])
  assert.equal(menuNs[0].dict[EXPERT_SOURCE_NAME] !== undefined, true)
  assert.deepEqual(injected, ['settings.section', 'conversation.input.left'])
})

test('apply survives a missing locale service (EN fallback)', () => {
  const injected = []
  client.apply({
    slots: { inject: (name) => injected.push(name) },
    effect: (fn) => fn(),
  })
  assert.equal(injected.length, 2)
})

test('expert trigger source: candidates filtered by query, section replaces group title, pick inserts token', async () => {
  const t = (k) => ({ menuGroup: '专家' })[k] ?? k
  // 冷态断言必须先于预热：roster 是模块级缓存，跨 source 实例共享
  const cold = makeExpertSource(t)
  assert.equal(cold.lexicon({}), undefined)
  assert.deepEqual(await cold.candidates({}, { query: '', signal: new AbortController().signal }), [])

  // stub fetch：预热 roster（真 fetch 的相对 URL 在 node 下会失败）
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ installed: [{ name: 'backend-architect', description: '后端', expertType: 'agent' }], market: [] }),
  })
  try {
    const source = makeExpertSource(t)
    assert.equal(source.trigger, '/')
    assert.equal(source.name, EXPERT_SOURCE_NAME)
    await client.__internals.fetchRoster(true)
    const rows = await source.candidates({}, { query: 'expert-backend', signal: new AbortController().signal })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].name, 'expert-backend-architect')
    assert.equal(rows[0].section, '专家') // 取代 'expert' 源标题行
    assert.deepEqual(source.onPick({ candidate: rows[0] }), { text: '/expert-backend-architect ' })
    assert.deepEqual(source.lexicon({}), ['expert-backend-architect'])
  } finally {
    globalThis.fetch = realFetch
  }
})

test('openTriggerSource toggles via sessionOf with a synthetic end-of-draft span', () => {
  const calls = []
  const scope = {
    sessions: { scope: (id) => ({ id }) },
    inputTriggers: {
      sessionOf: (actx) => ({
        toggleSource: (name, hit) => calls.push({ name, hit, actx }),
      }),
    },
  }
  const input = { draft: '帮我看看', draftRev: 7 }
  const ok = openTriggerSource(scope, 'session-1', input, EXPERT_SOURCE_NAME)
  assert.equal(ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, EXPERT_SOURCE_NAME)
  assert.equal(calls[0].actx.id, 'session-1')
  assert.equal(calls[0].hit.trigger, '/')
  assert.equal(calls[0].hit.query, '')
  assert.equal(calls[0].hit.position, 'inline') // 草稿非空 → inline
  assert.deepEqual(calls[0].hit.span, { start: 4, end: 4, draftRev: 7 })

  // 空草稿 → leading；服务缺席 → false
  openTriggerSource(scope, 'session-1', { draft: '', draftRev: 1 }, EXPERT_SOURCE_NAME)
  assert.equal(calls[1].hit.position, 'leading')
  assert.equal(openTriggerSource(null, 's', input, EXPERT_SOURCE_NAME), false)
  assert.equal(openTriggerSource({ sessions: {} }, 's', input, EXPERT_SOURCE_NAME), false)
  // scope 不可解析 → false
  assert.equal(openTriggerSource({ sessions: { scope: () => undefined }, inputTriggers: { sessionOf: () => ({}) } }, 's', input, EXPERT_SOURCE_NAME), false)
})

test('matchExpert searches name/displayName/profession/description/tags', () => {
  const row = { name: 'backend-architect', displayName: '磐石石', profession: '后端架构师', description: '分布式系统', tags: ['微服务'] }
  assert.equal(matchExpert(row, '磐石'), true)
  assert.equal(matchExpert(row, 'microservice'.toLowerCase()) || matchExpert(row, '微服务'), true)
  assert.equal(matchExpert(row, 'kubernetes'), false)
  assert.equal(matchExpert(row, ''), true)
})

test('avatarUrl builds the encoded API url, member optional', () => {
  assert.equal(avatarUrl('backend-architect', 'market'), '/experts-management/api/avatar?name=backend-architect&source=market')
  // URLSearchParams 把空格编成 '+'，服务端 URL.searchParams 解码回空格
  assert.equal(avatarUrl('a b', 'extra-src', 'lead-a'), '/experts-management/api/avatar?name=a+b&source=extra-src&member=lead-a')
})

test('toRosterRows surfaces the displayName, flags teams, sorts by displayName', () => {
  const rows = toRosterRows(
    [{ name: 'plain', description: 'no display name' },
     { name: 'backend-architect', displayName: '磐石', description: '分布式系统', expertType: 'agent' }],
    [{ name: 'review-team', displayName: '评审专家组', expertType: 'team', profession: '代码评审' }],
  )
  assert.equal(rows.length, 3)
  // 按显示名 zh 排序：磐石(pan) < 评审(ping) < plain（拉丁排中文后）
  assert.deepEqual(rows.map((r) => r.displayName), ['磐石', '评审专家组', 'plain'])
  // pick 字面量保持 expert-<id>；displayName 前缀进描述供宿主菜单行展示
  assert.equal(rows[0].name, 'expert-backend-architect')
  assert.equal(rows[0].displayName, '磐石')
  assert.equal(rows[0].description, '磐石 · 分布式系统')
  assert.equal(rows[0].plainDescription, '分布式系统')
  assert.equal(rows[0].icon, '🧑‍💼')
  assert.equal(rows[0].team, false)
  // 专家团：图标 + team 标记 + 显示名
  assert.equal(rows[1].icon, '👥')
  assert.equal(rows[1].team, true)
  assert.equal(rows[1].description, '评审专家组 · 代码评审')
  // 无 displayName → 回退内部名，描述原样不重复前缀
  assert.equal(rows[2].displayName, 'plain')
  assert.equal(rows[2].description, 'no display name')
  // 非数组输入按空处理，不抛错
  assert.deepEqual(toRosterRows(undefined, null), [])
})

test('splitRosterByType separates single experts from teams, sorted order preserved', () => {
  const rows = toRosterRows(
    [{ name: 'a', displayName: '甲' }, { name: 'b', displayName: '乙', expertType: 'team' }],
    [{ name: 'c', displayName: '丙', expertType: 'team' }, { name: 'd', displayName: '丁' }],
  )
  // toRosterRows 已按拼音排序：丙(b) < 丁(d) < 甲(j) < 乙(y)
  const { agents, teams } = splitRosterByType(rows)
  assert.deepEqual(agents.map((r) => r.displayName), ['丁', '甲'])
  assert.deepEqual(teams.map((r) => r.displayName), ['丙', '乙'])
  // 空/非法输入 → 两个空组
  assert.deepEqual(splitRosterByType(null), { agents: [], teams: [] })
  assert.deepEqual(splitRosterByType(undefined), { agents: [], teams: [] })
})

test('pickerRowMatch searches displayName/description but not the expert- prefix', () => {
  const row = { name: 'expert-review-team', displayName: '评审专家组', plainDescription: '代码评审' }
  assert.equal(pickerRowMatch(row, '评审'), true)
  assert.equal(pickerRowMatch(row, 'review-team'), true)
  // 'expert' 前缀不参与匹配：搜 expert 不该命中全部
  assert.equal(pickerRowMatch(row, 'expert'), false)
  assert.equal(pickerRowMatch(row, 'kubernetes'), false)
})

test('insertComposerText bails slash/input-insert-text with an end-of-draft span', () => {
  const calls = []
  const scope = { sessions: { scope: (id) => ({ id, bail(...args) { calls.push(args); return true } }) } }
  const ok = insertComposerText(scope, 's1', { draft: '你好', draftRev: 5 }, '/expert-a ')
  assert.equal(ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1], 'slash/input-insert-text')
  assert.deepEqual(calls[0][2], { text: '/expert-a ', span: { start: 2, end: 2, draftRev: 5 } })
  // bail 未被认领（返回值非 true）→ false；服务缺席 / scope 抛错 → false，无副作用
  assert.equal(insertComposerText({ sessions: { scope: () => ({ bail: () => undefined }) } }, 's', {}, '/x '), false)
  assert.equal(insertComposerText(null, 's', {}, '/x '), false)
  assert.equal(insertComposerText({ sessions: { scope: () => { throw new Error('x') } } }, 's', {}, '/x '), false)
  assert.equal(insertComposerText({ sessions: { scope: () => null } }, 's', {}, '/x '), false)
})
