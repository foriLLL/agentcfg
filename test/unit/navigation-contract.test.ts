import assert from 'node:assert/strict';
import test from 'node:test';

import { COMMAND_CENTER_NAV_ITEMS } from '../../web/src/navigation';

test('command center navigation uses the redesigned top-level IA labels', () => {
  const labels: string[] = COMMAND_CENTER_NAV_ITEMS.map((item) => item.label);

  assert.deepEqual(labels, ['首页', '配置', '同步', '规则与 Skills', '设置']);
  assert.ok(!labels.includes('远端真源'));
  assert.ok(!labels.includes('概览'));
});
