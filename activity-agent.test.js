const assert = require('assert');
const { WindowsActivityAgent, homeRoots } = require('../windows-agent/activity-agent');

const agent = new WindowsActivityAgent({ enabled: true });
const state = agent.getState();
assert.ok(state.deviceId);
assert.ok(state.deviceName);
assert.ok(state.fileRoots);
assert.ok(Array.isArray(state.processes));
assert.ok(Array.isArray(state.installedApps));
assert.ok(Array.isArray(state.recentFileEvents));
assert.ok(homeRoots());

let events = 0;
const unsubscribe = agent.subscribe(() => { events += 1; });
assert.strictEqual(typeof unsubscribe, 'function');
unsubscribe();
agent.stop();
console.log('PASS  Windows activity agent state/subscription contract');
console.log('All dependency-free activity-agent tests passed.');
