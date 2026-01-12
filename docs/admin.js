
/* =========================================================
 Admin - Scorecard Safran Cabin
 - Login SOLO aquí (overlay bloqueante)
 - Si viewer inicia sesión → redirigir a Exec
 - IndexedDB, captura diaria, resumen semanal
 - ✅ Áreas sin datos: se agrega UNA FILA VACÍA (sin plantillas)
 ========================================================= */

// --------- Utilidades ----------
const $  = (sel, ctx=document) => ctx.querySelector(sel);
const $$ = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));
function toNumberOrNull(v){
  if (v===undefined || v===null) return null;
  const n = Number(String(v).replace(/[^\-0-9\.]/g,'').trim());
  return Number.isFinite(n) ? n : null;
}
function todayLocal(){
  const d=new Date();
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), da=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${da}`;
}
function isoWeekString(dStr){
  const [Y,M,D]=dStr.split('-').map(Number);
  const d=new Date(Date.UTC(Y,M-1,D));
  const dayNum=d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate()+4-dayNum);
  const y=d.getUTCFullYear();
  const yearStart=new Date(Date.UTC(y,0,1));
  const weekNo=Math.ceil(((d-yearStart)/86400000+1)/7);
  return `${y}-W${String(weekNo).padStart(2,'0')}`;
}
function isPercent(meta, actual){
  const sMeta=String(meta||''), sAct=String(actual||'');
  if (/%/.test(sMeta) || /%/.test(sAct)) return true;
  const m=toNumberOrNull(meta), a=toNumberOrNull(actual);
  if (m!=null && a!=null){
    if ((m>0&&m<=1) || (a>0&&a<=1)) return true;
  }
  return false;
}
function fmtDisplayPercent(v){
  const n=toNumberOrNull(v);
  if (n==null) return String(v||'');
  return /%/.test(String(v)) ? String(v) : `${(n*100).toFixed(2)}%`;
}
function getTol(){ return Math.max(0, Math.min(50, Number(localStorage.getItem('tolPct')||'5')))/100; }
function evaluarEstado({tipo, meta, actual, direccion}){
  const tol=getTol();
  if (tipo==='informativo') return {estado:'Info', color:'azul'};
  const m=toNumberOrNull(meta), a=toNumberOrNull(actual);
  if (m===null || a===null) return {estado:'Info', color:'azul'};
  if (direccion==='menor'){
    if (a<=m) return {estado:'Cumple', color:'verde'};
    if (a<=m*(1+tol)) return {estado:'Cerca', color:'amarillo'};
    return {estado:'Crítico', color:'rojo'};
  } else if (direccion==='mayor'){
    if (a>=m) return {estado:'Cumple', color:'verde'};
    if (a>=m*(1-tol)) return {estado:'Cerca', color:'amarillo'};
    return {estado:'Crítico', color:'rojo'};
  }
  return {estado:'Info', color:'azul'};
}
// Mapeo ES→EN clases
const COLOR_CLASS = { verde:'green', amarillo:'yellow', rojo:'red', azul:'blue' };

// --------- Auth SOLO en Admin ----------
const AUTH_KEY = 'scorecardUser';
// ⚠️ Mantenemos tus usuarios exactos
const USERS = [
  { user:'silver',               pass:'admin123',   role:'admin'  },
  { user:'alejandro.gracida',    pass:'viewer123',  role:'viewer' },
  { user:'alejandro.baeza',      pass:'viewer123',  role:'viewer' },
  { user:'carmen.lopez',         pass:'viewer123',  role:'viewer' },
  { user:'jaime.castro',         pass:'viewer123',  role:'viewer' }
];
function getUser(){
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)||'null'); }
  catch(e){ return null; }
}
function setUser(u){ localStorage.setItem(AUTH_KEY, JSON.stringify(u)); paintAuthBar(); enforceGateAndRole(); }
function logout(){ localStorage.removeItem(AUTH_KEY); paintAuthBar(); enforceGateAndRole(); }
function tryLogin(user, pass){
  const match = USERS.find(u => u.user === user && u.pass === pass);
  if (match){ setUser({user:match.user, role:match.role}); return true; }
  return false;
}
// Barra auth + bloqueos
function paintAuthBar(){
  const box = $('#authStatus'); if (!box) return;
  const u = getUser();
  box.innerHTML = u
    ? `👤 ${u.user} (${u.role}) <button id="btnLogout" class="btn">Salir</button>`
    : `<button id="btnLogin" class="btn primary">Iniciar sesión</button>`;
  const btnLogin = $('#btnLogin');  if (btnLogin)  btnLogin.addEventListener('click', ()=> $('#loginDialog').showModal());
  const btnLogout= $('#btnLogout'); if (btnLogout) btnLogout.addEventListener('click', logout);
  const isAdmin = !!u && u.role === 'admin';
  ['addAreaBtn','saveAll','exportBtn','importBtn','configBtn','saveCfg'].forEach(id=>{
    const el=document.getElementById(id);
    if (el) el.disabled = !isAdmin;
  });
}
// Gate + rol
function showGate(){ const g=$('#authGate'); if (g){ g.hidden=false; document.body.style.overflow='hidden'; } }
function hideGate(){ const g=$('#authGate'); if (g){ g.hidden=true;  document.body.style.overflow='auto';   } }
function enforceGateAndRole(){
  const u = getUser();
  if (!u){ showGate(); return; }           // sin usuario → gate
  if (u.role !== 'admin'){                 // viewer en Admin → Exec
    window.location.href = './exec/index.html';
    return;
  }
  hideGate();                              // admin → entra
}
document.addEventListener('DOMContentLoaded', ()=>{ if (!getUser()) showGate(); });
const gateBtn = document.getElementById('gateLoginBtn');
if (gateBtn){ gateBtn.addEventListener('click', ()=> $('#loginDialog').showModal()); }

// --------- IndexedDB ----------
let db;
function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('scorecardDB_programa_multiareas_v1',1);
    req.onupgradeneeded=e=>{
      const db=e.target.result;
      if (!db.objectStoreNames.contains('kpis')){
        const st=db.createObjectStore('kpis',{keyPath:'id',autoIncrement:true});
        st.createIndex('byKey',['area','programa','fecha'],{unique:false});
        st.createIndex('byPrograma',['programa'],{unique:false});
      }
    };
    req.onsuccess=()=>{ db=req.result; resolve(db); };
    req.onerror =()=> reject(req.error);
  });
}
function getDaily(area, programa, fecha){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('kpis','readonly');
    const st=tx.objectStore('kpis'); const idx=st.index('byKey');
    const rq=idx.getAll([area,programa,fecha]);
    rq.onsuccess=()=>resolve(rq.result||[]);
    rq.onerror =()=>reject(rq.error);
  });
}
function getAllByPrograma(programa){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('kpis','readonly');
    const st=tx.objectStore('kpis'); const idx=st.index('byPrograma');
    const rq=idx.getAll([programa]);
    rq.onsuccess=()=>resolve(rq.result||[]);
    rq.onerror =()=>reject(rq.error);
  });
}
function bulkSaveDaily(records, area, programa, fecha){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('kpis','readwrite');
    const st=tx.objectStore('kpis'); const idx=st.index('byKey');
    const keysReq=idx.getAllKeys([area,programa,fecha]);
    keysReq.onsuccess=()=>{
      (keysReq.result||[]).forEach(k=> st.delete(k));
      (records||[]).forEach(r=> st.put(r));
    };
    tx.oncomplete=()=>resolve(true);
    tx.onerror   =()=>reject(tx.error);
  });
}
async function exportAll(){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('kpis','readonly');
    const st=tx.objectStore('kpis');
    const rq=st.getAll();
    rq.onsuccess=()=>resolve(rq.result||[]);
    rq.onerror  =()=>reject(rq.error);
  });
}

// --------- Configuración y catálogos ----------
function normalizeAreas(list){
  const norm=list.map(s=> s.trim()).filter(Boolean)
    .map(s=> s.replace(/Output\s+Past\s+DVE/i,'Output Past DUE'));
  const seen=new Set(); const out=[];
  norm.forEach(a=>{
    const key=a.toLowerCase();
    if (!seen.has(key)){ seen.add(key); out.push(a); }
  });
  return out;
}
function getAreas(){
  const def='Safety, Quality, People, Delivery, Cost/Productividad, Supply Chain, EBIT, CI, Primarios, LTPO, Output Past DUE';
  const raw=(localStorage.getItem('areas')||def).split(',');
  return normalizeAreas(raw);
}
function setAreas(newAreas){ localStorage.setItem('areas', normalizeAreas(newAreas).join(', ')); }
// ✅ Default Programas como en tu SCS2
function getProgramas(){
  const def='PRIMARIOS, A220, COMAC, BOEING, WAREHOUSE';
  return (localStorage.getItem('programas')||def).split(',').map(s=>s.trim()).filter(Boolean);
}
function areaId(area){ return 'area_'+area.replace(/\s+/g,'_').toLowerCase(); }
function tbodyId(area){ return 'tbody_'+areaId(area); }

// --------- UI por área ----------
function buildAreaBlock(area, themeIdx){
  const cont=document.getElementById('areasContainer');
  const id=areaId(area);
  if (document.getElementById(id)) return;
  const block=document.createElement('section');
  block.className='area-block area-theme-'+themeIdx; block.id=id;
  block.innerHTML =
`<div class="area-head">
  <div class="area-title">${area}</div>
  <div class="area-actions">
    <button class="btn" data-area="${area}">➕ Añadir KPI</button>
    <button class="btn" data-savearea="${area}">💾 Guardar área</button>
    <button class="btn" data-rmarea="${area}">🗑️ Eliminar área</button>
  </div>
</div>
<div class="table-wrap">
  <div class="table-container">
    <table>
      <thead><tr>
        <th>KPI</th><th>Tipo</th><th>Meta</th><th>Actual</th>
        <th>Dirección</th><th>Estado</th><th>Color</th><th>Notas</th><th>Acciones</th>
      </tr></thead>
      <tbody id="${tbodyId(area)}"></tbody>
    </table>
  </div>
</div>
<p class="hint">Área: ${area} · Semáforo:
  <span class="dot green"></span> Verde /
  <span class="dot yellow"></span> Amarillo /
  <span class="dot red"></span> Rojo /
  <span class="dot blue"></span> Azul.
  Tolerancia ±${localStorage.getItem('tolPct')||'5'}%.</p>`;
  cont.appendChild(block);
  block.querySelector('button.btn[data-area]').addEventListener('click', ()=> newRow(area));
  block.querySelector('button.btn[data-savearea]').addEventListener('click', ()=> saveArea(area));
  block.querySelector('button.btn[data-rmarea]').addEventListener('click', ()=> removeArea(area));
}
function buildAreas(){
  const cont=document.getElementById('areasContainer');
  cont.innerHTML='';
  const areas=getAreas();
  areas.forEach((area, idx)=> buildAreaBlock(area, (idx%11)+1));
}

// --------- Filas KPI ----------
function clearArea(area){
  const tb=document.getElementById(tbodyId(area));
  if (tb) tb.innerHTML='';
}
function newRow(area, data){
  const tbody=document.getElementById(tbodyId(area));
  const tr=document.createElement('tr');
  tr.innerHTML =
`<td><input type="text" class="inp-kpi"   placeholder="Incidentes / OTD / Scrap / etc."></td>
 <td><select class="inp-tipo">
   <option value="cuantitativo">Cuantitativo</option>
   <option value="informativo">Informativo</option>
 </select></td>
 <td><input type="text" class="inp-meta"   placeholder="0 / 95% / Programada"></td>
 <td><input type="text" class="inp-actual" placeholder="0 / 92% / Feb 2026"></td>
 <td><select class="inp-dir">
   <option value="menor">Menor es mejor</option>
   <option value="mayor">Mayor es mejor</option>
   <option value="na">N/A</option>
 </select></td>
 <td class="td-estado"><span class="badge blue">Info</span></td>
 <td class="td-color"><span class="dot blue"></span></td>
 <td><input type="text" class="inp-notas" placeholder="Notas"></td>
 <td class="actions">
   <button class="btn" title="Duplicar">📄</button>
   <button class="btn" title="Eliminar">🗑️</button>
 </td>`;
  tbody.appendChild(tr);
  if (data){
    $('.inp-kpi',tr).value   = data.kpi || '';
    $('.inp-tipo',tr).value  = data.tipo || 'cuantitativo';
    $('.inp-meta',tr).value  = data.meta ?? '';
    $('.inp-actual',tr).value= data.actual ?? '';
    $('.inp-dir',tr).value   = data.direccion || 'na';
    $('.inp-notas',tr).value = data.nota || data.notas || '';
  }
  $$('.inp-kpi, .inp-tipo, .inp-meta, .inp-actual, .inp-dir, .inp-notas', tr)
    .forEach(el=> el.addEventListener('input', ()=> refreshRow(tr)));
  const [dup,del] = $$('.actions .btn', tr);
  dup.addEventListener('click', ()=>{
    const rec=rowToRecord(area,tr);
    const ntr=newRow(area, rec);
    tr.after(ntr);
    refreshAllCounters();
  });
  del.addEventListener('click', ()=>{
    tr.remove();
    refreshAllCounters();
  });
  refreshRow(tr);
  return tr;
}
function refreshRow(tr){
  const tipo=$('.inp-tipo',tr).value;
  const meta=$('.inp-meta',tr).value;
  const actual=$('.inp-actual',tr).value;
  const dir=$('.inp-dir',tr).value;
  const ev=evaluarEstado({tipo, meta, actual, direccion:dir});
  const cls = COLOR_CLASS[ev.color] || 'blue';
  $('.td-estado',tr).innerHTML=`<span class="badge ${cls}">${ev.estado}</span>`;
  $('.td-color',tr).innerHTML =`<span class="dot ${cls}"></span>`;
  refreshAllCounters();
}
function rowToRecord(area,tr){
  const fecha   = $('#fecha').value || todayLocal();
  const programa= $('#programa').value;
  const tipo    = $('.inp-tipo',tr).value;
  const meta    = $('.inp-meta',tr).value;
  const actual  = $('.inp-actual',tr).value;
  const direccion=$('.inp-dir',tr).value;
  const notas   = $('.inp-notas',tr).value;
  const {estado,color}=evaluarEstado({tipo, meta, actual, direccion});
  return {
    fecha, area, programa,
    kpi:$('.inp-kpi',tr).value,
    tipo, meta, actual, direccion, estado, color, notas,
    ts:Date.now()
  };
}
function tableToRecords(area){
  const tb=document.getElementById(tbodyId(area));
  return Array.from(tb.querySelectorAll('tr')).map(tr=> rowToRecord(area,tr));
}
function recordsToTable(area,list){
  const tb=document.getElementById(tbodyId(area)); tb.innerHTML='';
  (list||[]).forEach(r=> newRow(area,r));
}

// --------- Operaciones de áreas ----------
function addAreaInteractive(){
  const name=(prompt('Nombre del área nueva:')||'').trim();
  if (!name) return;
  const clean=name.replace(/Output\s+Past\s+DVE/i,'Output Past DUE');
  const areas=getAreas(); const key=clean.toLowerCase();
  if (areas.map(a=>a.toLowerCase()).includes(key)){
    alert('El área ya existe.'); return;
  }
  areas.push(clean);
  setAreas(areas);
  buildAreas();
  clearArea(clean);
  loadArea(clean);
  refreshWeeklyAllPrograms();
}
function removeArea(area){
  if (!confirm(`¿Eliminar el área "${area}" de la vista? (No borra datos históricos)`)) return;
  const areas=getAreas().filter(a=> a.toLowerCase()!==area.toLowerCase());
  setAreas(areas);
  const el=document.getElementById(areaId(area));
  if (el) el.remove();
  refreshAllCounters();
  refreshWeeklyAllPrograms();
}

// --------- Guardar / Cargar ----------
async function saveArea(area){
  const fecha   = $('#fecha').value || todayLocal();
  const programa= $('#programa').value;
  const recs=tableToRecords(area);
  await bulkSaveDaily(recs, area, programa, fecha);
  alert(`Área "${area}" guardada ✔`);
  await refreshWeeklyAllPrograms();
}
async function saveAll(){
  const fecha   = $('#fecha').value || todayLocal();
  const programa= $('#programa').value;
  const areas=getAreas();
  await Promise.all(areas.map(area=> bulkSaveDaily(tableToRecords(area), area, programa, fecha)));
  alert('Guardado ✔');
  await refreshWeeklyAllPrograms();
}

// --------- Contadores ----------
function refreshAllCounters(){
  const areas=getAreas();
  const all = areas.flatMap(a=> tableToRecords(a));
  const counts={verde:0,amarillo:0,rojo:0,azul:0};
  all.forEach(r=>{ counts[r.color] = (counts[r.color]||0)+1; });
  $('#cntGreen').textContent  = counts.verde   || 0;
  $('#cntYellow').textContent = counts.amarillo|| 0;
  $('#cntRed').textContent    = counts.rojo    || 0;
  $('#cntBlue').textContent   = counts.azul    || 0;
}

// --------- Exportar / Importar ----------
function handleExport(){
  exportAll().then(all=>{
    const meta={
      app:'scorecard-programa-multiareas', version:1,
      exportedAt:new Date().toISOString(),
      programas:localStorage.getItem('programas')||'',
      areas:    localStorage.getItem('areas')    ||'',
      tolPct:   localStorage.getItem('tolPct')   ||'5'
    };
    const txt=JSON.stringify({meta, data:all}, null, 2);
    const fn='scorecard_export_'+todayLocal()+'.json';
    const blob=new Blob([txt],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=fn; a.click();
    setTimeout(()=> URL.revokeObjectURL(url), 2000);
  });
}
function handleImport(){
  const picker=$('#filePicker');
  picker.onchange=async (ev)=>{
    const file=ev.target.files[0]; if (!file) return;
    const text=await file.text();
    try{
      const json=JSON.parse(text);
      if (json.meta){
        if (json.meta.programas) localStorage.setItem('programas', json.meta.programas);
        if (json.meta.areas)     localStorage.setItem('areas',    json.meta.areas);
        if (json.meta.tolPct)    localStorage.setItem('tolPct',   String(json.meta.tolPct));
        fillProgramas(); buildAreas();
        $('#tolQuick').value = localStorage.getItem('tolPct')||'5';
        $('#tolPctView').textContent = localStorage.getItem('tolPct')||'5';
      }
      const tx=db.transaction('kpis','readwrite'); const st=tx.objectStore('kpis'); st.clear();
      (json.data||[]).forEach(r=> st.put(r));
      tx.oncomplete=()=> loadAllAreas();
    }catch(err){
      alert('No se pudo importar: '+err.message);
    }
  };
  picker.click();
}

// --------- Configuración ----------
function openConfig(){
  $('#programasInput').value=(localStorage.getItem('programas')||'PRIMARIOS, A220, COMAC, BOEING, WAREHOUSE');
  $('#areasInput').value=(localStorage.getItem('areas')||'Safety, Quality, People, Delivery, Cost/Productividad, Supply Chain, EBIT, CI, Primarios, LTPO, Output Past DUE');
  $('#tolPctInput').value=(localStorage.getItem('tolPct')||'5');
  $('#config').showModal();
}
function saveConfig(){
  const progs   = $('#programasInput').value.trim();
  const areasRaw= $('#areasInput').value.trim();
  const tolPct  = String(Math.max(0, Math.min(50, Number($('#tolPctInput').value||5))));
  localStorage.setItem('programas', progs);
  setAreas(areasRaw.split(','));
  localStorage.setItem('tolPct', tolPct);
  fillProgramas(); buildAreas();
  $('#tolQuick').value   = tolPct;
  $('#tolPctView').textContent = tolPct;
  $('#config').close(); loadAllAreas(); refreshWeeklyAllPrograms();
}

// --------- Carga de áreas ----------
async function loadArea(area){
  const fecha   = $('#fecha').value || todayLocal();
  const programa= $('#programa').value;
  clearArea(area);
  const list=await getDaily(area, programa, fecha);
  if ((list||[]).length>0){
    recordsToTable(area, list);
  } else {
    // Sin datos guardados → una fila vacía para comodidad
    newRow(area);
  }
}
async function loadAllAreas(){
  const areas=getAreas();
  await Promise.all(areas.map(a=> loadArea(a)));
  refreshAllCounters();
  await refreshWeeklyAllPrograms();
}

// --------- Agregación semanal ----------
function aggregateWeekly(records){
  const groups=new Map();
  records.forEach(r=>{
    const key=[r.area, r.kpi, r.tipo||'cuantitativo', r.direccion||'na'].join('\n');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  const rows=[]; const counts={verde:0,amarillo:0,rojo:0,azul:0};
  groups.forEach((list)=>{
    const s=list[0];
    const area=s.area, tipo=s.tipo||'cuantitativo', dir=s.direccion||'na';
    let metaSem=s.meta, actSem=s.actual;
    const numsMeta=list.map(x=> toNumberOrNull(x.meta)).filter(x=> x!=null);
    const numsAct =list.map(x=> toNumberOrNull(x.actual)).filter(x=> x!=null);
    const perc=isPercent(s.meta, s.actual);
    if (perc){
      const avgAct = numsAct.length? (numsAct.reduce((a,b)=>a+b,0)/numsAct.length): null;
      const avgMeta= numsMeta.length? (numsMeta.reduce((a,b)=>a+b,0)/numsMeta.length): null;
      actSem =(avgAct !=null)? avgAct : s.actual;
      metaSem=(avgMeta!=null)? avgMeta: s.meta;
    }else{
      const sumAct = numsAct.length? numsAct.reduce((a,b)=>a+b,0): null;
      const sumMeta= numsMeta.length? numsMeta.reduce((a,b)=>a+b,0): null;
      actSem =(sumAct !=null)? sumAct : s.actual;
      metaSem=(sumMeta!=null)? sumMeta: s.meta;
    }
    const {estado,color}=evaluarEstado({tipo, meta:metaSem, actual:actSem, direccion:dir});
    counts[color]=(counts[color]||0)+1;
    rows.push({area, kpi:s.kpi, tipo, meta:metaSem, actual:actSem, direccion:dir, estado, color, perc});
  });
  return {rows, counts};
}

// --------- Resumen semanal (Admin) ----------
async function refreshWeeklyAllPrograms(){
  const fecha   = $('#fecha').value || todayLocal();
  const isoWeek = isoWeekString(fecha);
  const weeklyRoot=$('#weeklyPrograms'); weeklyRoot.innerHTML='';
  const programas=getProgramas();
  const areasList=getAreas();
  for (const programa of programas){
    const allProg=await getAllByPrograma(programa);
    const weekRecords=(allProg||[]).filter(r=> isoWeekString(r.fecha)===isoWeek);
    const {rows,counts}=aggregateWeekly(weekRecords);
    // Áreas sin datos
    const presentAreas=new Set(rows.map(r=> r.area));
    areasList.forEach(area=>{
      if (!presentAreas.has(area)){
        rows.push({area, kpi:'(sin datos guardados esta semana)', tipo:'informativo', meta:'—', actual:'—', direccion:'na', estado:'Info', color:'azul', perc:false});
      }
    });
    // Render program block
    const block=document.createElement('section'); block.className='program-block';
    const head=document.createElement('div'); head.className='program-head';
    head.innerHTML=`<div class="program-name">${programa}</div><small>Semana ${isoWeek}</small>`;
    const body=document.createElement('div'); body.className='program-body';
    const kpis=document.createElement('div'); kpis.className='program-kpis';
    kpis.innerHTML =
`<div class="card"><div class="kpi"><span class="dot green"></span><strong>Verdes:</strong><span>${counts.verde||0}</span></div></div>
 <div class="card"><div class="kpi"><span class="dot yellow"></span><strong>Amarillos:</strong><span>${counts.amarillo||0}</span></div></div>
 <div class="card"><div class="kpi"><span class="dot red"></span><strong>Rojos:</strong><span>${counts.rojo||0}</span></div></div>
 <div class="card"><div class="kpi"><span class="dot blue"></span><strong>Informativos:</strong><span>${counts.azul||0}</span></div></div>`;
    body.appendChild(kpis);
    const wrap=document.createElement('div'); wrap.className='program-table';
    const tableContainer=document.createElement('div'); tableContainer.className='table-container';
    const table=document.createElement('table');
    table.innerHTML='<thead><tr><th>Área</th><th>KPI</th><th>Tipo</th><th>Meta (sem)</th><th>Actual (sem)</th><th>Dirección</th><th>Estado</th><th>Color</th></tr></thead>';
    const tbody=document.createElement('tbody');
    rows.forEach(r=>{
      const cls = COLOR_CLASS[r.color] || 'blue';
      const metaDisp = r.perc ? fmtDisplayPercent(r.meta) : String(r.meta);
      const actDisp  = r.perc ? fmtDisplayPercent(r.actual) : String(r.actual);
      const dirLabel = ({menor:'Menor es mejor', mayor:'Mayor es mejor', na:'N/A'})[r.direccion] || 'N/A';
      const tr=document.createElement('tr');
      tr.innerHTML =
`<td>${r.area}</td>
 <td>${r.kpi}</td>
 <td>${r.tipo}</td>
 <td>${metaDisp}</td>
 <td>${actDisp}</td>
 <td>${dirLabel}</td>
 <td><span class="badge ${cls}">${r.estado}</span></td>
 <td><span class="dot ${cls}"></span></td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); tableContainer.appendChild(table); wrap.appendChild(tableContainer);
    body.appendChild(wrap); block.appendChild(head); block.appendChild(body);
    weeklyRoot.appendChild(block);
  }
  $('#tolPctView').textContent=localStorage.getItem('tolPct')||'5';
}

// --------- Programa y fecha ----------
function fillProgramas(){
  const sel=$('#programa'); sel.innerHTML='';
  getProgramas().forEach(p=>{
    const o=document.createElement('option');
    o.value=p; o.textContent=p;
    sel.appendChild(o);
  });
}

// --------- INIT ----------
(async function init(){
  await openDB();
  fillProgramas(); buildAreas();
  $('#fecha').value=todayLocal();
  $('#tolQuick').value=localStorage.getItem('tolPct')||'5';
  // Toolbar
  $('#tolQuick').addEventListener('change', ()=>{
    const v=String(Math.max(0, Math.min(50, Number($('#tolQuick').value||5))));
    localStorage.setItem('tolPct', v);
    $('#tolPctView').textContent=v;
    refreshAllCounters();
    refreshWeeklyAllPrograms();
  });
  $('#programa').addEventListener('change', ()=>{
    getAreas().forEach(a=> clearArea(a));
    loadAllAreas();
  });
  $('#fecha').addEventListener('change', ()=>{
    getAreas().forEach(a=> clearArea(a));
    loadAllAreas();
  });
  // Botones principales
  $('#addAreaBtn').addEventListener('click', addAreaInteractive);
  $('#saveAll').addEventListener('click', saveAll);
  $('#exportBtn').addEventListener('click', handleExport);
  $('#importBtn').addEventListener('click', handleImport);
  // Configuración
  let cfgBtn=document.getElementById('configBtn');
  if (!cfgBtn){
    cfgBtn=document.createElement('button');
    cfgBtn.id='configBtn';
    cfgBtn.className='btn primary';
    cfgBtn.textContent='⚙️ Configuración';
    $('.toolbar').appendChild(cfgBtn);
  }
  cfgBtn.addEventListener('click', openConfig);
  $('#saveCfg').addEventListener('click', saveConfig);
  // Autenticación
  paintAuthBar(); enforceGateAndRole();
  const lf = document.getElementById('loginForm');
  if (lf){
    lf.addEventListener('submit', (e)=>{
      e.preventDefault();
      const user = document.getElementById('loginUser').value.trim();
      const pass = document.getElementById('loginPass').value;
      if (tryLogin(user, pass)){
        document.getElementById('loginDialog').close();
      } else {
        alert('Usuario o contraseña incorrectos');
      }
    });
  }
  // Carga inicial de datos
  await loadAllAreas();
  await refreshWeeklyAllPrograms();
})();
