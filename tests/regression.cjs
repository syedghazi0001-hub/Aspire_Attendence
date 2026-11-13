const ts = require('typescript');
const fs = require('fs');
const assert = require('node:assert/strict');
function load(path) {
  const js = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} }; new Function('module', 'exports', js)(mod, mod.exports); return mod.exports;
}
const { calculateShiftMetricsPkt: calc } = load('src/lib/pktTime.ts');
const { calculateDistanceInMeters: distance, STRICT_EMPLOYEE_ID_REGEX: ids, computeNextEmployeeId: next } = load('src/lib/geo.ts');
function ot(a,b,start='09:00',end='17:00') { return calc(`2026-11-10T${a}:00+05:00`, `2026-11-10T${b}:00+05:00`,start,end).overtimeHours; }
assert.equal(ot('12:51','12:59'),0);
assert.equal(ot('08:00','17:00'),0);
assert.equal(ot('08:00','18:00'),1);
assert.equal(ot('18:00','19:00'),1);
assert.equal(ot('12:59','12:51'),0);
assert.equal(calc('2026-11-10T22:00:00+05:00','2026-11-11T07:00:00+05:00','22:00','06:00').overtimeHours,1);
assert.equal(distance(32,74,32,74),0);
assert.ok(Math.abs(distance(0,0,0,1) - 111195.0802) < .01);
const within = distance(0,0,0,0.00000899), outside = distance(0,0,0,0.000009);
assert.ok(within < 1); assert.ok(outside > 1); // unrounded strict 1m boundary
assert.equal(distance(91,0,0,0), Infinity);
assert.ok(ids.test('EMP 01')); assert.ok(ids.test('EMP 100'));
for (const id of ['EMP 00','EMP\t01','EMP01','EMP 001','EMP 1']) assert.ok(!ids.test(id));
assert.equal(next(['EMP 01','EMP 05']), 'EMP 06');
console.log('PASS: 19 overtime, GPS-meter boundary, and employee ID regression assertions.');
