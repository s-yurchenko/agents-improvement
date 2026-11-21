import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, rename, readdir } from 'node:fs/promises';
import path from 'node:path';
import { loadInstructions, handleHook } from '../plugins/agent-instructions/scripts/loader.mjs';
import { fixture, repoRoot } from './fixtures.mjs';

const exec = promisify(execFile);
const A = '# Правила A\n\nТочный текст: ё, «кавычки», `код` и два  пробела.\n';
const B = '# Правила B\n\nНовая редакция для нового чата.\n';

async function setup(t) {
  const f = await fixture();
  t.after(() => f.cleanup());
  return f;
}

test('новые чаты получают обновления; продолжение, сжатие и перезапуск сохраняют исходный текст', async t => {
  const f = await setup(t);
  const shaA = f.publish(A);
  const first = await loadInstructions(f.event('chat-a'), 'codex', f.env);
  assert.equal(first.snapshot.revision, shaA);
  assert.equal(first.snapshot.files[0].text, A);
  const shaB = f.publish(B);
  assert.equal((await loadInstructions(f.event('chat-b'), 'codex', f.env)).snapshot.revision, shaB);
  for (const source of ['startup', 'resume', 'compact', 'clear']) {
    const old = await loadInstructions(f.event('chat-a', source), 'codex', f.env);
    assert.equal(old.snapshot.revision, shaA);
    assert.equal(old.context, first.context);
  }
  const child = exec(process.execPath, [path.join(repoRoot, 'plugins/agent-instructions/scripts/session-start.mjs'), 'codex'], {
    env: { ...process.env, ...f.env }, windowsHide: true,
  });
  child.child.stdin.end(JSON.stringify(f.event('chat-a', 'resume')));
  const { stdout, stderr } = await child;
  assert.equal(stderr, '');
  assert.equal(JSON.parse(stdout).hookSpecificOutput.additionalContext, first.context);
});

test('Graphify включается явно и закрепляется за чатом; неизвестные дополнения отклоняются', async t => {
  const f = await setup(t);
  f.publish(A);
  const plain = await loadInstructions(f.event('plain'), 'codex', f.env);
  assert.equal(plain.snapshot.files.length, 1);
  await mkdir(path.join(f.cwd, '.agents'));
  const settings = path.join(f.cwd, '.agents', 'instructions.json');
  await writeFile(settings, '{"optional":["graphify"]}');
  const extra = await loadInstructions(f.event('extra'), 'codex', f.env);
  assert.equal(extra.snapshot.files[1].path, 'prompts/optional/graphify.md');
  assert.equal((await loadInstructions(f.event('plain', 'resume'), 'codex', f.env)).snapshot.files.length, 1);
  await writeFile(settings, '{"optional":[]}');
  assert.equal((await loadInstructions(f.event('extra', 'compact'), 'codex', f.env)).snapshot.files.length, 2);
  await writeFile(settings, '{"optional":["../private"]}');
  await assert.rejects(loadInstructions(f.event('bad-option'), 'codex', f.env), /Неизвестное дополнение/);
});

test('без сети используется подходящий снимок с предупреждением; кэш другого состава не подставляется', async t => {
  const f = await setup(t);
  f.publish(A);
  const first = await loadInstructions(f.event('online'), 'codex', f.env);
  await rename(f.repository, `${f.repository}-offline`);
  const offline = await loadInstructions(f.event('offline'), 'codex', f.env);
  assert.equal(offline.status, 'cached');
  assert.match(offline.warning, /Не удалось проверить обновления/);
  assert.equal(offline.context, first.context);
  await mkdir(path.join(f.cwd, '.agents'));
  await writeFile(path.join(f.cwd, '.agents', 'instructions.json'), '{"optional":["graphify"]}');
  await assert.rejects(loadInstructions(f.event('offline-extra'), 'codex', f.env), /сохранённой версии нет/);
});

test('отсутствие кэша даёт явную ошибку; старые чаты без снимка не получают новые правила', async t => {
  const f = await setup(t);
  f.publish(A);
  for (const source of ['resume', 'compact']) {
    await assert.rejects(loadInstructions(f.event('old', source), 'codex', f.env), /Открой новый чат/);
  }
  await rename(f.repository, `${f.repository}-offline`);
  const codex = await handleHook(f.event('failed'), 'codex', f.env);
  assert.equal(codex.continue, false);
  assert.match(codex.systemMessage, /сохранённой версии нет/);
  const claude = await handleHook(f.event('failed'), 'claude', f.env);
  assert.equal(claude.continue, undefined);
  assert.match(claude.hookSpecificOutput.additionalContext, /Ошибка подключения/);
});

test('параллельные запуски одного чата получают один полный снимок', async t => {
  const f = await setup(t);
  f.publish(A);
  const results = await Promise.all(Array.from({ length: 4 }, () => loadInstructions(f.event('same-chat'), 'codex', f.env)));
  assert.equal(new Set(results.map(r => JSON.stringify(r.snapshot))).size, 1);
  assert.equal((await readdir(path.join(f.dataDir, 'sessions', 'codex'))).length, 1);
});

test('повреждённый снимок даёт явную ошибку без подмены версии чата', async t => {
  const f = await setup(t);
  f.publish(A);
  await loadInstructions(f.event('corrupt'), 'codex', f.env);
  const directory = path.join(f.dataDir, 'sessions', 'codex');
  const file = path.join(directory, (await readdir(directory))[0]);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  saved.files[0].text = B;
  await writeFile(file, JSON.stringify(saved));
  f.publish(B);
  await assert.rejects(loadInstructions(f.event('corrupt', 'resume'), 'codex', f.env), /контрольная сумма/);
});

test('символьные ссылки, пустые инструкции и превышение размера отклоняются', async t => {
  for (const [content, mode] of [['../../outside', '120000'], ['', '100644'], ['я'.repeat(25000), '100644']]) {
    const f = await setup(t);
    f.publish(content, '# Дополнение\n', mode);
    const result = await handleHook(f.event('invalid-file'), 'codex', f.env);
    assert.equal(result.continue, false);
    assert.match(result.systemMessage, /сохранённой версии нет/);
  }
});

test('настройки меняются только для новых чатов; адреса с учётными данными отклоняются', async t => {
  const f = await setup(t);
  f.publish(A);
  const first = await loadInstructions(f.event('existing'), 'codex', f.env);
  const config = path.join(f.dataDir, 'config.json');
  await writeFile(config, '{"repository":"https://user:secret@example.invalid/repo.git"}');
  assert.equal((await loadInstructions(f.event('existing', 'resume'), 'codex', f.env)).context, first.context);
  const output = await handleHook(f.event('new'), 'codex', f.env);
  assert.equal(output.continue, false);
  assert.ok(!JSON.stringify(output).includes('secret'));
  await writeFile(config, '{"branch":"master\n--upload-pack=bad"}');
  assert.equal((await handleHook(f.event('new-branch'), 'codex', f.env)).continue, false);
  await assert.rejects(loadInstructions(f.event('relative-config'), 'codex', {
    ...f.env, AGENTS_IMPROVEMENT_CONFIG: 'relative.json',
  }), /Путь к конфигу должен быть абсолютным/);
});

test('оба адаптера передают полный утверждённый текст инструкций репозитория', async t => {
  const f = await setup(t);
  const base = await readFile(path.join(repoRoot, 'prompts/base.md'), 'utf8');
  const graphify = await readFile(path.join(repoRoot, 'prompts/optional/graphify.md'), 'utf8');
  f.publish(base, graphify);
  await mkdir(path.join(f.cwd, '.agents'));
  await writeFile(path.join(f.cwd, '.agents', 'instructions.json'), '{"optional":["graphify"]}');
  for (const agent of ['codex', 'claude']) {
    const output = await handleHook(f.event(`actual-${agent}`), agent, f.env);
    assert.ok(output.hookSpecificOutput.additionalContext.includes(base));
    assert.ok(output.hookSpecificOutput.additionalContext.includes(graphify));
    assert.equal(output.systemMessage, undefined);
  }
});
