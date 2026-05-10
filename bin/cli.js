#!/usr/bin/env node
import { createRequire } from 'node:module';
import { init, update } from '../lib/install.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');
const cmd = process.argv[2];

const HELP = `eda — установка и обновление скилов eda-* для Claude Code и Codex CLI.

Использование:
  eda init     — выбрать целевые среды (Claude / Codex / обе) и установить скилы
  eda update   — обновить уже установленные скилы в текущем проекте
  eda --version — показать версию
  eda --help   — показать эту справку
`;

try {
  switch (cmd) {
    case 'init':
      await init({ cwd: process.cwd() });
      break;
    case 'update':
      await update({ cwd: process.cwd() });
      break;
    case '-v':
    case '--version':
      process.stdout.write(`${version}\n`);
      break;
    case undefined:
    case '-h':
    case '--help':
      process.stdout.write(HELP);
      break;
    default:
      process.stderr.write(`Неизвестная команда: ${cmd}\n\n${HELP}`);
      process.exit(1);
  }
} catch (err) {
  process.stderr.write(`Ошибка: ${err.message}\n`);
  process.exit(1);
}
