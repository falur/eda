#!/usr/bin/env node
import { createRequire } from 'node:module';
import { init, update, updateAll } from '../lib/install.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');
const cmd = process.argv[2];

const HELP = `eda — установка и обновление скилов и агентов eda-* для Claude Code и Codex CLI.

Использование:
  eda init     — выбрать целевые среды (Claude / Codex / обе) и установить пакет
  eda update   — заново настроить конфиг и обновить текущий проект
  eda update-all [dir] — один раз настроить конфиг и обновить все проекты внутри dir
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
    case 'update-all':
      await updateAll({ root: process.argv[3] ?? process.cwd() });
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
