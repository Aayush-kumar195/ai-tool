const assert = require('assert');
const { taskLooksLikeComputerUse, candidateCommands, shouldUseShell } = (() => {
  const modPath = require.resolve('../hermes-bridge');
  const mod = require(modPath);
  return mod;
})();

assert.strictEqual(taskLooksLikeComputerUse('open my Downloads folder'), true);
assert.strictEqual(taskLooksLikeComputerUse('play a video on YouTube'), true);
assert.strictEqual(taskLooksLikeComputerUse('what is CAP theorem?'), false);
assert.strictEqual(taskLooksLikeComputerUse('what is running in the background?'), true);
console.log('PASS  Hermes bridge task classification');
console.log('All dependency-free Hermes bridge tests passed.');

assert.equal(typeof candidateCommands, 'function');
assert.equal(typeof shouldUseShell, 'function');
console.log('PASS Hermes Windows command-shim resolution contract.');
