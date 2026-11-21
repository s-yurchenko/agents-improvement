import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, link, unlink, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const MAX_BYTES = 24 * 1024;
const DEFAULT_SOURCE = 'https://github.com/s-yurchenko/agents-improvement.git';
const OPTIONAL_FILES = { graphify: 'prompts/optional/graphify.md' };
const hash = value => createHash('sha256').update(value).digest('hex');

async function json(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`Не удалось прочитать JSON: ${file}`, { cause: error });
  }
}

async function atomicJson(file, value, firstWriterWins = false) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  try {
    if (firstWriterWins) {
      try { await link(temporary, file); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    } else {
      await rename(temporary, file);
    }
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function git(args, { cwd, timeout = 8000, maxBuffer = 64 * 1024 } = {}) {
  try {
    const { stdout } = await exec('git', args, {
      cwd, timeout, maxBuffer, encoding: 'buffer', windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    });
    return stdout;
  } catch (error) {
    // Вывод ошибок Git может содержать адреса с учётными данными; не передаём его в контекст и интерфейс.
    throw new Error(error.killed ? 'Git: превышено время ожидания.' : 'Git: команда получения данных завершилась ошибкой.');
  }
}

function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Конфиг должен быть JSON-объектом.');
  for (const key of Object.keys(config)) {
    if (!['repository', 'branch'].includes(key)) throw new Error(`Неизвестная настройка: ${key}`);
  }
  const repository = config.repository ?? DEFAULT_SOURCE;
  const branch = config.branch ?? 'master';
  if (typeof repository !== 'string' || /[\r\n\0]/.test(repository)) throw new Error('Некорректный адрес репозитория.');
  if (!path.isAbsolute(repository)) {
    let url;
    try { url = new URL(repository); } catch { throw new Error('Источник должен быть HTTPS URL или абсолютным локальным путём.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('Для удалённого источника требуется HTTPS URL без встроенных учётных данных.');
    }
  }
  if (typeof branch !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(branch)
      || branch.includes('..') || branch.includes('//') || branch.endsWith('/') || branch.endsWith('.') || branch.endsWith('.lock')) {
    throw new Error('Некорректное имя ветки.');
  }
  return { repository, branch };
}

async function projectOptions(cwd) {
  let root = cwd;
  try { root = (await git(['rev-parse', '--show-toplevel'], { cwd, timeout: 2000 })).toString('utf8').trim(); }
  catch { /* Для проектов без Git используем рабочую папку чата. */ }
  const options = await json(path.join(root, '.agents', 'instructions.json'), {});
  if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some(key => key !== 'optional')
      || (options.optional !== undefined && !Array.isArray(options.optional))) {
    throw new Error('В .agents/instructions.json допустим только массив optional.');
  }
  const selected = [...new Set(options.optional ?? [])].sort();
  if (selected.some(name => !Object.hasOwn(OPTIONAL_FILES, name))) throw new Error('Неизвестное дополнение в optional.');
  return { root, selected };
}

function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.schema !== 1 || !/^[a-f0-9]{40,64}$/.test(snapshot.revision)
      || !Array.isArray(snapshot.files) || snapshot.files.length < 1 || snapshot.files.length > 2) {
    throw new Error('Повреждён сохранённый снимок инструкций.');
  }
  let size = 0;
  const allowed = new Set(['prompts/base.md', ...Object.values(OPTIONAL_FILES)]);
  for (const file of snapshot.files) {
    if (!allowed.has(file.path) || typeof file.text !== 'string' || !file.text.trim()
        || file.text.includes('\0') || file.sha256 !== hash(file.text)) {
      throw new Error('Не совпадает контрольная сумма сохранённых инструкций.');
    }
    size += Buffer.byteLength(file.text);
  }
  if (snapshot.files[0].path !== 'prompts/base.md' || new Set(snapshot.files.map(f => f.path)).size !== snapshot.files.length || size > MAX_BYTES) {
    throw new Error('Некорректный состав или размер снимка инструкций.');
  }
  return snapshot;
}

async function fetchSnapshot(dataDir, source, selected) {
  const temporaryRoot = path.resolve(dataDir, 'tmp');
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(path.join(temporaryRoot, 'fetch-'));
  try {
    await git(['init', '--bare', '--quiet', '--template=', directory]);
    await git(['-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '-C', directory,
      'fetch', '--quiet', '--depth=1', '--no-tags', '--', source.repository,
      `+refs/heads/${source.branch}:refs/heads/instructions`]);
    const revision = (await git(['-C', directory, 'rev-parse', 'refs/heads/instructions^{commit}'])).toString('utf8').trim();
    const files = [];
    for (const filePath of ['prompts/base.md', ...selected.map(name => OPTIONAL_FILES[name])]) {
      const entry = (await git(['-C', directory, 'ls-tree', revision, '--', filePath])).toString('utf8');
      if (!/^100(644|755) blob [a-f0-9]+\t/.test(entry)) throw new Error(`Инструкция отсутствует или не является обычным файлом: ${filePath}`);
      const bytes = await git(['-C', directory, 'show', `${revision}:${filePath}`], { maxBuffer: MAX_BYTES + 1 });
      const text = bytes.toString('utf8');
      if (!bytes.equals(Buffer.from(text))) throw new Error(`Некорректный UTF-8: ${filePath}`);
      files.push({ path: filePath, text, sha256: hash(text) });
    }
    return validateSnapshot({ schema: 1, source, revision, files, fetchedAt: new Date().toISOString() });
  } finally {
    // Удаляем только выделенный каталог со случайным именем внутри нашей временной папки.
    if (path.dirname(path.resolve(directory)) !== temporaryRoot || !path.basename(directory).startsWith('fetch-')) {
      throw new Error('Небезопасный путь временного каталога.');
    }
    await rm(directory, { recursive: true, force: true });
  }
}

function context(snapshot) {
  const metadata = `[agents-improvement]\nВерсия правил: ${snapshot.revision}\nВерсия закреплена за этим чатом.\n`;
  return metadata + snapshot.files.map(file => `\nФайл: ${file.path}\nSHA-256: ${file.sha256}\n\n${file.text}`).join('\n');
}

export async function loadInstructions(event, agent, env = process.env) {
  if (!['codex', 'claude'].includes(agent)) throw new Error('Неизвестный клиент.');
  if (!event || event.hook_event_name !== 'SessionStart'
      || typeof event.session_id !== 'string' || event.session_id.length < 1 || event.session_id.length > 256
      || typeof event.cwd !== 'string' || !path.isAbsolute(event.cwd)
      || !['startup', 'resume', 'clear', 'compact', 'fork'].includes(event.source)) {
    throw new Error('Некорректное событие SessionStart.');
  }
  const dataDir = env.AGENTS_IMPROVEMENT_DATA_DIR || env.PLUGIN_DATA || env.CLAUDE_PLUGIN_DATA
    || path.join(os.homedir(), '.cache', 'agents-improvement', agent);
  if (!path.isAbsolute(dataDir)) throw new Error('Каталог данных должен быть абсолютным путём.');
  const sessionFile = path.join(dataDir, 'sessions', agent, `${hash(event.session_id)}.json`);
  const existing = await json(sessionFile, null);
  if (existing !== null) {
    const snapshot = validateSnapshot(existing);
    return { snapshot, context: context(snapshot), status: 'pinned', warning: snapshot.warning };
  }
  if (['resume', 'compact'].includes(event.source)) {
    throw new Error('Для этого чата нет закреплённой версии инструкций. Открой новый чат для подключения правил.');
  }
  const configPath = env.AGENTS_IMPROVEMENT_CONFIG || path.join(dataDir, 'config.json');
  if (!path.isAbsolute(configPath)) throw new Error('Путь к конфигу должен быть абсолютным.');
  const source = validateConfig(await json(configPath, {}));
  const { root, selected } = await projectOptions(event.cwd);
  const cacheKey = hash(JSON.stringify({ source, selected }));
  const cacheFile = path.join(dataDir, 'last-good', `${cacheKey}.json`);
  let snapshot, warning;
  try {
    snapshot = await fetchSnapshot(dataDir, source, selected);
    await atomicJson(cacheFile, snapshot);
  } catch (error) {
    const cached = await json(cacheFile, null);
    if (cached === null) throw new Error(`Инструкции не загружены; сохранённой версии нет. ${error.message}`);
    snapshot = validateSnapshot(cached);
    warning = `Не удалось проверить обновления. Используется сохранённая версия ${snapshot.revision.slice(0, 12)}. ${error.message}`;
  }
  await atomicJson(sessionFile, { ...snapshot, projectRoot: root, selected, warning }, true);
  const pinned = validateSnapshot(await json(sessionFile));
  return { snapshot: pinned, context: context(pinned), status: pinned.warning ? 'cached' : 'fresh', warning: pinned.warning };
}

export async function handleHook(event, agent, env = process.env) {
  try {
    const result = await loadInstructions(event, agent, env);
    return {
      ...(result.warning ? { systemMessage: result.warning } : {}),
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: result.context },
    };
  } catch (error) {
    const message = `Инструкции агента: ${error.message}`;
    return {
      systemMessage: message,
      ...(agent === 'codex' ? { continue: false, stopReason: message } : {}),
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `Ошибка подключения общих инструкций. ${message}` },
    };
  }
}
