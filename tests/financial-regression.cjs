const ts = require('typescript'), fs = require('fs'), assert = require('node:assert/strict');
function load(p) { const m={exports:{}}; new Function('module','exports',ts.transpileModule(fs.readFileSync(p,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(m,m.exports); return m.exports; }
const {calculatePayroll: pay}=load('src/lib/payroll.ts');
const employee={basic_salary:30000,monthly_salary:30000,per_day_deduction:1000,hourly_rate:125,overtime_rate:200};
const month='2026-11';
assert.ok(pay({...employee,requires_rate_review:true},month,[],[]).issues.length);
const att=(date,ot=0,checkin=true)=>({date,login_time:checkin?`${date}T09:00:00+05:00`:null,overtime_hours:ot});
const leave=(date,type,status='approved',hours=0)=>({date,status,leave_type:type,hours_missed:hours});
let r=pay(employee,month,[],[]);assert.equal(r.finalSalary,30000); // no invented weekend/absence policy
r=pay(employee,month,[att('2026-11-01',2)],[leave('2026-11-02','paid'),leave('2026-11-03','unpaid'),leave('2026-11-01','short','approved',2)]);
assert.equal(r.finalSalary,29150);assert.equal(r.totalPresentDays,2);assert.equal(r.shortLeaveDeduction,250);assert.equal(r.overtimePay,400);assert.deepEqual(r.issues,[]);
for(const status of ['cancelled','pending','rejected']) assert.equal(pay(employee,month,[],[leave('2026-11-02','unpaid',status)]).finalSalary,30000);
r=pay(employee,month,[att('2026-11-01',-16)],[]);assert.equal(r.finalSalary,30000);assert.ok(r.issues.length);
r=pay(employee,month,[att('2026-11-01',2,false)],[]);assert.equal(r.daysAttended,0);assert.equal(r.overtimePay,400);
r=pay(employee,month,[att('2026-11-01')],[leave('2026-11-01','paid')]);assert.equal(r.totalPresentDays,1);assert.ok(r.issues.length);
r=pay({...employee,overtime_rate:0,basic_salary:0},month,[att('2026-11-01',2)],[]);assert.equal(r.finalSalary,0);assert.equal(r.overtimePay,0);
r=pay(employee,month,[att('2026-10-31',10)],[leave('2026-10-31','unpaid')]);assert.equal(r.finalSalary,30000);
r=pay(employee,month,[att('2026-11-01'),att('2026-11-01')],[]);assert.equal(r.daysAttended,1);assert.ok(r.issues.length);
r=pay({...employee,hourly_rate:.1},month,[],[leave('2026-11-01','short','approved',.2)]);assert.equal(r.shortLeaveDeduction,.02);
r=pay(employee,month,[],[leave('2026-11-01','short','approved',-2)]);assert.ok(r.issues.length);
const {calculateShiftMetricsPkt:calc}=load('src/lib/pktTime.ts');
assert.equal(calc('2026-11-11T01:00:00+05:00','2026-11-11T07:00:00+05:00','22:00','06:00').overtimeHours,1);
assert.equal(calc('2026-11-10T12:51:00+05:00','2026-11-10T12:59:00+05:00','09:00','17:00').overtimeHours,0);
console.log('PASS: shared payroll, cancellation, conflicts, zero rates, duplicates, cents and overnight cases.');
(async()=>{
 let success, failure, options, cleared=0;
 Object.defineProperty(globalThis,'navigator',{value:{geolocation:{watchPosition(s,f,o){success=s;failure=f;options=o;return 7},clearWatch(id){assert.equal(id,7);cleared++}}},configurable:true});
 const {getAveragedGps}=load('src/lib/accurateGps.ts');
 const progress=[];const promise=getAveragedGps(m=>progress.push(m));const time=Date.now()+1;
 success({timestamp:time,coords:{latitude:50,longitude:50,accuracy:31}});
 assert.equal(progress[0],'GPS signal weak, please wait.');
 for(let i=0;i<5;i++) success({timestamp:time+i,coords:{latitude:32+i*.00001,longitude:74,accuracy:10}});
 const gps=await promise;assert.equal(gps.samples,5);assert.ok(Math.abs(gps.coords.latitude-32.00002)<1e-9);assert.equal(cleared,1);
 assert.deepEqual(options,{enableHighAccuracy:true,maximumAge:0,timeout:10000});
 const controller=new AbortController();const cancelled=getAveragedGps(undefined,controller.signal);controller.abort();await assert.rejects(cancelled,/cancelled/);assert.equal(cleared,2);
 const denied=getAveragedGps();failure({code:1});await assert.rejects(denied,/Permission Denied/);assert.equal(cleared,3);
 console.log('PASS: GPS five-reading average, poor accuracy rejection, watch options, abort and permission cleanup.');
})().catch(e=>{console.error(e);process.exitCode=1});
