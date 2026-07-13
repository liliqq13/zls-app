
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const REPORT_DIR = path.join(ROOT, 'reports');
const DB_FILE = path.join(DATA_DIR, 'db.json');

for (const dir of [DATA_DIR, REPORT_DIR]) fs.mkdirSync(dir, { recursive: true });

const vehicles = [
  {
    id:'taxi', plate:'YC-ROBOTAXI-EV-01', type:'纯电 Robotaxi',
    brand:'长安深蓝', model:'SL03 Robotaxi测试车', vin:'LS5A3CDE7YC0001',
    deviceId:'ZLS-BOX-001', protocol:'长安深蓝 SL03 协议库 2026.07',
    site:'重庆永川 · 兴龙湖环湖测试段', weather:'大雨',
    routeKm:5.8, todayKm:5.8, install:'副驾驶中控台内部',
    installDate:'2026-07-08', installer:'测试工程师A', acceptance:'已验收'
  },
  {
    id:'bus', plate:'YC-SHUTTLE-MINIBUS-02', type:'无人接驳小巴',
    brand:'宇通', model:'L4 无人接驳小巴', vin:'LZYTATEW7YC0002',
    deviceId:'ZLS-BOX-002', protocol:'宇通 L4 接驳小巴协议库 2026.07',
    site:'重庆永川 · 凤凰湖产业园测试段', weather:'小雨',
    routeKm:6.4, todayKm:6.4, install:'车辆设备舱',
    installDate:'2026-07-09', installer:'测试工程师B', acceptance:'已验收'
  },
  {
    id:'van', plate:'YC-LOGISTICS-VAN-03', type:'无人物流配送车',
    brand:'新石器', model:'X3 无人物流配送车', vin:'LNEVANX37YC0003',
    deviceId:'ZLS-BOX-003', protocol:'新石器 X3 配送车协议库 2026.07',
    site:'重庆永川 · 茶山竹海坡道测试段', weather:'大雾',
    routeKm:4.9, todayKm:4.9, install:'副驾驶中控台内部',
    installDate:'2026-07-10', installer:'测试工程师C', acceptance:'已验收'
  }
];

const nowIso = () => new Date().toISOString();
const initialDb = {
  workorders: [],
  reports: [],
  notifications: [
    {id:'NTF-001', level:'info', title:'设备上线', message:'三台智路哨兵设备已完成心跳连接。', vehicleId:'taxi', createdAt:nowIso(), read:false},
    {id:'NTF-002', level:'warn', title:'低能见度关注', message:'茶山竹海测试段能见度低于500m，请持续关注。', vehicleId:'van', createdAt:nowIso(), read:false},
    {id:'NTF-003', level:'success', title:'协议匹配完成', message:'车辆、设备与车型协议库已完成绑定。', vehicleId:'bus', createdAt:nowIso(), read:true}
  ],
  trips: [
    {id:'TRIP-001', vehicleId:'taxi', route:'兴龙湖环湖测试段', distance:5.8, duration:36, score:94, alerts:3, high:0, onlineRate:100, integrity:99.8, createdAt:nowIso()},
    {id:'TRIP-002', vehicleId:'bus', route:'凤凰湖产业园测试段', distance:6.4, duration:42, score:92, alerts:4, high:1, onlineRate:99.9, integrity:99.5, createdAt:nowIso()},
    {id:'TRIP-003', vehicleId:'van', route:'茶山竹海坡道测试段', distance:4.9, duration:38, score:89, alerts:5, high:1, onlineRate:99.7, integrity:99.2, createdAt:nowIso()}
  ],
  installations: vehicles.map(v=>({
    vehicleId:v.id, deviceId:v.deviceId, plate:v.plate, installDate:v.installDate,
    position:v.install, power:'车辆低压电源 12V/24V', dataInterface:'CAN Listen-only',
    installer:v.installer, acceptance:v.acceptance,
    photos:[
      {name:'设备外观照片', status:'已归档'},
      {name:'安装位置照片', status:'已归档'},
      {name:'线束连接照片', status:'已归档'},
      {name:'设备铭牌照片', status:'已归档'}
    ]
  })),
  audit:[
    {time:nowIso(), actor:'system', action:'平台初始化', detail:'车主安全平台 V2.0 启动'}
  ],
  thresholds:{highDistance:10, mediumDistance:20, lowVisibility:500, heartbeatDelay:10, heartbeatOffline:30}
};

function loadDb(){
  try{
    const data=JSON.parse(fs.readFileSync(DB_FILE,'utf8'));
    return {...initialDb,...data,
      notifications:Array.isArray(data.notifications)?data.notifications:initialDb.notifications,
      trips:Array.isArray(data.trips)?data.trips:initialDb.trips,
      installations:Array.isArray(data.installations)?data.installations:initialDb.installations
    };
  }catch{
    fs.writeFileSync(DB_FILE,JSON.stringify(initialDb,null,2));
    return JSON.parse(JSON.stringify(initialDb));
  }
}
let db=loadDb();
function saveDb(){fs.writeFileSync(DB_FILE,JSON.stringify(db,null,2))}
function audit(actor,action,detail){
  db.audit.unshift({time:nowIso(),actor,action,detail});
  db.audit=db.audit.slice(0,300);saveDb();
}
function addNotification(level,title,message,vehicleId='taxi'){
  const item={id:`NTF-${Date.now()}`,level,title,message,vehicleId,createdAt:nowIso(),read:false};
  db.notifications.unshift(item);db.notifications=db.notifications.slice(0,100);saveDb();return item;
}

const tokens=new Map();
const clients=new Set();
const startAt=Date.now();
let fault=null;

function nowTelemetry(v,idx){
  const t=(Date.now()-startAt)/1000;
  let speed=Math.max(0,[32,24,19][idx]+Math.sin(t/4+idx)*7);
  let progress=(t*(0.5+idx*.08))%100;
  let visibility=Math.max(120,[820,1250,420][idx]+Math.sin(t/7+idx)*90);
  let distance=13+Math.sin(t/3+idx*1.7)*8;
  let temp=43+Math.sin(t/12+idx)*3;
  let networkDelay=42+Math.abs(Math.sin(t/2+idx))*35;
  let accuracy=.18+Math.abs(Math.sin(t/9+idx))*.09;
  let canOk=true,rtkOk=true,netOk=true;
  if(fault==='can'&&idx===0)canOk=false;
  if(fault==='rtk'&&idx===0){rtkOk=false;accuracy=2.8}
  if(fault==='temp'&&idx===0)temp=76;
  if(fault==='net'&&idx===0){netOk=false;networkDelay=520}
  if(fault==='obstacle'&&idx===0)distance=6.8;
  if(fault==='fog'&&idx===0)visibility=260;
  const score=
    Math.max(0,50-distance*2.4)+
    Math.max(0,(600-visibility)/12)+
    Math.max(0,speed-25)*.8+
    (!canOk?22:0)+(!rtkOk?14:0)+(!netOk?9:0)+(temp>70?12:0);
  const riskScore=Math.min(100,Math.round(score));
  const riskLevel=riskScore>=70?'高风险':riskScore>=38?'中风险':'正常';
  const reason=[
    distance<10?'目标距离过近':null,
    visibility<500?'低能见度':null,
    speed>32?'车速偏高':null,
    !canOk?'CAN报文异常':null,
    !rtkOk?'RTK定位漂移':null,
    !netOk?'通信延迟':null,
    temp>70?'设备高温':null
  ].filter(Boolean).join(' + ')||'车辆与设备状态正常';
  const stamp=nowIso();
  return{
    vehicleId:v.id,plate:v.plate,deviceId:v.deviceId,timestamp:stamp,
    serverReceivedAt:stamp,heartbeatAt:stamp,speed:Number(speed.toFixed(1)),
    progress:Number(progress.toFixed(1)),routeDoneKm:Number((v.routeKm*progress/100).toFixed(2)),
    accuracy:Number(accuracy.toFixed(2)),visibility:Math.round(visibility),
    targetDistance:Number(distance.toFixed(1)),deviceTemp:Number(temp.toFixed(1)),
    voltage:Number((12.4+Math.sin(t/8+idx)*.16).toFixed(2)),
    networkDelay:Math.round(networkDelay),canOk,rtkOk,netOk,riskScore,riskLevel,reason,
    source:{speed:'CAN Listen-only',location:'RTK-GNSS + IMU',weather:'天气服务/本地兜底',route:'高德路线服务/本地兜底',risk:'风险规则引擎 V1.2.3'},
    quality:canOk&&rtkOk?'有效':'降级',cached:false,
    ruleVersion:'RULE-V1.2.3',modelVersion:'MODEL-V1.2',thresholdVersion:'TH-202607'
  }
}

function safetyTimeline(v,tel){
  const base=new Date();
  const hhmm=(offset)=>new Date(base.getTime()-offset*60000).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
  return[
    {time:hhmm(46),level:'normal',title:'设备上线',detail:`${v.deviceId} 完成心跳连接`},
    {time:hhmm(39),level:'normal',title:'协议匹配完成',detail:v.protocol},
    {time:hhmm(31),level:'normal',title:'进入测试路段',detail:v.site},
    {time:hhmm(18),level:tel.riskLevel==='正常'?'warn':tel.riskLevel==='中风险'?'warn':'danger',title:tel.riskLevel==='正常'?'环境风险关注':tel.riskLevel,detail:tel.reason},
    {time:hhmm(7),level:'normal',title:'风险状态更新',detail:`当前评分 ${tel.riskScore}/100`},
    {time:hhmm(1),level:'normal',title:'数据持续记录',detail:'CAN / RTK / 设备日志已归档'}
  ];
}
function snapshot(){
  const telemetry=vehicles.map(nowTelemetry);
  const high=telemetry.filter(x=>x.riskLevel==='高风险').length;
  const medium=telemetry.filter(x=>x.riskLevel==='中风险').length;
  return{
    serverTime:nowIso(),
    services:{apiGateway:'运行中',sseStream:'运行中',database:'JSON持久化',reportWorker:'运行中',auditService:'运行中'},
    vehicles,telemetry,
    overview:{vehicles:vehicles.length,onlineDevices:telemetry.length,high,medium,routeKm:17.1,health:Math.max(82,100-high*8-medium*3),protocolRate:100},
    thresholds:db.thresholds,workorders:db.workorders.slice(0,20),reports:db.reports.slice(0,20),
    notifications:db.notifications.slice(0,30),trips:db.trips.slice(0,20),installations:db.installations,
    audit:db.audit.slice(0,30),activeFault:fault,
    timeline:Object.fromEntries(vehicles.map((v,i)=>[v.id,safetyTimeline(v,telemetry[i])]))
  }
}

function json(res,status,data){
  const body=JSON.stringify(data);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store'});
  res.end(body);
}
function text(res,status,body,type='text/plain; charset=utf-8'){
  res.writeHead(status,{'Content-Type':type,'Content-Length':Buffer.byteLength(body)});res.end(body);
}
function readBody(req){
  return new Promise((resolve,reject)=>{
    let data='';req.on('data',c=>{data+=c;if(data.length>1e6)req.destroy()});
    req.on('end',()=>{try{resolve(data?JSON.parse(data):{})}catch(e){reject(e)}});req.on('error',reject);
  })
}
function auth(req){return tokens.get((req.headers.authorization||'').replace(/^Bearer\s+/i,''))}
function requireAuth(req,res){const user=auth(req);if(!user){json(res,401,{error:'未登录或令牌失效'});return null}return user}
function safeName(name){return path.basename(name).replace(/[^\w.\-]/g,'_')}
function mime(file){
  const ext=path.extname(file).toLowerCase();
  return{'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'}[ext]||'application/octet-stream'
}
function serveStatic(req,res,pathname){
  let file=pathname==='/'?path.join(PUBLIC,'index.html'):path.join(PUBLIC,pathname);
  if(!file.startsWith(PUBLIC))return text(res,403,'Forbidden');
  fs.stat(file,(err,stat)=>{
    if(err||!stat.isFile())return text(res,404,'Not Found');
    res.writeHead(200,{'Content-Type':mime(file),'Cache-Control':'no-cache'});fs.createReadStream(file).pipe(res)
  })
}
function safetyCheck(v,tel){
  const checks=[
    {name:'设备供电',status:tel.voltage>=9&&tel.voltage<=16?'正常':'异常',value:`${tel.voltage}V`},
    {name:'CAN监听',status:tel.canOk?'正常':'异常',value:'Listen-only'},
    {name:'RTK定位',status:tel.rtkOk?'正常':'异常',value:`${tel.accuracy}m`},
    {name:'5G通信',status:tel.netOk?'正常':'异常',value:`${tel.networkDelay}ms`},
    {name:'协议库匹配',status:'正常',value:v.protocol},
    {name:'天气服务',status:tel.visibility<500?'关注':'正常',value:`能见度 ${tel.visibility}m`},
    {name:'风险模型',status:'正常',value:tel.modelVersion},
    {name:'日志存储',status:'正常',value:'持续写入'},
    {name:'服务器连接',status:'正常',value:'API + SSE'}
  ];
  const abnormal=checks.filter(x=>x.status==='异常').length;
  const attention=checks.filter(x=>x.status==='关注').length;
  const score=Math.max(0,100-abnormal*18-attention*4);
  return{vehicleId:v.id,plate:v.plate,score,normal:checks.length-abnormal-attention,attention,abnormal,checks,createdAt:nowIso(),
    conclusion:abnormal?'存在异常，请生成工单处理':attention?'存在关注项，建议持续监测':'全部检查通过'}
}

async function handle(req,res){
  const u=new URL(req.url,`http://${req.headers.host||'localhost'}`),p=u.pathname;
  if(p==='/api/health'&&req.method==='GET')return json(res,200,{ok:true,uptimeSeconds:Math.floor((Date.now()-startAt)/1000),serverTime:nowIso(),services:snapshot().services});
  if(p==='/api/login'&&req.method==='POST'){
    try{
      const body=await readBody(req);
      if(body.username!=='operator@zls.local'||body.password!=='123456'){
        audit(body.username||'unknown','登录失败','账号或密码错误');return json(res,401,{error:'账号或密码错误'})
      }
      const token=crypto.randomBytes(24).toString('hex'),user={username:body.username,role:'运营人员',issuedAt:nowIso()};
      tokens.set(token,user);audit(user.username,'登录成功','进入车主安全平台 V2.0');return json(res,200,{token,user})
    }catch{return json(res,400,{error:'请求格式错误'})}
  }
  if(p==='/api/bootstrap'&&req.method==='GET'){const user=requireAuth(req,res);if(!user)return;return json(res,200,snapshot())}
  if(p==='/api/stream'&&req.method==='GET'){
    const user=tokens.get(u.searchParams.get('token'));if(!user)return json(res,401,{error:'无效令牌'});
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache','Connection':'keep-alive','Access-Control-Allow-Origin':'*'});
    res.write(`event: hello\ndata: ${JSON.stringify({ok:true,serverTime:nowIso()})}\n\n`);
    const client={res,user};clients.add(client);req.on('close',()=>clients.delete(client));return
  }
  if(p==='/api/safety-check'&&req.method==='POST'){
    const user=requireAuth(req,res);if(!user)return;const body=await readBody(req);
    const v=vehicles.find(x=>x.id===body.vehicleId)||vehicles[0],tel=nowTelemetry(v,vehicles.indexOf(v)),result=safetyCheck(v,tel);
    audit(user.username,'执行安全体检',`${v.plate}｜得分 ${result.score}`);
    addNotification(result.abnormal?'danger':result.attention?'warn':'success','安全体检完成',`${v.plate} 安全体检得分 ${result.score} 分`,v.id);
    return json(res,200,result)
  }
  if(p==='/api/workorders'&&req.method==='POST'){
    const user=requireAuth(req,res);if(!user)return;const body=await readBody(req);
    const v=vehicles.find(x=>x.id===body.vehicleId)||vehicles[0],tel=nowTelemetry(v,vehicles.indexOf(v));
    const id=`WO-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(db.workorders.length+1).padStart(3,'0')}`;
    const item={id,vehicleId:v.id,plate:v.plate,deviceId:v.deviceId,level:tel.riskLevel,reason:tel.reason,owner:body.owner||'运维一组',status:'已派发',createdAt:nowIso(),createdBy:user.username};
    db.workorders.unshift(item);saveDb();audit(user.username,'生成工单',`${id}｜${v.plate}｜${item.reason}`);
    addNotification('warn','工单已派发',`${id} 已派发给 ${item.owner}`,v.id);return json(res,201,item)
  }
  const wo=p.match(/^\/api\/workorders\/([^/]+)\/complete$/);
  if(wo&&req.method==='PATCH'){
    const user=requireAuth(req,res);if(!user)return;const item=db.workorders.find(x=>x.id===decodeURIComponent(wo[1]));
    if(!item)return json(res,404,{error:'工单不存在'});
    item.status='已完成';item.completedAt=nowIso();item.completedBy=user.username;saveDb();audit(user.username,'完成工单',item.id);
    addNotification('success','工单处理完成',`${item.id} 已完成并归档`,item.vehicleId);return json(res,200,item)
  }
  if(p==='/api/reports'&&req.method==='POST'){
    const user=requireAuth(req,res);if(!user)return;const body=await readBody(req);
    const v=vehicles.find(x=>x.id===body.vehicleId)||vehicles[0],tel=nowTelemetry(v,vehicles.indexOf(v));
    const names={device:'设备运行报告',alert:'预警事件报告',run:'车辆运行报告',diagnosis:'故障诊断报告',acceptance:'测试验收报告',protocol:'协议适配报告',trip:'行程安全报告'};
    const title=names[body.type]||'平台运行报告',reportId=`RPT-${Date.now()}`,filename=safeName(`${reportId}_${body.type||'general'}.json`);
    const trip=db.trips.find(x=>x.vehicleId===v.id);
    const report={reportId,title,generatedAt:nowIso(),generatedBy:user.username,vehicle:v,telemetrySnapshot:tel,trip,
      workorders:db.workorders.filter(x=>x.vehicleId===v.id).slice(0,10),dataIntegrity:'100%',ruleVersion:tel.ruleVersion,modelVersion:tel.modelVersion,hash:''};
    const raw=JSON.stringify(report,null,2);report.hash=crypto.createHash('sha256').update(raw).digest('hex');
    fs.writeFileSync(path.join(REPORT_DIR,filename),JSON.stringify(report,null,2));
    const item={reportId,title,filename,vehicleId:v.id,plate:v.plate,generatedAt:report.generatedAt,generatedBy:user.username,hash:report.hash};
    db.reports.unshift(item);saveDb();audit(user.username,'生成报表',`${reportId}｜${title}｜${v.plate}`);
    addNotification('success','报告生成完成',`${title} 已完成，可在运维页下载`,v.id);return json(res,201,item)
  }
  const report=p.match(/^\/api\/reports\/([^/]+)$/);
  if(report&&req.method==='GET'){
    const user=requireAuth(req,res);if(!user)return;const filename=safeName(decodeURIComponent(report[1])),file=path.join(REPORT_DIR,filename);
    if(!fs.existsSync(file))return json(res,404,{error:'报告不存在'});
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="${filename}"`});fs.createReadStream(file).pipe(res);return
  }
  const note=p.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if(note&&req.method==='PATCH'){
    const user=requireAuth(req,res);if(!user)return;const item=db.notifications.find(x=>x.id===decodeURIComponent(note[1]));
    if(!item)return json(res,404,{error:'通知不存在'});item.read=true;saveDb();audit(user.username,'阅读通知',item.id);return json(res,200,item)
  }
  if(p==='/api/simulate'&&req.method==='POST'){
    const user=requireAuth(req,res);if(!user)return;const body=await readBody(req);
    fault=['can','rtk','temp','net','obstacle','fog'].includes(body.fault)?body.fault:null;
    audit(user.username,'异常模拟',fault?`触发 ${fault}`:'清除异常');
    if(fault)addNotification(fault==='obstacle'||fault==='can'?'danger':'warn','异常状态提醒',`测试车辆触发 ${fault} 异常模拟`,'taxi');
    return json(res,200,{activeFault:fault})
  }
  return serveStatic(req,res,p)
}

const server=http.createServer((req,res)=>handle(req,res).catch(err=>{console.error(err);if(!res.headersSent)json(res,500,{error:'服务器内部错误'});else res.end()}));
setInterval(()=>{
  const data=JSON.stringify(snapshot());
  for(const client of clients){try{client.res.write(`event: telemetry\ndata: ${data}\n\n`)}catch{clients.delete(client)}}
},1000);
server.listen(PORT,'0.0.0.0',()=>console.log(`智路哨兵车主安全平台 V2.0：http://localhost:${PORT}`));
