
/* =========================================================
 Exec - Scorecard Safran Cabin (SIN login aquí)
 - Botón ↩️ Regresar a Admin (cierra sesión y lleva al login)
 - Resumen semanal con colores y Notas visibles
 - Exportar CSV (programa)
 - Exportar CSV (TODOS los programas)
 - Importar ISO (JSON exportado por Admin)
 - ✅ Default de programas igual que Admin: PRIMARIOS, A220, COMAC, BOEING, WAREHOUSE
 ========================================================= */

// ===== Cerrar sesión y regresar a Admin =====
const AUTH_KEY = 'scorecardUser'; // mismo nombre que usa admin.js
function hardLogoutToAdmin(){
  try { localStorage.removeItem(AUTH_KEY); } catch(e){}
  if (navigator.serviceWorker && navigator.serviceWorker.controller){
    navigator.serviceWorker.controller.postMessage({type:'FLUSH'});
  }
  window.location.href = '../index.html'; // Admin en /docs/
}

// --------- Utilidades ---------
const $ = (sel, ctx=document) => ctx.querySelector(sel);
function toNumberOrNull(v){ if (v===undefined || v===null) return null; const n=Number(String(v).replace(/[^\-0-9\.]/g,'').trim()); return Number.isFinite(n)?n:null; }
function todayLocal(){ const d=new Date(); const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), da=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${da}`; }
function isoWeekString(dStr){ const [Y,M,D]=dStr.split('-').map(Number); const d=new Date(Date.UTC(Y,M-1,D)); const dayNum=d.getUTCDay()||7; d.setUTCDate(d.getUTCDate()+4-dayNum); const y=d.getUTCFullYear(); const yearStart=new Date(Date.UTC(y,0,1)); const weekNo=Math.ceil(((d-yearStart)/86400000+1)/7); return `${y}-W${String(weekNo).padStart(2,'0')}`; }
function isPercent(meta,actual){ const sMeta=String(meta||''), sAct=String(actual||''); if (/%/.test(sMeta)||/%/.test(sAct)) return true; const m=toNumberOrNull(meta), a=toNumberOrNull(actual); if (m!=null&&a!=null){ if ((m>0&&m<=1)||(a>0&&a<=1)) return true; } return false; }
function fmtDisplayPercent(v){ const n=toNumberOrNull(v); if (n==null) return String(v||''); return /%/.test(String(v)) ? String(v) : `${(n*100).toFixed(2)}%`; }
function getTol(){ return Math.max(0, Math.min(50, Number(localStorage.getItem('tolPct')||'5')))/100; }
function evaluarEstado({tipo, meta, actual, direccion}){ const tol=getTol(); if (tipo==='informativo') return {estado:'Info', color:'azul'}; const m=toNumberOrNull(meta), a=toNumberOrNull(actual); if (m===null||a===null) return {estado:'Info', color:'azul'}; if (direccion==='menor'){ if (a<=m) return {estado:'Cumple', color:'verde'}; if (a<=m*(1+tol)) return {estado:'Cerca', color:'amarillo'}; return {estado:'Crítico', color:'rojo'}; } else if (direccion==='mayor'){ if (a>=m) return {estado:'Cumple', color:'verde'}; if (a>=m*(1-tol)) return {estado:'Cerca', color:'amarillo'}; return {estado:'Crítico', color:'rojo'}; } return {estado:'Info', color:'azul'}; }
const COLOR_CLASS = { verde:'green', amarillo:'yellow', rojo:'red', azul:'blue' };

// --------- IndexedDB (lectura/escritura interna) ---------
let db;
function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('scorecardDB_programa_multiareas_v1',1);
    req.onupgradeneeded = e=>{
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
function getAllByPrograma(programa){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('kpis','readonly'); const st=tx.objectStore('kpis'); const idx=st.index('byPrograma');
    const rq=idx.getAll([programa]); rq.onsuccess=()=>resolve(rq.result||[]); rq.onerror=()=>reject(rq.error);
  });
}

// ===== Notas semanales =====
function pickWeeklyNotes(list){
  const withNotes = list.filter(r => (r.notas && String(r.notas).trim()!==''));
  if (withNotes.length > 0){
    const latest = withNotes.reduce((a,b) => (Number(a.ts||0) >= Number(b.ts||0) ? a : b));
    return latest.notas;
  }
  const uniq = Array.from(new Set(list.map(r => (r.notas||'').trim()).filter(s => s.length>0)));
  return uniq.join(' · ');
}

// --------- Agregación semanal (incluye "notas") ---------
function aggregateWeekly(records){
  const groups=new Map();
  records.forEach(r=>{
    const key=[r.area, r.kpi, r.tipo||'cuantitativo', r.direccion||'na'].join('\n');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  const rows=[]; const counts={verde:0,amarillo:0,rojo:0,azul:0};
  groups.forEach((list)=>{
    const s=list[0]; const area=s.area, tipo=s.tipo||'cuantitativo', dir=s.direccion||'na';
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
      const sumMeta= numsMeta.length?  numsMeta.reduce((a,b)=>a+b,0): null;
      actSem =(sumAct !=null)? sumAct : s.actual;
      metaSem=(sumMeta!=null)? sumMeta: s.meta;
    }
    const notasSem = pickWeeklyNotes(list);
    const {estado,color}=evaluarEstado({tipo, meta:metaSem, actual:actSem, direccion:dir});
    counts[color]=(counts[color]||0)+1;
    rows.push({area, kpi:s.kpi, tipo, meta:metaSem, actual:actSem, direccion:dir, estado, color, perc, notas:notasSem});
  });
  return {rows, counts};
}

// --------- Catálogos ---------
function getAreas(){
  const def='Safety, Quality, People, Delivery, Cost/Productividad, Supply Chain, EBIT, CI, Primarios, LTPO, Output Past DUE';
  const raw=(localStorage.getItem('areas')||def).split(',');
  return raw.map(s=> s.trim()).filter(Boolean);
}
// ✅ Default Programas igual a Admin
function getProgramas(){
  const def='PRIMARIOS, A220, COMAC, BOEING, WAREHOUSE';
  return (localStorage.getItem('programas') || def).split(',').map(s=> s.trim()).filter(Boolean);
}

// --------- CSV helpers ---------
function rowsToCSV(rows){
  const headers = ['Area','KPI','Tipo','Meta(sem)','Actual(sem)','Direccion','Estado','Color','Notas'];
  const lines = [headers.join(',')];
  rows.forEach(r=>{
    const line = [
      `"${r.area}"`, `"${r.kpi}"`, `"${r.tipo}"`,
      `"${r.perc ? fmtDisplayPercent(r.meta) : r.meta}"`,
      `"${r.perc ? fmtDisplayPercent(r.actual) : r.actual}"`,
      `"${({menor:'Menor es mejor', mayor:'Mayor es mejor', na:'N/A'})[r.direccion] || 'N/A'}"`,
      `"${r.estado}"`, `"${r.color}"`, `"${(r.notas||'').replace(/"/g,'""')}"`
    ].join(',');
    lines.push(line);
  });
  return lines.join('\n');
}
function rowsToCSVAll(programRows){
  const headers = ['Programa','Area','KPI','Tipo','Meta(sem)','Actual(sem)','Direccion','Estado','Color','Notas'];
  const lines = [headers.join(',')];
  programRows.forEach(item=>{
    const programa = item.programa;
    (item.rows||[]).forEach(r=>{
      const line = [
        `"${programa}"`, `"${r.area}"`, `"${r.kpi}"`, `"${r.tipo}"`,
        `"${r.perc ? fmtDisplayPercent(r.meta) : r.meta}"`,
        `"${r.perc ? fmtDisplayPercent(r.actual) : r.actual}"`,
        `"${({menor:'Menor es mejor', mayor:'Mayor es mejor', na:'N/A'})[r.direccion] || 'N/A'}"`,
        `"${r.estado}"`, `"${r.color}"`, `"${(r.notas||'').replace(/"/g,'""')}"`
      ].join(',');
      lines.push(line);
    });
  });
  return lines.join('\n');
}
function downloadCSV(filename, csv){
  const blob = new Blob([csv], {type:'text/csv'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href=url; a.download=filename; a.click();
  setTimeout(()=> URL.revokeObjectURL(url), 2000);
}

// ===== Importar ISO (JSON exportado por Admin) =====
async function importISOFromFile(file){
  const text = await file.text();
  let json;
  try{ json = JSON.parse(text); }
  catch(err){ alert('El archivo no es un JSON válido.'); return; }

  // Actualizar catálogos/tolerancia desde meta (si están)
  if (json.meta){
    if (json.meta.programas) localStorage.setItem('programas', json.meta.programas);
    if (json.meta.areas)     localStorage.setItem('areas',    json.meta.areas);
    if (json.meta.tolPct)    localStorage.setItem('tolPct',   String(json.meta.tolPct));
  }

  // Volcar data al IndexedDB (sustituir)
  await new Promise((resolve,reject)=>{
    const tx=db.transaction('kpis','readwrite'); const st=tx.objectStore('kpis');
    st.clear();
    (json.data||[]).forEach(r=> st.put(r));
    tx.oncomplete=()=> resolve(true);
    tx.onerror   =()=> reject(tx.error);
  });

  // Rellenar selector de programas por si cambiaron
  const sel=document.getElementById('programaExec'); sel.innerHTML='';
  getProgramas().forEach(p=>{ const o=document.createElement('option'); o.value=p; o.textContent=p; sel.appendChild(o); });

  await renderExec();
}

// --------- Render del resumen semanal (Exec) ---------
async function renderExec(){
  const fecha = document.getElementById('fechaExec').value || todayLocal();
  const isoWeek = isoWeekString(fecha);
  const sel=document.getElementById('programaExec');
  const programa = sel.value || (sel.options[0]?.value) || 'PRIMARIOS';

  const allProg = await getAllByPrograma(programa);
  const weekRecords = (allProg||[]).filter(r=> isoWeekString(r.fecha)===isoWeek);
  const {rows,counts} = aggregateWeekly(weekRecords);

  // Áreas sin datos → fila informativa
  const areasList=getAreas(); const presentAreas=new Set(rows.map(r=> r.area));
  areasList.forEach(area=>{
    if (!presentAreas.has(area)){
      rows.push({area, kpi:'(sin datos guardados esta semana)', tipo:'informativo', meta:'—', actual:'—', direccion:'na', estado:'Info', color:'azul', perc:false, notas:''});
    }
  });

  // Conteos
  document.getElementById('execCntGreen').textContent  = counts.verde   || 0;
  document.getElementById('execCntYellow').textContent = counts.amarillo|| 0;
  document.getElementById('execCntRed').textContent    = counts.rojo    || 0;
  document.getElementById('execCntBlue').textContent   = counts.azul    || 0;
  document.getElementById('execTolPctView').textContent= localStorage.getItem('tolPct')||'5';

  const root = document.getElementById('execWeeklyTable'); root.innerHTML='';
  const block = document.createElement('section'); block.className='program-block';
  const head = document.createElement('div'); head.className='program-head';
  head.innerHTML = `<div class="program-name">${programa}</div><small>Semana ${isoWeek}</small>`;
  const body = document.createElement('div'); body.className='program-body';

  // KPIs arriba (conteos)
  const kpis=document.createElement('div'); kpis.className='program-kpis';
  kpis.innerHTML =
`<div class="card"><div class="kpi"><span class="dot green"></span><strong>Verdes:</strong><span>${counts.verde||0}</span></div></div>
 <div class="card"><div class="kpi"><span class="dot yellow"></span><strong>Amarillos:</strong><span>${counts.amarillo||0}</span></div></div>
 <div class="card"><div class="kpi"><span class="dot red"></span><strong>Rojos:</strong><span>${counts.rojo||0}</span></div></div>
 <div class="card"><div class="kpi"><span class="dot blue"></span><strong>Informativos:</strong><span>${counts.azul||0}</span></div></div>`;
  body.appendChild(kpis);

  // Tabla semanal (incluye "Notas")
  const wrap = document.createElement('div'); wrap.className='program-table';
  const tableContainer=document.createElement('div'); tableContainer.className='table-container';
  const table=document.createElement('table');
  table.innerHTML='<thead><tr><th>Área</th><th>KPI</th><th>Tipo</th><th>Meta (sem)</th><th>Actual (sem)</th><th>Dirección</th><th>Estado</th><th>Color</th><th>Notas</th></tr></thead>';
  const tbody=document.createElement('tbody');
  rows.forEach(r=>{
    const cls = COLOR_CLASS[r.color] || 'blue';
    const metaDisp=r.perc ? fmtDisplayPercent(r.meta)   : String(r.meta);
    const actDisp =r.perc ? fmtDisplayPercent(r.actual) : String(r.actual);
    const dirLabel=({menor:'Menor es mejor', mayor:'Mayor es mejor', na:'N/A'})[r.direccion] || 'N/A';
    const notasDisp = (r.notas && String(r.notas).trim().length>0) ? r.notas : '—';
    const tr=document.createElement('tr');
    tr.innerHTML =
`<td>${r.area}</td><td>${r.kpi}</td><td>${r.tipo}</td>
 <td>${metaDisp}</td><td>${actDisp}</td><td>${dirLabel}</td>
 <td><span class="badge ${cls}">${r.estado}</span></td>
 <td><span class="dot ${cls}"></span></td>
 <td class="notes">${notasDisp}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody); tableContainer.appendChild(table); wrap.appendChild(tableContainer);
  body.appendChild(wrap); block.appendChild(head); block.appendChild(body);

  // Botones de exportación / import
  const csvBtn = document.createElement('button');
  csvBtn.className='btn'; csvBtn.textContent='⬇️ Exportar CSV (programa)';
  csvBtn.style.margin='8px 14px';
  csvBtn.addEventListener('click', ()=>{
    const csv = rowsToCSV(rows);
    const fn  = `semanal_${programa}_${isoWeek}.csv`;
    downloadCSV(fn, csv);
  });

  const csvAllBtn = document.createElement('button');
  csvAllBtn.className='btn'; csvAllBtn.textContent='⬇️ Exportar CSV (TODOS los programas)';
  csvAllBtn.style.margin='8px 8px';
  csvAllBtn.addEventListener('click', async ()=>{
    const programas = getProgramas();
    const pack = [];
    for (const prog of programas){
      const all = await getAllByPrograma(prog);
      const week = (all||[]).filter(r=> isoWeekString(r.fecha)===isoWeek);
      const {rows:progRows} = aggregateWeekly(week);
      const areas=getAreas(); const present=new Set(progRows.map(r=> r.area));
      areas.forEach(area=>{
        if (!present.has(area)){
          progRows.push({area, kpi:'(sin datos guardados esta semana)', tipo:'informativo', meta:'—', actual:'—', direccion:'na', estado:'Info', color:'azul', perc:false, notas:''});
        }
      });
      pack.push({programa: prog, rows: progRows});
    }
    const csvAll = rowsToCSVAll(pack);
    const fnAll  = `semanal_TODOS_${isoWeek}.csv`;
    downloadCSV(fnAll, csvAll);
  });

  const impBtn = document.createElement('button');
  impBtn.className = 'btn'; impBtn.textContent = '⬆️ Importar ISO';
  impBtn.style.margin = '8px 8px';
  const fileInput = document.createElement('input');
  fileInput.type  = 'file';
  fileInput.accept= 'application/json';
  fileInput.style.display = 'none';
  impBtn.addEventListener('click', ()=> fileInput.click());
  fileInput.addEventListener('change', async (ev)=>{
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    await importISOFromFile(file);
    fileInput.value = '';
  });

  root.appendChild(block);
  const btnWrap = document.createElement('div');
  btnWrap.style.display = 'flex';
  btnWrap.style.flexWrap = 'wrap';
  btnWrap.style.gap = '8px';
  btnWrap.style.padding = '8px 14px';
  btnWrap.appendChild(csvBtn);
  btnWrap.appendChild(csvAllBtn);
  btnWrap.appendChild(impBtn);
  btnWrap.appendChild(fileInput);
  root.appendChild(btnWrap);
}

// --------- INIT ---------
(async function init(){
  await openDB();
  document.getElementById('fechaExec').value = todayLocal();
  const sel=document.getElementById('programaExec'); sel.innerHTML='';
  getProgramas().forEach(p=>{ const o=document.createElement('option'); o.value=p; o.textContent=p; sel.appendChild(o); });

  // Botón “↩️ Regresar a Admin”
  const backBtn = document.getElementById('btnBackToAdmin');
  if (backBtn) backBtn.addEventListener('click', hardLogoutToAdmin);

  // Eventos y render
  sel.addEventListener('change', renderExec);
  document.getElementById('fechaExec').addEventListener('change', renderExec);
  await renderExec();
})();
