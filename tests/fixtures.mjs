import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const repoRoot = path.resolve(import.meta.dirname, '..');
export const artifactsRoot = path.join(repoRoot, '.test-artifacts');

export async function fixture() {
  await mkdir(artifactsRoot, { recursive: true });
  const root = await mkdtemp(path.join(artifactsRoot, 'test-'));
  const repository = path.join(root, 'source repository');
  const cwd = path.join(root, 'project with spaces');
  const dataDir = path.join(root, 'data');
  await mkdir(cwd);
  await mkdir(dataDir);
  execFileSync('git', ['init', '--quiet', '--template=', cwd], { windowsHide: true });
  execFileSync('git', ['init', '--bare', '--quiet', '--template=', repository], { windowsHide: true });
  await writeFile(path.join(dataDir, 'config.json'), JSON.stringify({ repository, branch: 'master' }));
  let sequence = 0;
  function publish(base, optional = '# Graphify\nДополнительные правила.\n', mode = '100644') {
    sequence++;
    // Только искусственные тестовые данные: без git commit, git push и изменений истории рабочего репозитория.
    const previous = sequence > 1
      ? execFileSync('git', ['-C', repository, 'rev-parse', 'refs/heads/master'], { encoding: 'utf8', windowsHide: true }).trim()
      : null;
    let input = `commit refs/heads/master\ncommitter Test Fixture <fixture@example.invalid> ${sequence} +0000\ndata 7\nfixture\n`;
    if (previous) input += `from ${previous}\n`;
    for (const [name, content, fileMode] of [['prompts/base.md', base, mode], ['prompts/optional/graphify.md', optional, '100644']]) {
      input += `M ${fileMode} inline ${name}\ndata ${Buffer.byteLength(content)}\n${content}\n`;
    }
    input += '\ndone\n';
    execFileSync('git', ['-C', repository, 'fast-import', '--quiet'], { input, windowsHide: true });
    return execFileSync('git', ['-C', repository, 'rev-parse', 'refs/heads/master'], { encoding: 'utf8', windowsHide: true }).trim();
  }
  return {
    root, repository, cwd, dataDir, publish,
    env: { AGENTS_IMPROVEMENT_DATA_DIR: dataDir },
    event: (id, source = 'startup') => ({ hook_event_name: 'SessionStart', session_id: id, cwd, source }),
    async cleanup() {
      if (path.dirname(path.resolve(root)) !== artifactsRoot || !path.basename(root).startsWith('test-')) throw new Error('Небезопасный путь удаления тестовых данных');
      await rm(root, { recursive: true, force: true });
    },
  };
}
