/* ===== Data Layer ===== */
const DB = {
  load() { try { return JSON.parse(localStorage.getItem('bili_pwa_v1') || '[]'); } catch { return []; } },
  save(v) { localStorage.setItem('bili_pwa_v1', JSON.stringify(v)); }
};

/* ===== State ===== */
let state = {
  videos:       DB.load(),
  filterMode:   'myTag',
  activeFilter: 'all',
  searchQ:      '',
  sortBy:       localStorage.getItem('bili_sort') || 'fav_desc',
  currentTab:   'library',
  // edit
  editId: null, editTags: [], newTags: [],
  // batch select
  selectMode: false,
  selected: new Set(),   // Set of video ids
  syncing: false,
};

/* ===== B站 API ===== */
const BILI = {
  PROXIES: [
    { name:'自訂', key:'custom',
      url(a){ const c=localStorage.getItem('bili_custom_proxy')||''; return c?c.replace('{url}',encodeURIComponent(a)):null; },
      parse:r=>r },
    { name:'corsproxy.io', key:'corsproxy',
      url:a=>`https://corsproxy.io/?url=${encodeURIComponent(a)}`,
      parse:r=>r },
    { name:'allorigins', key:'allorigins',
      url:a=>`https://api.allorigins.win/get?url=${encodeURIComponent(a)}`,
      parse:r=>JSON.parse(r.contents) },
    { name:'codetabs', key:'codetabs',
      url:a=>`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(a)}`,
      parse:r=>r },
    { name:'thingproxy', key:'thingproxy',
      url:a=>`https://thingproxy.freeboard.io/fetch/${encodeURIComponent(a)}`,
      parse:r=>r },
    { name:'jsonp.afeld.me', key:'jsonp',
      url:a=>`https://jsonp.afeld.me/?url=${encodeURIComponent(a)}`,
      parse:r=>r },
  ],
  _lastProxy: null,
  async fetch(apiUrl) {
    const ordered = this._lastProxy
      ? [this.PROXIES.find(p=>p.key===this._lastProxy),...this.PROXIES.filter(p=>p.key!==this._lastProxy)].filter(Boolean)
      : this.PROXIES;
    let lastErr;
    for (const proxy of ordered) {
      const pu = proxy.url(apiUrl); if (!pu) continue;
      try {
        const res = await fetch(pu, {signal:AbortSignal.timeout(12000)});
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();
        const data = proxy.parse(raw);
        const parsed = typeof data==='string' ? JSON.parse(data) : data;
        this._lastProxy = proxy.key;
        return parsed;
      } catch(e) { console.warn(`[BILI] ${proxy.name}:`, e.message); lastErr=e; }
    }
    throw new Error(`所有代理均失敗：${lastErr?.message}`);
  },
  async getFavFolders(uid) {
    const d = await this.fetch(`https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${uid}&jsonp=jsonp`);
    if (d.code!==0) throw new Error(d.message); return d.data?.list||[];
  },
  async *getFavVideos(mediaId, onProgress) {
    let pn=1;
    while(true) {
      const d = await this.fetch(`https://api.bilibili.com/x/v3/fav/resource/list?media_id=${mediaId}&pn=${pn}&ps=20&platform=web`);
      if (d.code!==0) throw new Error(d.message);
      const medias=d.data?.medias||[]; if (!medias.length) break;
      if (onProgress) onProgress(pn, d.data?.info?.media_count||0);
      for (const m of medias) { if (m.type===2) yield m; }
      if (!d.data?.has_more) break;
      pn++; await sleep(400);
    }
  },
  // Returns UP主設定的影片標籤
  async getVideoDetail(bvid) {
    let tags = [];
    try {
      const d = await this.fetch(`https://api.bilibili.com/x/web-interface/view/detail/tag?bvid=${bvid}`);
      if (d.code===0 && Array.isArray(d.data) && d.data.length>0) {
        tags = d.data.map(t=>t.tag_name).filter(Boolean);
      } else {
        const d2 = await this.fetch(`https://api.bilibili.com/x/tag/archive/tags?bvid=${bvid}`);
        if (d2.code===0 && Array.isArray(d2.data)) tags = d2.data.map(t=>t.tag_name).filter(Boolean);
      }
    } catch {}
    return { tags };
  },
  async getVideoTags(bvid) {
    const r = await this.getVideoDetail(bvid);
    return r.tags;
  },
};


/* ===== Helpers ===== */
const sleep = ms => new Promise(r=>setTimeout(r,ms));
function extractBvid(s){ const m=s.match(/BV[a-zA-Z0-9]{10}/); return m?m[0]:null; }
function thumbUrl(cover,bvid){ return (cover&&cover.startsWith('http'))?cover:`https://i0.hdslb.com/bfs/archive/${bvid}.jpg`; }
function fmtNum(n){ if(!n)return''; return n>=10000?(n/10000).toFixed(1)+'萬':String(n); }
function getMyTags(){ const s=new Set(); state.videos.forEach(v=>(v.tags||[]).forEach(t=>s.add(t))); return[...s].sort(); }
function getBiliTags(){ const s=new Set(); state.videos.forEach(v=>(v.biliTags||[]).forEach(t=>s.add(t))); return[...s].sort(); }

function getFiltered() {
  const q = state.searchQ.toLowerCase();
  const filtered = state.videos.filter(v => {
    let mf = true;
    if (state.activeFilter!=='all') {
      if (state.filterMode==='myTag')   mf=(v.tags||[]).includes(state.activeFilter);
      if (state.filterMode==='biliTag') mf=(v.biliTags||[]).includes(state.activeFilter);
    }
    const mq = !q||v.title.toLowerCase().includes(q)||(v.tags||[]).some(t=>t.toLowerCase().includes(q))
      ||(v.biliTags||[]).some(t=>t.toLowerCase().includes(q))
      ||(v.upper||'').toLowerCase().includes(q)||v.bvid.toLowerCase().includes(q);
    return mf && mq;
  });
  return getSorted(filtered);
}

function getSorted(list) {
  return [...list].sort((a,b)=>{
    switch(state.sortBy){
      case 'fav_asc':   return a.id-b.id;
      case 'title_asc': return a.title.localeCompare(b.title,'zh');
      case 'play_desc': return (b.play||0)-(a.play||0);
      default:          return b.id-a.id;
    }
  });
}

function setSort(s){ state.sortBy=s; localStorage.setItem('bili_sort',s); render(); }

/* ===== Render ===== */
function renderTagStrip() {
  const strip = document.getElementById('tag-strip');
  const myTags=getMyTags(), biliTags=getBiliTags();
  let r1=`<div class="strip-row"><span class="strip-section-label">我的標籤</span>`;
  r1+=chip('all','myTag',`全部 ${state.videos.length}`);
  myTags.forEach(t=>{ const c=state.videos.filter(v=>(v.tags||[]).includes(t)).length; r1+=chip(t,'myTag',`${t} ${c}`); });
  r1+=`</div>`;
  let r2='';
  if (biliTags.length) {
    r2=`<div class="strip-row strip-row-bili">`;
    if (biliTags.length) {
      r2+=`<span class="strip-section-label">UP主標籤</span>`;
      biliTags.forEach(t=>{ const c=state.videos.filter(v=>(v.biliTags||[]).includes(t)).length; r2+=chip(t,'biliTag',`${t} ${c}`,'blue'); });
    }
      r2+=`</div>`;
  }
  strip.innerHTML=r1+r2;
}

function chip(val,mode,label,color='') {
  const active=state.activeFilter===val&&state.filterMode===mode;
  return `<button class="tag-chip ${active?'active':''} ${color?'chip-'+color:''}" onclick="setFilter('${val}','${mode}')">${label}</button>`;
}
function setFilter(val,mode){ state.activeFilter=val; state.filterMode=mode; render(); }

function renderSortBar() {
  const bar=document.getElementById('sort-bar'); if(!bar)return;
  const opts=[['fav_desc','最新加入'],['fav_asc','最早加入'],['title_asc','標題排序'],['play_desc','播放最多']];
  bar.innerHTML=opts.map(([k,l])=>`<button class="sort-chip ${state.sortBy===k?'active':''}" onclick="setSort('${k}')">${l}</button>`).join('');
}

function renderGrid() {
  const grid=document.getElementById('video-grid');
  const empty=document.getElementById('empty-state');
  const list=getFiltered();
  document.getElementById('topbar-count').textContent=`${list.length} 部`;
  if (!list.length){ grid.innerHTML=''; empty.style.display='flex'; return; }
  empty.style.display='none';
  grid.innerHTML=list.map(v=>{
    const sel=state.selected.has(v.id);
    return `
    <div class="video-card ${state.selectMode?'selectable':''} ${sel?'selected':''}"
      data-id="${String(v.id)}"
      onclick="cardClick(event,${v.id})"
      oncontextmenu="cardLongPress(event,${v.id})">
      ${state.selectMode?`<div class="select-check ${sel?'checked':''}">${sel?'✓':''}</div>`:''}
      <div class="card-thumb">
        <img src="${thumbUrl(v.cover,v.bvid)}" loading="lazy" referrerpolicy="no-referrer"
          onload="this.classList.remove('loading')"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" class="loading"/>
        <div class="thumb-placeholder" style="display:none">
          <svg viewBox="0 0 24 24"><path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z"/></svg>
        </div>
        ${v.synced?'<span class="synced-dot"></span>':''}
      </div>
      <div class="card-body">
        <div class="card-title">${v.title}</div>
        <div class="card-meta-row">
          ${v.upper?`<span class="card-upper">${v.upper}</span>`:''}
          ${v.play?`<span class="card-stat">▶ ${fmtNum(v.play)}</span>`:''}
          ${v.favCount?`<span class="card-stat">★ ${fmtNum(v.favCount)}</span>`:''}
        </div>
        <div class="card-tags">
          ${(v.tags||[]).map(t=>`<span class="card-tag">${t}</span>`).join('')}
          ${(v.biliTags||[]).slice(0,2).map(t=>`<span class="card-tag bili-tag">${t}</span>`).join('')}
        </div>
      </div>
    </div>`;
  }).join('');
  // If in select mode, patch newly rendered cards immediately
  if (state.selectMode) {
    document.querySelectorAll('.video-card').forEach(card => {
      card.classList.add('selectable');
      const id = card.dataset.id;
      if (state.selected.has(id)) card.classList.add('selected');
      if (!card.querySelector('.select-check')) {
        const check = document.createElement('div');
        check.className = 'select-check' + (state.selected.has(id) ? ' checked' : '');
        check.textContent = state.selected.has(id) ? '✓' : '';
        const thumb = card.querySelector('.card-thumb') || card.firstElementChild;
        if (thumb) thumb.appendChild(check);
      }
    });
  }
  renderBatchBar();
}

function render() { renderTagStrip(); renderSortBar(); renderGrid(); }

/* ===== Select Mode ===== */
let _longPressTimer=null;

function cardClick(e,id) {
  e.preventDefault();
  if (_longPressFired) { _longPressFired = false; return; } // swallow click after long-press
  if (state.selectMode) { toggleSelect(id); return; }
  openDetail(id);
}

function cardLongPress(e,id) {
  e.preventDefault();
  if (!state.selectMode) enterSelectMode();
  toggleSelect(id);
}

// Touch: immediate select in selectMode, long-press to enter selectMode
let _longPressFired = false;
document.addEventListener('touchstart', e=>{
  const card=e.target.closest('.video-card');
  if (!card) return;
  const id=parseInt(card.dataset.id);
  if (!id) return;
  _longPressFired = false;

  if (state.selectMode) {
    // Already in select mode — toggle immediately on touchstart, no delay
    _longPressFired = true;   // suppress the later click event
    toggleSelect(id);
    return;
  }

  // Not in select mode — start long-press timer to enter it
  _longPressTimer=setTimeout(()=>{
    _longPressFired = true;
    enterSelectMode();
    toggleSelect(id);
  }, 480);
}, {passive:true});
document.addEventListener('touchend', ()=>{ clearTimeout(_longPressTimer); }, {passive:true});
document.addEventListener('touchmove', ()=>{ clearTimeout(_longPressTimer); }, {passive:true});

function enterSelectMode() {
  state.selectMode=true; state.selected.clear();
  document.getElementById('topbar-select-btn').textContent='取消';
  document.querySelectorAll('.video-card').forEach(card => {
    card.classList.add('selectable');
    if (!card.querySelector('.select-check')) {
      const check = document.createElement('div');
      check.className = 'select-check';
      // find thumb container — try .card-thumb first, then first child div
      const thumb = card.querySelector('.card-thumb') || card.firstElementChild;
      if (thumb) thumb.appendChild(check);
      else card.insertBefore(check, card.firstChild);
    }
  });
  renderBatchBar();
}

function exitSelectMode() {
  state.selectMode=false; state.selected.clear();
  document.getElementById('topbar-select-btn').textContent='選取';
  document.querySelectorAll('.video-card').forEach(card => {
    card.classList.remove('selectable','selected');
    card.querySelector('.select-check')?.remove();
  });
  renderBatchBar();
}

function toggleSelectMode() {
  if (state.selectMode) exitSelectMode(); else enterSelectMode();
}

function toggleSelect(id) {
  const sid = String(id);
  if (state.selected.has(sid)) state.selected.delete(sid); else state.selected.add(sid);
  const cards = document.querySelectorAll('.video-card');
  cards.forEach(card => {
    if (card.dataset.id !== String(id)) return;
    const sel = state.selected.has(sid);
    card.classList.toggle('selected', sel);
    const check = card.querySelector('.select-check');
    if (check) { check.classList.toggle('checked', sel); check.textContent = sel ? '✓' : ''; }
  });
  renderBatchBar();
}

function selectAll() {
  const list=getFiltered();
  if (state.selected.size===list.length) { state.selected.clear(); }
  else { list.forEach(v=>state.selected.add(String(v.id))); }
  // Update all card DOM states
  document.querySelectorAll('.video-card').forEach(card => {
    const cardId = card.dataset.id;
    if (!cardId) return;
    const sel = state.selected.has(cardId);
    card.classList.toggle('selected', sel);
    const check = card.querySelector('.select-check');
    if (check) { check.classList.toggle('checked', sel); check.textContent = sel ? '✓' : ''; }
  });
  renderBatchBar();
}

function renderBatchBar() {
  const bar=document.getElementById('batch-bar');
  if (!bar) return;
  if (!state.selectMode) { bar.style.display='none'; return; }
  const n=state.selected.size;
  bar.style.display='flex';
  document.getElementById('batch-count').textContent=n ? `已選 ${n} 部` : '點選影片';
}

/* ===== Batch Actions ===== */
function openBatchTagSheet() {
  if (!state.selected.size) return;
  // Pre-fill with tags common to ALL selected videos
  const ids=[...state.selected];
  const allTags=ids.map(id=>(state.videos.find(v=>String(v.id)===String(id))?.tags||[]));
  const common=allTags.reduce((a,b)=>a.filter(t=>b.includes(t)));
  state.editTags=[...common];
  renderEditPills();
  document.getElementById('edit-tag-input').value='';
  // Populate existing-tag suggestions
  renderTagSuggestions();
  document.getElementById('batch-mode-label').textContent=`批次編輯（${state.selected.size} 部影片）`;
  document.getElementById('sheet-edit').classList.add('open');
  document.getElementById('batch-tag-actions').style.display='flex';
  document.getElementById('single-tag-actions').style.display='none';
}

function openSingleTagSheet(id) {
  const v=state.videos.find(x=>x.id===id); if(!v)return;
  state.editId=id; state.editTags=[...(v.tags||[])];
  renderEditPills();
  document.getElementById('edit-tag-input').value='';
  renderTagSuggestions();
  document.getElementById('batch-mode-label').textContent='編輯標籤';
  document.getElementById('sheet-edit').classList.add('open');
  document.getElementById('batch-tag-actions').style.display='none';
  document.getElementById('single-tag-actions').style.display='flex';
}

// Render clickable existing-tag suggestions in the edit sheet
function renderTagSuggestions() {
  const all=getMyTags();
  const el=document.getElementById('tag-suggestions');
  if (!el) return;
  el.innerHTML=all.map(t=>{
    const active=state.editTags.includes(t);
    return `<button class="sugg-chip ${active?'active':''}" onclick="toggleSuggTag('${t.replace(/'/g,"\\'")}')">
      ${active?'✓ ':'+'}${t}</button>`;
  }).join('');
}

function toggleSuggTag(t) {
  if (state.editTags.includes(t)) state.editTags=state.editTags.filter(x=>x!==t);
  else state.editTags.push(t);
  renderEditPills(); renderTagSuggestions();
}

// Batch save: REPLACE tags for all selected videos
function saveBatchTags() {
  const extra=document.getElementById('edit-tag-input').value.trim();
  if (extra&&!state.editTags.includes(extra)) state.editTags.push(extra);
  const ids=[...state.selected];
  ids.forEach(id=>{ const v=state.videos.find(x=>String(x.id)===String(id)); if(v) v.tags=[...state.editTags]; });
  DB.save(state.videos); closeSheet('sheet-edit'); exitSelectMode(); render();
}

// Batch ADD: add current editTags to selected (keep existing)
function addBatchTags() {
  const extra=document.getElementById('edit-tag-input').value.trim();
  if (extra&&!state.editTags.includes(extra)) state.editTags.push(extra);
  const ids=[...state.selected];
  ids.forEach(id=>{
    const v=state.videos.find(x=>String(x.id)===String(id)); if(!v)return;
    state.editTags.forEach(t=>{ if(!(v.tags||[]).includes(t)){ v.tags=v.tags||[]; v.tags.push(t); } });
  });
  DB.save(state.videos); closeSheet('sheet-edit'); exitSelectMode(); render();
}

/* ===== AI Tag Suggestion ===== */
function aiSuggestTags() {
  const ids = state.selected.size > 0 ? [...state.selected] : (state.editId ? [state.editId] : []);
  const vids = ids.map(id => state.videos.find(v => String(v.id) === String(id))).filter(Boolean);
  if (!vids.length) { alert('請先選擇影片'); return; }

  const summary = vids.slice(0, 30).map(v =>
    `・${v.title}（UP主標籤：${(v.biliTags||[]).slice(0,5).join('、') || '無'}）`
  ).join('\n');
  const existingTags = getMyTags();

  const prompt = `以下是我在B站收藏的${vids.length}部影片：
${summary}

我現有的自訂標籤有：${existingTags.join('、') || '（目前沒有）'}

請建議 3-6 個適合這批影片的繁體中文自訂標籤（短而精確，例如「英語學習」「遊戲攻略」「動漫」）。
如果現有標籤中有合適的，優先使用。
只輸出 JSON 陣列，例如：["標籤1","標籤2","標籤3"]，不要其他任何文字。`;

  navigator.clipboard.writeText(prompt).then(() => {
    document.getElementById('ai-copy-status').style.display = 'block';
  }).catch(() => {
    // clipboard failed — show prompt in a new window
    const w = window.open('', '_blank', 'width=600,height=400');
    w.document.write('<pre style="white-space:pre-wrap;font-family:sans-serif;padding:16px">' + prompt.replace(/</g,'&lt;') + '</pre>');
    document.getElementById('ai-copy-status').style.display = 'block';
  });
}

function applyAiResult() {
  const input = document.getElementById('ai-result-input');
  if (!input) return;
  const raw = input.value.trim();
  if (!raw) return;
  try {
    const i = raw.indexOf('['), j = raw.lastIndexOf(']');
    const tags = JSON.parse(i >= 0 && j > i ? raw.slice(i, j+1) : '[]');
    if (!tags.length) throw new Error('沒有標籤');
    tags.forEach(t => { if (t && !state.editTags.includes(t)) state.editTags.push(t); });
    renderEditPills();
    renderTagSuggestions();
    input.value = '';
    document.getElementById('ai-copy-status').style.display = 'none';
  } catch(e) {
    alert('格式錯誤，請貼上 JSON 陣列，例如：["英語學習","遊戲"]');
  }
}

function openAiWorkerSetup() {
  document.getElementById('sheet-ai-worker').classList.add('open');
}
function saveAiWorkerUrl() {
  const url = document.getElementById('ai-worker-url-input').value.trim();
  if (!url) return;
  localStorage.setItem('ai_worker_url', url);
  closeSheet('sheet-ai-worker');
  document.getElementById('ai-suggest-btn').textContent = '✨ AI 建議標籤（重試）';
}

/* ===== Tab ===== */
function setTab(tab) {
  state.currentTab=tab;
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.tab===tab));
  document.getElementById('sheet-import').classList.toggle('open',tab==='import');
  document.getElementById('sheet-add').classList.toggle('open',tab==='add');
}

/* ===== Detail Sheet ===== */
function openDetail(id) {
  const v=state.videos.find(x=>x.id===id); if(!v)return;
  const dc=document.getElementById('detail-cover'); dc.referrerPolicy='no-referrer'; dc.src=thumbUrl(v.cover,v.bvid);
  document.getElementById('detail-title').textContent=v.title;
  document.getElementById('detail-bvid').textContent=v.bvid;
  document.getElementById('detail-meta').innerHTML=[
    v.upper?`<span>UP主：${v.upper}</span>`:'',
    v.play?`<span>▶ ${fmtNum(v.play)}</span>`:'',
    v.favCount?`<span>★ ${fmtNum(v.favCount)}</span>`:'',
  ].filter(Boolean).join('');
  document.getElementById('detail-tags').innerHTML=
    (v.tags||[]).map(t=>`<span class="card-tag">${t}</span>`).join('')+
    (v.biliTags||[]).map(t=>`<span class="card-tag bili-tag">${t}</span>`).join('');
  document.getElementById('detail-open-btn').onclick=()=>window.open(`https://www.bilibili.com/video/${v.bvid}`,'_blank');
  document.getElementById('detail-edit-btn').onclick=()=>{ closeSheet('sheet-detail'); openSingleTagSheet(id); };
  document.getElementById('detail-delete-btn').onclick=()=>{
    if(confirm(`刪除「${v.title}」？`)){ state.videos=state.videos.filter(x=>x.id!==id); DB.save(state.videos); closeSheet('sheet-detail'); render(); }
  };
  document.getElementById('sheet-detail').classList.add('open');
}

/* ===== Edit Tags Sheet ===== */
function renderEditPills() {
  document.getElementById('edit-tag-pills').innerHTML=
    state.editTags.map((t,i)=>`<span class="tag-pill">${t}<button class="tag-pill-remove" onclick="removeEditTag(${i})">×</button></span>`).join('');
}
function removeEditTag(i){ state.editTags.splice(i,1); renderEditPills(); renderTagSuggestions(); }
function saveEditTags() {
  const extra=document.getElementById('edit-tag-input').value.trim();
  if(extra&&!state.editTags.includes(extra)) state.editTags.push(extra);
  const v=state.videos.find(x=>x.id===state.editId); if(v) v.tags=[...state.editTags];
  DB.save(state.videos); closeSheet('sheet-edit'); render();
}

/* ===== Manual Add ===== */
function renderNewPills() {
  document.getElementById('new-tag-pills').innerHTML=
    state.newTags.map((t,i)=>`<span class="tag-pill">${t}<button class="tag-pill-remove" onclick="removeNewTag(${i})">×</button></span>`).join('');
}
function removeNewTag(i){ state.newTags.splice(i,1); renderNewPills(); }
function addManual() {
  const urlVal=document.getElementById('add-url').value.trim();
  const titleVal=document.getElementById('add-title').value.trim();
  if(!urlVal||!titleVal){ alert('請填寫連結和標題'); return; }
  const extra=document.getElementById('new-tag-input-sm').value.trim();
  if(extra&&!state.newTags.includes(extra)) state.newTags.push(extra);
  const bvid=extractBvid(urlVal)||('BV'+Date.now().toString(36));
  const url=urlVal.startsWith('http')?urlVal:`https://www.bilibili.com/video/${bvid}`;
  state.videos.unshift({id:Date.now(),bvid,title:titleVal,url,tags:[...state.newTags],biliTags:[],synced:false,cover:''});
  DB.save(state.videos); state.newTags=[];
  document.getElementById('add-url').value=''; document.getElementById('add-title').value='';
  renderNewPills(); closeSheet('sheet-add'); setTab('library'); render();
}

/* ===== Import ===== */
async function lookupFolders() {
  const uid=document.getElementById('import-uid').value.trim(); if(!uid)return;
  const el=document.getElementById('folders-result');
  el.innerHTML='<span style="font-size:13px;color:var(--text2)">查詢中...</span>';
  try {
    const list=await BILI.getFavFolders(uid);
    if(!list.length){ el.innerHTML='<span style="font-size:13px;color:var(--text2)">沒有公開收藏夾</span>'; return; }
    el.innerHTML=list.map(f=>`<div class="fav-list-item">
      <div class="fav-list-title">${f.title}</div>
      <span class="fav-list-count">${f.media_count} 部</span>
      <button class="btn-ghost" onclick="selectFolder('${f.id}','${f.title.replace(/'/g,"\\'")}')">選用</button>
    </div>`).join('');
  } catch(e){ el.innerHTML=`<span style="font-size:13px;color:#e24b4a">錯誤：${e.message}</span>`; }
}
function selectFolder(id,title){ document.getElementById('import-media-id').value=id; document.getElementById('selected-folder-name').textContent=`已選：${title}`; }
function setImportStatus(msg,type){ const el=document.getElementById('import-status'); el.textContent=msg; el.className=`status-box ${type}`; el.style.display='block'; }

async function startImport() {
  if(state.syncing)return;
  const mediaId=document.getElementById('import-media-id').value.trim();
  if(!mediaId){ setImportStatus('請先選擇收藏夾','error'); return; }
  const fetchTags=document.getElementById('import-fetch-tags').checked;
  state.syncing=true;
  const btn=document.getElementById('import-btn'); btn.disabled=true; btn.innerHTML='<span class="spinner"></span> 匯入中...';
  setImportStatus('準備中...','info');
  const existBvids=new Set(state.videos.map(v=>v.bvid));
  const newVideos=[]; let newCount=0;
  try {
    const gen=BILI.getFavVideos(mediaId,(pn,total)=>{
      setImportStatus(`第一階段：讀取第 ${pn} 頁（${newCount} 部新影片，共約 ${total} 部）...`,'info');
    });
    for await (const m of gen) {
      if(!existBvids.has(m.bvid)) {
        existBvids.add(m.bvid);
        const vid={
          id:Date.now()*1000+Math.floor(Math.random()*999), bvid:m.bvid, title:m.title,
          url:`https://www.bilibili.com/video/${m.bvid}`,
          tags: [], biliTags:[], synced:true, cover:m.cover||'',
          upper:m.upper?.name||'', play:m.cnt_info?.play||0, favCount:m.cnt_info?.collect||0,
        };
        state.videos.unshift(vid); newVideos.push(vid); newCount++;
      }
    }
    DB.save(state.videos); render();
    if(fetchTags&&newVideos.length>0) {
      let done=0;
      for(const vid of newVideos) {
        const detail = await BILI.getVideoDetail(vid.bvid);
        vid.biliTags = detail.tags;
        done++;
        if(done%5===0){ DB.save(state.videos); if(!state.selectMode) render(); else { renderTagStrip(); renderSortBar(); } }
        setImportStatus(`第二階段：抓取標籤與分區（${done} / ${newVideos.length}）...`,'info');
        await sleep(600);
      }
      DB.save(state.videos); render();
    }
    setImportStatus(`✓ 匯入完成！新增 ${newCount} 部影片`,'success');
    if(newCount>0) setTimeout(()=>{ closeSheet('sheet-import'); setTab('library'); },1500);
  } catch(e){ setImportStatus(`匯入失敗：${e.message}`,'error'); }
  finally { state.syncing=false; btn.disabled=false; btn.innerHTML='開始匯入'; }
}


/* ===== Backfill ===== */
let _backfillAbort=false;
async function startBackfill() {
  if(state.syncing)return;
  // Only fetch videos that haven't been attempted yet (no biliTagsFetched flag)
  // This way pausing and resuming continues from where it left off
  const todo=state.videos.filter(v=>!v.biliTagsFetched);
  const statusEl=document.getElementById('import-status');
  statusEl.style.display='block';
  if(!todo.length){
    const withTags=state.videos.filter(v=>v.biliTags&&v.biliTags.length).length;
    setImportStatus(`✓ 全部抓取完畢！${withTags} 部有 UP主標籤，${state.videos.length-withTags} 部無標籤（影片本身未設定）`,'success');
    return;
  }
  _backfillAbort=false; state.syncing=true;
  const btn=document.getElementById('backfill-btn');
  btn.textContent='⏸ 暫停'; btn.onclick=()=>{ _backfillAbort=true; btn.textContent='▶ 繼續'; btn.onclick=startBackfill; };
  setImportStatus(`補抓 UP主標籤：0 / ${todo.length} 部待抓（共 ${state.videos.length} 部）...`,'info');
  let done=0;
  try {
    for(const vid of todo) {
      if(_backfillAbort)break;
      const detail = await BILI.getVideoDetail(vid.bvid);
      vid.biliTags = detail.tags;
      vid.biliTagsFetched = true;  // mark as attempted regardless of result
      done++;
      if(done%10===0){ DB.save(state.videos); if(!state.selectMode) render(); else { renderTagStrip(); renderSortBar(); } }
      const remaining=todo.length-done;
      setImportStatus(`補抓 UP主標籤：${done} / ${todo.length}（剩餘 ${remaining} 部）...`,'info');
      await sleep(600);
    }
    DB.save(state.videos);
    if(!state.selectMode) render(); else { renderTagStrip(); renderSortBar(); }
    const stillTodo=state.videos.filter(v=>!v.biliTagsFetched).length;
    const withTags=state.videos.filter(v=>v.biliTags&&v.biliTags.length).length;
    setImportStatus(
      _backfillAbort
        ? `已暫停。本次完成 ${done} 部，還剩 ${stillTodo} 部未抓，點「補抓」可繼續。`
        : `✓ 補抓完成！${withTags} 部有 UP主標籤，${state.videos.length-withTags} 部無標籤（影片本身未設定）`,
      _backfillAbort?'info':'success'
    );
  } catch(e){
    setImportStatus(`補抓失敗：${e.message}`,'error');
    DB.save(state.videos); // save progress so far
  } finally {
    state.syncing=false;
    const stillLeft=state.videos.filter(v=>!v.biliTagsFetched).length;
    const btn2=document.getElementById('backfill-btn');
    btn2.textContent = stillLeft>0 ? `補抓 UP主標籤（剩 ${stillLeft} 部）` : '補抓 UP主標籤';
    btn2.onclick = startBackfill;
  }
}

/* ===== Sheet Utils ===== */
function closeSheet(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
  if(id==='sheet-add'||id==='sheet-import') setTab('library');
  if(id==='sheet-edit'){ document.getElementById('batch-tag-actions').style.display='none'; document.getElementById('single-tag-actions').style.display='flex'; }
}

/* ===== Proxy ===== */
function saveCustomProxy() {
  const val=document.getElementById('custom-proxy-input').value.trim();
  localStorage.setItem('bili_custom_proxy',val); BILI._lastProxy=val?'custom':null;
  const st=document.getElementById('proxy-save-status'); st.textContent=val?'✓ 已儲存':'已清除';
  setTimeout(()=>{ st.textContent=''; },2500);
}
function copyWorkerCode(e) {
  const code=`export default {\n  async fetch(request) {\n    const url = new URL(request.url);\n    const target = url.searchParams.get('url');\n    if (!target) return new Response('Missing url', { status: 400 });\n    const res = await fetch(decodeURIComponent(target), {\n      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.bilibili.com' }\n    });\n    return new Response(await res.text(), {\n      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }\n    });\n  }\n};`;
  navigator.clipboard.writeText(code).then(()=>{ const btn=e.target; btn.textContent='✓ 已複製！'; setTimeout(()=>{ btn.textContent='複製程式碼'; },2000); });
}

/* ===== Init ===== */
document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('search-input').addEventListener('input',e=>{ state.searchQ=e.target.value; render(); });
  ['edit-tag-input','new-tag-input-sm'].forEach(id=>{
    const el=document.getElementById(id); if(!el)return;
    el.addEventListener('keydown',e=>{
      if(e.key!=='Enter'&&e.key!==',')return; e.preventDefault();
      const val=e.target.value.trim().replace(/,/g,'');
      if(id==='edit-tag-input'){ if(val&&!state.editTags.includes(val)){ state.editTags.push(val); renderEditPills(); renderTagSuggestions(); } }
      else { if(val&&!state.newTags.includes(val)){ state.newTags.push(val); renderNewPills(); } }
      e.target.value='';
    });
  });
  const saved=localStorage.getItem('bili_custom_proxy')||'';
  const pel=document.getElementById('custom-proxy-input'); if(pel&&saved)pel.value=saved;
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  render();
});
