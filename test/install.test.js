import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { askTargets, update } from '../lib/install.js';

test('update installs Codex skills as skill directories with SKILL.md', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-install-'));
  await fs.mkdir(path.join(cwd, '.codex/skills'), { recursive: true });
  await fs.writeFile(path.join(cwd, '.codex/skills/eda-plan.md'), 'old layout');

  await update({ cwd });

  const skill = await fs.readFile(path.join(cwd, '.codex/skills/eda-plan/SKILL.md'), 'utf8');
  assert.match(skill, /name: eda-plan/);
  await assert.rejects(
    fs.stat(path.join(cwd, '.codex/skills/eda-plan.md')),
    err => err?.code === 'ENOENT'
  );
});

test('askTargets defaults to both targets without an interactive terminal', async () => {
  const input = new PassThrough();
  const output = new PassThrough();

  const targets = await askTargets({ input, output });

  assert.deepEqual(targets, ['claude', 'codex']);
});
