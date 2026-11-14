const ts = require('typescript'), fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
let workerEnv; let scenario='admin'; let creates=[]; let attempts=[]; let writes=[]; let token='CURRENT-QR';
const jwt = role => 'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.signature';
const configured = host => ({ NEXT_PUBLIC_SUPABASE_URL:`https://${host}.supabase.co`,NEXT_PUBLIC_SUPABASE_ANON_KEY:jwt('anon'),SUPABASE_SERVICE_ROLE_KEY:jwt('service_role') });
const user = () => ({id:'test-user',employee_id:'EMP 01',full_name:'Test User',role:scenario==='admin'?'admin':'employee',duty_start_time:'09:00',duty_end_time:'17:00'});
class Builder {
 constructor(table){this.table=table;this.action='select';this.filters={};}
 select(){return this;}eq(k,v){this.filters[k]=v;return this;}in(){return this;}limit(){return this;}order(){return this;}
 update(v){this.action='update';this.value=v;return this;}insert(v){this.action='insert';this.value=v;return this;}
 async maybeSingle(){return this.run(true);}async single(){return this.run(true);}then(ok,bad){return this.run(false).then(ok,bad);}
 async run(single){
  if(this.action!=='select'){
   writes.push({table:this.table,action:this.action,value:this.value});
   if(scenario==='write-error'&&this.table==='active_sessions')return {data:null,error:{message:'test write failed'}};
   if(this.table==='settings'&&this.value.qr_secret)token=this.value.qr_secret;
   return {data:this.table==='settings'?{id:1,office_lat:32,office_lng:74,radius_meters:100,qr_secret:token}:this.value,error:null};
  }
  if(this.table==='users')return {data:user(),error:null};
  if(this.table==='settings')return {data:{id:1,office_lat:32,office_lng:74,radius_meters:100,qr_secret:token},error:null};
  if(this.table==='leaves')return {data:scenario==='leave-block'?{leave_type:'paid',hours_missed:0}:null,error:null};
  if(this.table==='active_sessions'){
   if(single)return {data:{id:'session',user_id:'test-user',session_token:'employee-token',device_fingerprint:'fp',is_active:true,approval_status:'approved'},error:null};
   return {data:scenario==='other-device'?[{id:'session',device_fingerprint:'other',approval_status:'approved'}]:[],error:null};
  }
  return {data:single?null:[],error:null};
 }
}
const sdk={createClient(url,key){creates.push({url,key});return {from:t=>new Builder(t),auth:{
 getUser:async()=>({data:{user:{id:'test-user'}},error:null}),
 admin:{getUserById:async()=>({data:{user:{email:'legacy@example.com'}},error:null})},
 signInWithPassword:async input=>{attempts.push(input);if(scenario==='invalid')return {data:{},error:{code:'invalid_credentials',status:400,message:'Invalid login credentials'}};
 if(scenario==='bad-key')return {data:{},error:{status:401,message:'Invalid API key'}};
 return {data:{user:{id:'test-user'},session:{access_token:'admin-access',refresh_token:'admin-refresh'}},error:null};}
 }}}};
const cache={};function load(file){const full=path.resolve(file);if(cache[full])return cache[full].exports;const m={exports:{}};cache[full]=m;const js=ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;new Function('require','module','exports',js)(id=>{
 if(id==='@opennextjs/cloudflare')return {getCloudflareContext:()=>{if(!workerEnv)throw new Error('no bindings');return {env:workerEnv}}};
 if(id==='@supabase/supabase-js')return sdk;
 if(id.startsWith('@/'))return load('src/'+id.slice(2)+'.ts');
 if(id.startsWith('./')) return load(path.resolve(path.dirname(full),id)+'.ts');
 return require(id);
},m,m.exports);return m.exports;}
const {NextRequest}=require('next/server');
const req=(url,body,admin=false)=>new NextRequest('https://worker.test'+url,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...(admin?{authorization:'Bearer admin-access'}:{})},...(body?{body:JSON.stringify(body)}:{})});
(async()=>{
 // Build-process values must never override request bindings.
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://wrong-build-project.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='BUILD-SECRET-NOT-RUNTIME';
 const health=load('src/app/api/health/route.ts');
 const login=load('src/app/api/employee/login/route.ts');const settings=load('src/app/api/admin/settings/route.ts');const publicConfig=load('src/app/api/public-config/route.ts');const attendance=load('src/app/api/employee/attendance/route.ts');
 assert.equal(creates.length,0); // no module-global server Supabase clients
 assert.match(fs.readFileSync('wrangler.toml','utf8'), /^keep_vars\s*=\s*true/m);
 assert.ok(require('../package.json').scripts.deploy.includes('--keep-vars'));
 workerEnv={};let healthResponse=await health.GET(req('/api/health'),{});assert.equal(healthResponse.status,503);let healthData=await healthResponse.json();assert.equal(healthData.release,'6.2.2-inline-worker-bindings');assert.ok(healthData.bindings.includes('NEXT_PUBLIC_SUPABASE_URL'));assert.equal(creates.length,0);
 workerEnv=configured('health-worker');healthResponse=await health.GET(req('/api/health'),{});assert.equal(healthResponse.status,200);healthData=await healthResponse.json();assert.equal(healthData.configurationReady,true);assert.equal(healthData.liveSupabaseVerified,false);assert.ok(!JSON.stringify(healthData).includes(workerEnv.SUPABASE_SERVICE_ROLE_KEY));assert.equal(creates.length,0);

 workerEnv=configured('runtime-a');let response=await login.POST(req('/api/employee/login',{identifier:'admin@example.com',password:' pass with spaces '}),{});
 assert.equal(response.status,200);let data=await response.json();assert.equal(data.role,'admin');assert.equal(data.auth_session.access_token,'admin-access');assert.equal(attempts[0].password,' pass with spaces ');assert.ok(creates.every(c=>c.url.includes('runtime-a')));
 workerEnv=configured('runtime-b');creates=[];await login.POST(req('/api/employee/login',{identifier:'admin@example.com',password:'pw'}),{});assert.ok(creates.every(c=>c.url.includes('runtime-b')));
 response=await publicConfig.GET(req('/api/public-config'),{});data=await response.json();assert.equal(response.status,200);assert.deepEqual(Object.keys(data).sort(),['anonKey','url']);assert.ok(!JSON.stringify(data).includes(jwt('service_role')));
 workerEnv={NEXT_PUBLIC_SUPABASE_URL:'https://public-only.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:jwt('anon')};assert.equal((await publicConfig.GET(req('/api/public-config'),{})).status,200);
 workerEnv={};response=await login.POST(req('/api/employee/login',{identifier:'x',password:'x'}),{});assert.equal(response.status,503);assert.equal((await response.json()).code,'SUPABASE_CONFIGURATION_ERROR');
 workerEnv=configured('runtime-a');scenario='employee';attempts=[];writes=[];response=await login.POST(req('/api/employee/login',{identifier:'EMP 01',password:'pw',device_fingerprint:'fp'}),{});data=await response.json();assert.equal(response.status,200);assert.equal(data.role,'employee');assert.ok(data.session_token);assert.equal(attempts[0].email,'legacy@example.com');assert.ok(writes.some(w=>w.table==='active_sessions'));
 scenario='other-device';response=await login.POST(req('/api/employee/login',{identifier:'EMP 01',password:'pw',device_fingerprint:'fp'}),{});data=await response.json();assert.equal(response.status,403);assert.equal(data.blocked_other_device,true);assert.ok(data.session_token);
 scenario='invalid';response=await login.POST(req('/api/employee/login',{identifier:'person@example.com',password:'bad'}),{});assert.equal(response.status,401);assert.equal((await response.json()).code,'INVALID_CREDENTIALS');
 scenario='bad-key';response=await login.POST(req('/api/employee/login',{identifier:'person@example.com',password:'bad'}),{});assert.equal(response.status,503);assert.equal((await response.json()).code,'SUPABASE_AUTH_UNAVAILABLE');
 scenario='write-error';response=await login.POST(req('/api/employee/login',{identifier:'person@example.com',password:'pw',device_fingerprint:'fp'}),{});assert.equal(response.status,500);assert.ok(!(await response.json()).session_token);
 scenario='admin';workerEnv={...configured('runtime-a'),NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_secret_not_a_public_key'};assert.equal((await settings.GET(req('/api/admin/settings',undefined,true),{})).status,200);workerEnv=configured('runtime-a');assert.equal((await settings.GET(req('/api/admin/settings'),{})).status,401);
 response=await settings.GET(req('/api/admin/settings',undefined,true),{});assert.equal(response.status,200);assert.equal((await response.json()).settings.qr_secret,'CURRENT-QR');
 response=await settings.PUT(req('/api/admin/settings',{qr_secret:'ROTATED-QR'},true),{});assert.equal(response.status,200);assert.equal((await response.json()).settings.qr_secret,'ROTATED-QR');
 scenario='leave-block';writes=[];response=await attendance.POST(req('/api/employee/attendance',{session_token:'employee-token',device_fingerprint:'fp',qr_data:'ROTATED-QR',lat:32,lng:74,intent:'clock_in'}),{});assert.equal(response.status,409);assert.equal((await response.json()).leave_blocked,true);assert.equal(writes.length,0);
 for(const file of fs.readdirSync('src/app/api/admin')){const p='src/app/api/admin/'+file+'/route.ts';if(fs.existsSync(p)){const s=fs.readFileSync(p,'utf8');assert.ok(s.includes('getCloudflareContext()'));assert.ok(!s.includes('process.env'));}}
 // Every Supabase-initializing API must read the three Worker fields and create inside handlers.
 const scan=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?scan(path.join(dir,e.name)):[path.join(dir,e.name)]);
 for(const file of scan('src/app/api').filter(f=>f.endsWith('route.ts'))){
  const source=fs.readFileSync(file,'utf8');assert.ok(!source.includes('process.env'));
  if(source.includes('createClient(')){
   for(const snippet of ['const { env } = getCloudflareContext();','env.NEXT_PUBLIC_SUPABASE_URL','env.NEXT_PUBLIC_SUPABASE_ANON_KEY','env.SUPABASE_SERVICE_ROLE_KEY','createClient(supabaseUrl, serviceRoleKey, options)'])assert.ok(source.includes(snippet),file+' lacks '+snippet);
   assert.ok(!source.includes('createRuntimeClients'));
  }
 }
 console.log('PASS: runtime-only keys, per-request clients, admin session handoff, public-config secret isolation, employee/legacy login, second-device lock, error classification, failed writes, QR authorization/rotation and approved-leave blocking.');
})().catch(error=>{console.error(error);process.exitCode=1});
