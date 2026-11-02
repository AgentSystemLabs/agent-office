import test from 'node:test';
import assert from 'node:assert/strict';
import { standDom } from './support/dom.mjs';

standDom();

const { registerAgentProvider, unregisterAgentProvider, PROVIDER_META } = await import('../src/shared/providers.js');
const { supportedProviders, providerLabel, PROVIDER_LABEL, agentFields, choiceLabel } = await import('../src/client/ui/provider.js');

/** A project as the office says what it can hire. */
const project = (providers: string[], defaultProvider = 'claude') =>
  ({ name: 'p', dir: '/p', agentCmd: defaultProvider, defaultProvider, agentProviders: providers }) as never;

test("a provider a plugin registers shows up in the picker, not only the built-ins", () => {
  // The labels the picker offers are frozen when the browser module loads (PROVIDER_LABEL); the
  // provider table is not. A plugin registering one at runtime must still reach the picker.
  registerAgentProvider('openfox', { label: 'OpenFox', name: 'OpenFox', bin: 'openfox', usage: { reports: true, note: 'tracked by OpenFox' } });
  try {
    const supported = supportedProviders(project(['claude', 'openfox']));
    assert.deepEqual(supported, ['claude', 'openfox'], 'the plugin provider is offered');
    assert.equal(providerLabel('openfox', project(['claude', 'openfox'])), 'OpenFox');
    assert.ok(PROVIDER_META['openfox'], 'the table holds it');
  } finally {
    unregisterAgentProvider('openfox');
  }
  assert.deepEqual(supportedProviders(project(['claude', 'openfox'])), ['claude'], 'and goes again when it does');
});

test("a provider nobody registered is still left out", () => {
  assert.deepEqual(supportedProviders(project(['claude', 'nope'])), ['claude']);
});

test("with no provider list of its own, a project's default is what it hires on", () => {
  assert.deepEqual(supportedProviders({ ...(project(['claude']) as object), agentProviders: undefined } as never), ['claude']);
});

test("a registered provider produces a visible label in PROVIDER_LABEL and options", () => {
  registerAgentProvider('openfox', { label: 'OpenFox', name: 'OpenFox', bin: 'openfox', usage: { reports: true, note: 'tracked by OpenFox' } });
  try {
    assert.equal(PROVIDER_LABEL['openfox'], 'OpenFox', 'PROVIDER_LABEL map returns OpenFox');
    assert.equal(choiceLabel({ provider: 'openfox' as never }), 'OpenFox');
    // Standing up a fake select to check option text
    const fields = agentFields(project(['openfox']), 'test-agent', { provider: 'openfox' as never });
    const select = (fields.element as any).find('select')[0];
    assert.ok(select, 'select element exists');
    const opt = select.children.find((c: any) => c.attrs?.get('value') === 'openfox');
    assert.ok(opt, 'openfox option exists');
    assert.equal(opt.children[0], 'OpenFox', 'option has visible text OpenFox, not empty');
  } finally {
    unregisterAgentProvider('openfox');
  }
});
