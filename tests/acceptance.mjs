import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { preview } from 'vite'

// Exercise the built React UI with real temporary files behind a test-only IPC bridge.
const root = await mkdtemp(join(tmpdir(), 'irc-log-studio-'))
const workspaceFile = join(root, 'workspace.json')
const templateFile = join(root, 'classic.json')
const classic = await readFile(new URL('../src/templates/classic.json', import.meta.url), 'utf8')
const minimal = await readFile(new URL('../src/templates/minimal.json', import.meta.url), 'utf8')
let dialogPath
let closed = false
let server
let browser

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function write(path, text, backup) {
  if (backup) {
    const previous = await readOptional(path)
    if (previous !== null) await writeFile(path + '.bak', previous, 'utf8')
  }
  await writeFile(path, text, 'utf8')
}

try {
  await writeFile(templateFile, classic, 'utf8')
  server = await preview({ preview: { host: '127.0.0.1', port: 0 } })
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`
  browser = await chromium.launch({ channel: process.env.IRC_STUDIO_BROWSER ?? 'msedge' })
  const context = await browser.newContext({ viewport: { width: 1360, height: 870 } })
  await context.exposeBinding('testInvoke', async (_source, command, args) => {
    switch (command) {
      case 'read_workspace': return readOptional(workspaceFile + (args.backup ? '.bak' : ''))
      case 'save_workspace': return write(workspaceFile, args.text, !args.keepBackup)
      case 'read_document': return readFile(args.path, 'utf8')
      case 'write_document': return write(args.path, args.text, args.backup)
      case 'list_templates': return [
        { id: 'classic.json', text: await readFile(templateFile, 'utf8'), error: null },
        { id: 'minimal.json', text: minimal, error: null },
      ]
      case 'plugin:dialog|open':
      case 'plugin:dialog|save': return dialogPath
      case 'plugin:window|destroy': closed = true; return
      default: throw new Error(`Unexpected command ${command}`)
    }
  })
  await context.addInitScript(() => {
    const callbacks = new Map()
    const handlers = new Map()
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      transformCallback(callback) {
        const id = callbacks.size + 1
        callbacks.set(id, callback)
        return id
      },
      async invoke(command, args) {
        if (command === 'plugin:event|listen') {
          handlers.set(args.event, args.handler)
          return args.handler
        }
        return window.testInvoke(command, args)
      },
    }
    window.testClose = () => callbacks.get(handlers.get('tauri://close-requested'))({
      event: 'tauri://close-requested', id: 1, payload: null,
    })
  })

  let page = await context.newPage()
  const errors = []
  const openPage = async () => {
    page.setDefaultTimeout(8000)
    page.on('pageerror', (error) => errors.push(error))
    await page.goto(url)
    await page.getByRole('button', { name: '用户档案', exact: true }).waitFor()
  }
  const button = (name) => page.getByRole('button', { name, exact: true })
  const field = (name) => page.getByLabel(name).and(page.locator('input, select, textarea'))
  const dialog = () => page.getByRole('dialog')
  const log = () => page.locator('.terminal-scroll')
  const row = (text) => log().getByRole('button').filter({ hasText: text })
  const channelButton = (name) => page.getByRole('navigation', { name: '频道列表' }).getByRole('button', { name })

  async function createChannel(name) {
    await page.getByRole('complementary', { name: '频道管理' }).getByRole('button', { name: '新建频道' }).click()
    await field('频道名称').fill(name)
    await button('确定').click()
    await page.getByRole('heading', { name, exact: true }).waitFor()
  }

  async function createUser(nick, ident = '', host = '') {
    await button('从档案库选择操作者').click()
    await field('搜索用户').fill(nick)
    await button('新建用户').click()
    assert.equal(await dialog().getByLabel('昵称', { exact: true }).inputValue(), nick)
    await dialog().getByLabel('Username / Ident', { exact: true }).fill(ident)
    await dialog().getByLabel('Hostname', { exact: true }).fill(host)
    await button('保存档案').click()
    assert.equal(await dialog().count(), 0)
  }

  async function exportCurrent(filename, { withTime = true, format = 'txt', scope = 'current', template } = {}) {
    dialogPath = join(root, filename)
    await button('导出').click()
    await field('文件格式').selectOption(format)
    await field('导出范围').selectOption(scope)
    if (format === 'txt' && !withTime) await field('包含时间戳').uncheck()
    if (format === 'txt' && template) await field('导出模板').selectOption(template)
    await button('选择路径并导出').click()
    await dialog().waitFor({ state: 'hidden' })
    return readFile(dialogPath, 'utf8')
  }

  await openPage()
  await button('用户档案').waitFor({ state: 'visible' })
  await page.locator('.project-menu summary').click()
  await button('新建项目 Ctrl+N').click()
  await field('项目名称').fill('Test Archive')
  await button('确定').click()
  await dialog().waitFor({ state: 'hidden' })
  await createChannel('#general')
  await field('事件类型').selectOption('JOIN')
  await createUser('Alice', '~alice', 'example.net')
  await button('添加事件').click()
  await row('Alice (~alice@example.net) has joined #general').waitFor()
  await createUser('Bob')
  await button('添加事件').click()
  await row('Bob has joined #general').waitFor()
  assert.equal(await page.locator('optgroup[label="当前频道成员"] option').count(), 2)
  await field('事件类型').selectOption('MESSAGE')
  await field('发送者').selectOption({ label: 'Alice' })
  const message = 'Hello <b>Bob</b>！中文 & {nick}'
  await field('消息内容').fill(message)
  await button('添加事件').click()
  await row(message).waitFor()
  assert.equal(await log().locator('b').count(), 0)
  assert.equal(await field('消息内容').inputValue(), '')
  await button('频道成员').click()
  await field('Bob 的初始等级').selectOption('v')
  await dialog().getByText('+Bob', { exact: true }).waitFor()
  await button('关闭弹窗').click()
  await field('事件类型').selectOption('MODE')
  await field('等级目标').selectOption({ label: 'Alice' })
  await button('添加等级变更').click()
  await field('等级目标').nth(1).selectOption({ label: '+Bob' })
  await button('切换到原始输入').click()
  assert.equal(await field('模式字符串').inputValue(), '+oo Alice Bob')
  await field('模式字符串').fill('+oh Alice Bob')
  await button('切换到等级操作').click()
  assert.equal(await page.getByRole('group', { name: '等级变更 2' }).locator('select').nth(1).inputValue(), 'h')
  await button('添加事件').click()
  await row('sets mode +oh Alice Bob').waitFor()
  assert.match(await row(message).innerText(), /<Alice>/)
  await field('事件类型').selectOption('ACTION')
  await field('动作内容').fill('waves at Bob')
  await page.locator('.draft-preview').getByText(/\* @Alice waves at Bob/).waitFor()
  await button('添加事件').click()
  await row('* @Alice waves at Bob').waitFor()
  await field('事件类型').selectOption('KICK')
  await field('目标用户').selectOption({ label: '%Bob' })
  const time = '2026-11-12T21:04:45'
  await field('日期与时间').fill(time)
  await field('原因或说明（可选）').fill('No spoilers!')
  await button('添加事件').click()
  await row('No spoilers!').waitFor()
  await field('原因或说明（可选）').fill('Unsubmitted draft')
  await row('No spoilers!').click()
  assert.equal(await row('No spoilers!').getAttribute('aria-pressed'), 'true')
  assert.equal(await field('日期与时间').inputValue(), time)
  await page.keyboard.press('Escape')
  assert.equal(await field('原因或说明（可选）').inputValue(), 'Unsubmitted draft')
  await row('No spoilers!').click()
  await field('原因或说明（可选）').fill('Please follow the rules.')
  await button('保存修改').click()
  assert.equal(await row('Please follow the rules.').innerText(), '[21:04:45] *** Bob was kicked by Alice (Please follow the rules.)')
  assert.equal(await row('No spoilers!').count(), 0)
  await field('事件类型').selectOption('QUIT')
  await field('操作者').selectOption({ label: '%Bob' })
  await field('原因或说明（可选）').fill('Quit: Goodbye!')
  await button('添加事件').click()
  await row('Bob has quit (Quit: Goodbye!)').waitFor()
  await createChannel('#archive')
  await field('发送者').selectOption({ label: 'Bob' })
  await field('消息内容').fill('Archive only')
  await button('添加事件').click()
  await row('Archive only').waitFor()
  assert.equal(await row(message).count(), 0)
  await channelButton(/#general/).click()
  await row(message).waitFor()
  assert.equal(await row('Archive only').count(), 0)

  const projectFile = join(root, 'Test Archive.irclogproj')
  dialogPath = projectFile
  await button('保存').click()
  await page.getByRole('status').filter({ hasText: '项目已保存' }).waitFor()
  const saved = await readFile(projectFile, 'utf8')
  const project = JSON.parse(saved)
  assert.deepEqual(project.users.map(({ nickname }) => nickname), ['Alice', 'Bob'])
  assert.deepEqual(project.channels.map(({ name, events }) => [name, events.length]), [['#general', 7], ['#archive', 1]])
  assert.equal(project.schemaVersion, 2)
  assert.deepEqual(project.channels[0].initialModes[project.users[1].id], ['v'])
  assert.deepEqual(project.channels[0].events.find(({ type }) => type === 'MODE').changes.map(({ mode }) => mode), ['o', 'h'])
  assert.equal(project.channels[0].events.find(({ type }) => type === 'KICK').timestamp, time)
  await channelButton(/#archive/).click()
  await page.evaluate(() => window.testClose())
  assert.equal(closed, true)
  await page.close()
  page = await context.newPage()
  await openPage()
  await row('Archive only').waitFor()
  await channelButton(/#general/).click()
  await row(message).waitFor()
  await row('* @Alice waves at Bob').waitFor()
  assert.equal(await page.getByRole('heading', { name: '#general' }).count(), 1)
  const withTime = await exportCurrent('with-time.txt')
  const withoutTime = await exportCurrent('without-time.txt', { withTime: false })
  assert.match(withTime, /^\[\d{2}:\d{2}:\d{2}\] --> Alice/)
  assert.match(withoutTime, /^--> Alice/)
  assert.ok(withTime.includes(message))
  assert.ok(withTime.includes('* @Alice waves at Bob'))
  assert.ok(!withoutTime.includes('Archive only'))
  const json = await exportCurrent('all.json', { format: 'json', scope: 'all' })
  assert.deepEqual(JSON.parse(json), project)
  const minimalTxt = await exportCurrent('minimal.txt', { withTime: false, template: 'minimal.json' })
  assert.match(minimalTxt, /^\+ Alice \(~alice@example.net\) → #general/)
  await field('日志模板').selectOption('minimal.json')
  await row('Alice › Hello').waitFor()
  await row('· Alice waves at Bob').waitFor()
  await field('日志模板').selectOption('classic.json')

  const modified = JSON.parse(classic)
  modified.events.join = '++ {nick} entered {channel}{hostmaskPart}'
  await writeFile(templateFile, JSON.stringify(modified), 'utf8')
  await button('重新加载模板').click()
  await row('++ Alice entered #general').waitFor()
  assert.match(await exportCurrent('updated.txt'), /\] \+\+ Alice entered #general/)
  assert.equal(await readFile(projectFile, 'utf8'), saved)
  const workspaceProject = JSON.parse(await readFile(workspaceFile, 'utf8')).project
  assert.deepEqual({ ...workspaceProject, templateId: project.templateId }, project)

  await writeFile(templateFile, '{', 'utf8')
  await button('重新加载模板').click()
  await page.getByRole('alert').filter({ hasText: 'classic.json' }).waitFor()
  assert.equal(await row('++ Alice entered #general').count(), 1)
  await row('Please follow the rules.').click()
  await button('删除事件').click()
  await button('确认删除').click()
  assert.equal(await row('Please follow the rules.').count(), 0)
  page.once('dialog', (prompt) => prompt.accept())
  dialogPath = projectFile
  await page.keyboard.press('Control+o')
  await row('Please follow the rules.').waitFor()
  await row('sets mode +oh Alice Bob').click()
  await field('等级目标').first().selectOption({ label: '%Bob' })
  await button('保存修改').click()
  await row('sets mode +oh Bob Bob').waitFor()
  await row('* Alice waves at Bob').waitFor()
  await row('sets mode +oh Bob Bob').click()
  await button('删除事件').click()
  await button('确认删除').click()
  assert.equal(await row('sets mode +oh Bob Bob').count(), 0)
  await button('频道成员').click()
  await dialog().getByText('+Bob', { exact: true }).waitFor()
  await button('关闭弹窗').click()

  await button('重命名').click()
  await field('频道名称').fill('#renamed')
  await button('确定').click()
  await page.getByRole('heading', { name: '#renamed' }).waitFor()
  await button('删除频道').click()
  await button('确认删除').click()
  await page.getByRole('heading', { name: '#archive' }).waitFor()
  assert.equal(await row('Archive only').count(), 1)
  const copyFile = join(root, 'copy.irclogproj')
  dialogPath = copyFile
  await page.keyboard.press('Control+Shift+s')
  await page.getByRole('status').filter({ hasText: 'copy.irclogproj' }).waitFor()
  const copy = JSON.parse(await readFile(copyFile, 'utf8'))
  assert.deepEqual(copy.channels.map(({ name }) => name), ['#archive'])
  assert.equal(await readFile(projectFile, 'utf8'), saved)

  if (process.env.IRC_STUDIO_SCREENSHOT) {
    await writeFile(templateFile, classic, 'utf8')
    await button('重新加载模板').click()
    await page.getByRole('status').filter({ hasText: '已重新加载本地模板' }).waitFor()
    dialogPath = new URL('../examples/Studio-demo.irclogproj', import.meta.url)
    dialogPath = (await import('node:url')).fileURLToPath(dialogPath)
    await page.keyboard.press('Control+o')
    await row('Server restart in 10 minutes.').waitFor()
    await button('关闭通知').click()
    await page.screenshot({ path: process.env.IRC_STUDIO_SCREENSHOT })
  }
  assert.deepEqual(errors, [])
  console.log('Passed UI acceptance: project, profiles, channels, event editing, recovery, exports and template reload.')
} finally {
  await browser?.close()
  await server?.close()
  for (const file of await readdir(root)) await unlink(join(root, file))
  await rmdir(root)
}
