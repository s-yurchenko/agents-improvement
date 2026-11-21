import { handleHook } from './loader.mjs';

const agent = process.argv[2];
try {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('Слишком большое событие хука.');
    chunks.push(chunk);
  }
  const event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  process.stdout.write(JSON.stringify(await handleHook(event, agent)) + '\n');
} catch (error) {
  process.stdout.write(JSON.stringify({ systemMessage: `Инструкции агента: ${error.message}`, ...(agent === 'codex' ? { continue: false } : {}) }) + '\n');
}
