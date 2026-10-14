/* Duy pixel Aniimo Map — frontend. Configure Supabase in the Settings section below. */
const SUPABASE_URL = 'https://kbferdrgeyfqzdgyyzja.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_fqkpz1r09z_BhnrXiv3Eug_90izdM0u';
const STORAGE_BUCKET = 'aniimo-maps';
const configured = SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('PASTE_') && SUPABASE_ANON_KEY.length > 30 && !SUPABASE_ANON_KEY.includes('PASTE_');
const $ = (id) => document.getElementById(id);
const ICONS = {egg:'🥚',chest:'🎁',boss:'👹',key:'🔑',door:'🚪',other:'📍'};
let db = null, session = null, maps = [], points = [], siteTexts = [], editingSiteTextId = null, currentMapId = null, activeTab = 'mapsTab', placingPoint = false, zoom = 1, toastTimer;
const visibleTypes = {egg:true,chest:true,boss:true,key:true,door:true,other:true};
// Tiến trình cá nhân được lưu trên trình duyệt, tách biệt hoàn toàn với dữ liệu điểm trong Supabase.
const PROGRESS_KEY = 'duyPixelAniimoCompleted_v1';
const DEFAULT_ICONS = {...ICONS};
function normalizedIconConfig(value){if(!value)return {};if(typeof value==='string'){try{value=JSON.parse(value);}catch{return {};}}return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}
function getSharedIconConfig(){
 const shared={};
 for(const type of Object.keys(ICONS)){
  const candidates=maps.map(m=>({url:normalizedIconConfig(m.icon_config)[type],updatedAt:Date.parse(m.updated_at||m.modified_at||m.created_at||'')||0}))
   .filter(x=>typeof x.url==='string'&&/^https?:\/\//i.test(x.url.trim()));
  const counts=new Map();candidates.forEach(x=>{const key=x.url.trim(),entry=counts.get(key)||{url:key,count:0,updatedAt:0};entry.count++;entry.updatedAt=Math.max(entry.updatedAt,x.updatedAt);counts.set(key,entry);});
  const best=[...counts.values()].sort((a,b)=>b.count-a.count||b.updatedAt-a.updatedAt)[0];
  if(best)shared[type]=best.url;
 }
 return shared;
}
function mapIcon(type){const local=normalizedIconConfig(byId(currentMapId)?.icon_config),shared=getSharedIconConfig(),value=shared[type]||local[type];return typeof value==='string'&&value.trim()?value.trim():(DEFAULT_ICONS[type]||'📍');}
async function syncIconsAcrossMaps(){
 if(!isAdmin()||!db||!maps.length)return;
 const shared=getSharedIconConfig();if(!Object.keys(shared).length)return;
 for(const map of maps){
  const current=normalizedIconConfig(map.icon_config),next={...current,...shared};
  if(Object.keys(shared).every(type=>current[type]===shared[type]))continue;
  const {data,error}=await db.from('maps').update({icon_config:next}).eq('id',map.id).select().single();
  if(error)throw new Error('Không đồng bộ được icon cho bản đồ "'+(map.name||map.id)+'": '+error.message);
  Object.assign(map,data);
 }
}
function clearProgress(mapId){if(!mapId)return;const saved=readProgress();if(saved[mapId]){delete saved[mapId];localStorage.setItem(PROGRESS_KEY,JSON.stringify(saved));}}
function renderIconPreviews(){const m=byId($('assetMap')?.value),local=normalizedIconConfig(m?.icon_config),shared=getSharedIconConfig();document.querySelectorAll('[id^="iconPreview_"]').forEach(el=>{const type=el.id.replace('iconPreview_',''),val=shared[type]||local[type];el.innerHTML=val&&/^https?:\/\//i.test(val)?'<img src="'+esc(val)+'" alt="">':esc(DEFAULT_ICONS[type]||'📍');});}
async function uploadAsset(file,path){const up=await db.storage.from(STORAGE_BUCKET).upload(path,file,{cacheControl:'3600',upsert:true,contentType:file.type});if(up.error)throw up.error;return db.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;}

function readProgress(){try{return JSON.parse(localStorage.getItem(PROGRESS_KEY)||'{}')}catch{return {}}}
function isCompleted(pointId){const saved=readProgress();return !!(saved[currentMapId]&&saved[currentMapId][pointId]);}
function toggleCompleted(pointId){const saved=readProgress();saved[currentMapId]=saved[currentMapId]||{};if(saved[currentMapId][pointId])delete saved[currentMapId][pointId];else saved[currentMapId][pointId]=true;localStorage.setItem(PROGRESS_KEY,JSON.stringify(saved));renderMarkers();toast(saved[currentMapId][pointId]?'Đã đánh dấu hoàn thành ✓':'Đã bỏ đánh dấu hoàn thành');}
function msg(id,text,type=''){const el=$(id);el.textContent=text;el.className='message '+type;}
function toast(text){const el=$('toast');el.textContent=text;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2600);}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function isAdmin(){return !!session;}
function byId(id){return maps.find(m=>m.id===id);}
function setConnection(text,online=false){$('connection').textContent=text;$('connection').classList.toggle('online',online);}
async function init(){
  $('mapCanvas').insertAdjacentHTML('beforeend','<div id="markerLayer" class="marker-layer"></div>');
  document.querySelectorAll('.difficulty-pills').forEach(group=>group.querySelectorAll('[data-difficulty]').forEach(btn=>btn.addEventListener('click',()=>{const target=group.dataset.difficultyTarget;const select=$(target);if(!select)return;const value=select.value===btn.dataset.difficulty?'all':btn.dataset.difficulty;select.value=value;syncDifficultyPills(target);if(target==='galleryDifficulty')renderGallery();else renderMapList();})));syncDifficultyPills('galleryDifficulty');syncDifficultyPills('difficulty');
  $('backToGallery').addEventListener('click',showGallery);$('gallerySearch').addEventListener('input',renderGallery);$('galleryDifficulty').addEventListener('change',()=>{syncDifficultyPills('galleryDifficulty');renderGallery();});
  $('adminOpen').addEventListener('click',openAdmin);$('adminClose').addEventListener('click',closeAdmin);$('adminModal').addEventListener('click',e=>{if(e.target===$('adminModal'))closeAdmin();});
  $('loginButton').addEventListener('click',login);
  $('assetMap').addEventListener('change',()=>{renderIconPreviews();renderQuickSlotAdmin();});$('saveMapCustomization').addEventListener('click',saveMapCustomization);
  $('saveSiteText')?.addEventListener('click',saveSiteText);
  $('replaceMapImage').addEventListener('click',replaceMapImage);$('replaceMapThumbnail').addEventListener('click',replaceMapThumbnail);
  document.querySelectorAll('[data-upload-icon]').forEach(b=>b.addEventListener('click',()=>uploadMapIcon(b.dataset.uploadIcon)));
  document.querySelectorAll('[data-reset-icon]').forEach(b=>b.addEventListener('click',()=>resetMapIcon(b.dataset.resetIcon)));$('logoutButton').addEventListener('click',logout);$('saveMap').addEventListener('click',saveMap);$('placePoint').addEventListener('click',startPlacePoint);
  $('searchMap').addEventListener('input',renderMapList);$('difficulty').addEventListener('change',()=>{syncDifficultyPills('difficulty');renderMapList();});
  document.querySelectorAll('[data-filter]').forEach(el=>el.addEventListener('change',()=>{visibleTypes[el.dataset.filter]=el.checked;renderMarkers();}));
  $('zoomIn').addEventListener('click',()=>setZoom(zoom+.15));$('zoomOut').addEventListener('click',()=>setZoom(zoom-.15));$('zoomReset').addEventListener('click',()=>setZoom(1));
  // Zoom theo vị trí con trỏ: giữ nguyên điểm bản đồ đang nằm dưới chuột.
  $('mapViewport').addEventListener('wheel',e=>{
    if($('mapImage').hidden) return;
    e.preventDefault();
    const viewport=$('mapViewport');
    const rect=viewport.getBoundingClientRect();
    const px=e.clientX-rect.left, py=e.clientY-rect.top;
    const previousZoom=zoom;
    const factor=e.deltaY<0?1.12:1/1.12;
    const nextZoom=Math.max(.5,Math.min(2.5,zoom*factor));
    if(nextZoom===previousZoom)return;
    viewport.scrollLeft=(viewport.scrollLeft+px)*nextZoom/previousZoom-px;
    viewport.scrollTop=(viewport.scrollTop+py)*nextZoom/previousZoom-py;
    setZoom(nextZoom);
    viewport.scrollLeft=(viewport.scrollLeft+px)*nextZoom/previousZoom-px;
    viewport.scrollTop=(viewport.scrollTop+py)*nextZoom/previousZoom-py;
  },{passive:false});
  $('mapImage').addEventListener('click',handleMapClick);
  // Kéo nền bản đồ bằng chuột trái hoặc chạm; marker/admin placement giữ nguyên hành vi riêng.
  let pan=null;const vp=$('mapViewport');vp.addEventListener('pointerdown',e=>{if(e.target.closest('.marker')||placingPoint||e.button!==0||$('mapImage').hidden)return;pan={x:e.clientX,y:e.clientY,left:vp.scrollLeft,top:vp.scrollTop,moved:false};vp.classList.add('panning');vp.setPointerCapture(e.pointerId);});vp.addEventListener('pointermove',e=>{if(!pan)return;const dx=e.clientX-pan.x,dy=e.clientY-pan.y;if(Math.abs(dx)+Math.abs(dy)>3)pan.moved=true;vp.scrollLeft=pan.left-dx;vp.scrollTop=pan.top-dy;});const endPan=()=>{if(pan){pan=null;vp.classList.remove('panning');}};vp.addEventListener('pointerup',endPan);vp.addEventListener('pointercancel',endPan);$('pointMap').addEventListener('change',async e=>{if(e.target.value)await selectMap(e.target.value);});
  document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
  if(!configured){setConnection('Chưa cấu hình dữ liệu');renderMapList();renderGallery();$('mapList').innerHTML='<div class="empty">Website đã sẵn sàng về giao diện. Hãy làm theo README để kết nối cơ sở dữ liệu Supabase, sau đó các bản đồ trực tuyến sẽ hiện ở đây.</div>';return;}
  try{db=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);const {data:{session:s}}=await db.auth.getSession();session=s;updateAuthUI();await loadMaps();db.auth.onAuthStateChange((_event,s)=>{session=s;updateAuthUI();});db.channel('map-live-sync').on('postgres_changes',{event:'*',schema:'public',table:'maps'},()=>loadMaps()).on('postgres_changes',{event:'*',schema:'public',table:'map_points'},()=>currentMapId&&loadPoints(currentMapId)).subscribe();setConnection('Đã kết nối dữ liệu',true);}catch(e){setConnection('Lỗi kết nối');console.error(e);}
}
function openAdmin(){ $('adminModal').classList.add('open');$('adminModal').setAttribute('aria-hidden','false');if(!configured){$('authPanel').hidden=false;$('editorPanel').hidden=true;msg('authMessage','Bạn cần cấu hình Supabase theo hướng dẫn trong README trước khi đăng nhập.','error');} }
function closeAdmin(){$('adminModal').classList.remove('open');$('adminModal').setAttribute('aria-hidden','true');placingPoint=false;$('mapImage').classList.remove('placing');}
async function login(){if(!db)return msg('authMessage','Chưa cấu hình Supabase. Xem README.','error');const email=$('email').value.trim(),password=$('password').value;if(!email||!password)return msg('authMessage','Nhập email và mật khẩu.','error');$('loginButton').disabled=true;msg('authMessage','Đang đăng nhập…');const {data,error}=await db.auth.signInWithPassword({email,password});$('loginButton').disabled=false;if(error)return msg('authMessage',error.message,'error');session=data.session;updateAuthUI();await loadMaps();msg('authMessage','Đăng nhập thành công.','success');}
async function logout(){if(db)await db.auth.signOut();session=null;updateAuthUI();toast('Đã đăng xuất quản trị.');}
function updateAuthUI(){$('authPanel').hidden=!!session;$('editorPanel').hidden=!session;if(session){$('signedInAs').textContent=session.user.email||'Quản trị viên';refreshAdminLists();}}
function showMapLoadError(error){
 const detail=error?.message||'Không thể kết nối cơ sở dữ liệu.';
 console.error('Không tải được danh sách bản đồ:',error);
 setConnection('Lỗi tải dữ liệu');
 const message='Không tải được dữ liệu bản đồ. Dữ liệu chưa bị xóa bởi thao tác cập nhật giao diện. Hãy kiểm tra kết nối Supabase. Chi tiết: '+detail;
 ['mapGallery','quickMapGrid','mapList'].forEach(id=>{const el=$(id);if(el)el.innerHTML='<div class="empty">'+esc(message)+'</div>';});
 clearMap();
}
function sortMapsClientSide(rows){return (rows||[]).slice().sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0)||String(b.created_at||'').localeCompare(String(a.created_at||'')));}
async function loadMaps(){
 if(!db)return;
 let result=await db.from('maps').select('*').eq('published',true).order('sort_order',{ascending:true}).order('created_at',{ascending:false});
 // If optional ordering columns are missing, retry the plain select instead of leaving "Đang tải bản đồ…" forever.
 if(result.error){console.warn('Tải bản đồ với thứ tự mặc định thất bại; đang thử truy vấn dự phòng:',result.error.message);result=await db.from('maps').select('*').eq('published',true);}
 if(result.error){showMapLoadError(result.error);return;}
 const publicMaps=sortMapsClientSide(result.data);
 if(session){
  let allResult=await db.from('maps').select('*').order('sort_order',{ascending:true}).order('created_at',{ascending:false});
  if(allResult.error)allResult=await db.from('maps').select('*');
  maps=allResult.error?publicMaps:sortMapsClientSide(allResult.data);
 }else maps=publicMaps;
 await loadSiteTexts();
 if(!currentMapId||!maps.some(m=>m.id===currentMapId))currentMapId=maps[0]?.id||null;
 if(session){try{await syncIconsAcrossMaps();}catch(e){console.error(e);toast('Icon chưa đồng bộ hết: '+e.message);}}
 renderMapList();renderGallery();refreshAdminLists();showGallery();
 if(currentMapId)await selectMap(currentMapId);else clearMap();
}
function syncDifficultyPills(target){const select=$(target);if(!select)return;document.querySelectorAll(`.difficulty-pills[data-difficulty-target="${target}"] [data-difficulty]`).forEach(btn=>{const active=select.value===btn.dataset.difficulty;btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',String(active));});}
function renderMapList(){const q=$('searchMap').value.toLowerCase(),d=$('difficulty').value;const filtered=maps.filter(m=>(m.name||'').toLowerCase().includes(q)&&(d==='all'||m.difficulty===d));$('mapCount').textContent=filtered.length;if(!filtered.length){$('mapList').innerHTML='<div class="empty">Chưa có bản đồ phù hợp. Quản trị viên có thể thêm bản đồ mới.</div>';return;}$('mapList').innerHTML=filtered.map(m=>`<button class="map-row ${m.id===currentMapId?'active':''}" data-map-id="${m.id}"><span class="map-thumb">${(m.thumbnail_url||m.image_url)?`<img src="${esc(m.thumbnail_url||m.image_url)}" alt="">`:'⌖'}</span><span class="map-card-copy"><strong>${esc(m.name)}</strong><small>${esc(m.area||'Lost Sanctum')} · ${esc(m.difficulty||'')}</small><small class="map-card-action">Mở bản đồ →</small></span></button>`).join('');document.querySelectorAll('[data-map-id]').forEach(b=>b.addEventListener('click',()=>selectMap(b.dataset.mapId)));}
function showGallery(){ $('mapGalleryPage').hidden=false;$('mapDetailPage').hidden=true;renderGallery();renderCustomSiteTexts(); }
function siteTextFor(area,fallback=''){const rows=siteTexts.filter(t=>t.area===area&&t.enabled!==false).sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0));return rows.length?rows[0].text:fallback;}
function renderCustomSiteTexts(){document.querySelectorAll('[data-site-text-area]').forEach(host=>{const area=host.dataset.siteTextArea;const rows=siteTexts.filter(t=>t.area===area&&t.enabled!==false).sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0));host.innerHTML=rows.map(t=>`<div class="custom-site-text">${esc(t.text).replace(/\n/g,'<br>')}</div>`).join('');});}
async function loadSiteTexts(){if(!db)return;const {data,error}=await db.from('site_texts').select('*').order('sort_order',{ascending:true}).order('created_at',{ascending:true});if(error){console.warn('Site text settings are not installed yet:',error.message);siteTexts=[];return;}siteTexts=data||[];renderCustomSiteTexts();renderSiteTextList();}
function areaLabel(area){return ({rare_badge:'Nhãn HIẾM HƠN',default_badge:'Nhãn MẶC ĐỊNH',gallery_top:'Phía trên danh sách bản đồ',gallery_bottom:'Phía dưới danh sách bản đồ',sidebar_bottom:'Cuối hướng dẫn bên trái',gallery_card:'Trên từng thẻ bản đồ',map_detail:'Trang chi tiết bản đồ',footer:'Cuối trang website'})[area]||area;}
function renderSiteTextList(){const host=$('siteTextList');if(!host)return;host.innerHTML=siteTexts.map(t=>`<div class="admin-map-item"><div><strong>${esc(t.text||'(không có chữ)')}</strong><small>${esc(areaLabel(t.area))} · ${t.enabled?'Đang hiển thị':'Đã ẩn'}</small></div><div class="item-actions"><button class="mini-button" data-edit-site-text="${t.id}">Sửa</button><button class="mini-button" data-toggle-site-text="${t.id}">${t.enabled?'Ẩn':'Hiện'}</button><button class="mini-button danger" data-delete-site-text="${t.id}">Xóa</button></div></div>`).join('')||'<div class="empty">Chưa có chữ tùy chỉnh.</div>';host.querySelectorAll('[data-edit-site-text]').forEach(b=>b.onclick=()=>editSiteText(b.dataset.editSiteText));host.querySelectorAll('[data-toggle-site-text]').forEach(b=>b.onclick=()=>toggleSiteText(b.dataset.toggleSiteText));host.querySelectorAll('[data-delete-site-text]').forEach(b=>b.onclick=()=>deleteSiteText(b.dataset.deleteSiteText));}
function editSiteText(id){const t=siteTexts.find(x=>x.id===id);if(!t)return;editingSiteTextId=id;$('siteTextArea').value=t.area;$('siteTextValue').value=t.text;$('siteTextEnabled').checked=t.enabled!==false;$('saveSiteText').textContent='Lưu thay đổi chữ';$('siteTextValue').focus();}
async function saveSiteText(){if(!isAdmin()||!db)return;const text=$('siteTextValue').value.trim(),area=$('siteTextArea').value;if(!text)return msg('siteTextMessage','Nhập nội dung chữ trước khi lưu.','error');let result;if(editingSiteTextId){result=await db.from('site_texts').update({area,text,enabled:$('siteTextEnabled').checked}).eq('id',editingSiteTextId).select().single();}else if(area==='rare_badge'||area==='default_badge'){const existing=siteTexts.find(t=>t.area===area);result=existing?await db.from('site_texts').update({text,enabled:$('siteTextEnabled').checked}).eq('id',existing.id).select().single():await db.from('site_texts').insert({area,text,enabled:$('siteTextEnabled').checked,sort_order:0}).select().single();}else{result=await db.from('site_texts').insert({area,text,enabled:$('siteTextEnabled').checked,sort_order:siteTexts.filter(t=>t.area===area).length}).select().single();}const {data,error}=result;if(error)return msg('siteTextMessage','Không lưu được: '+error.message,'error');const idx=siteTexts.findIndex(t=>t.id===data.id);if(idx>=0)siteTexts[idx]=data;else siteTexts.push(data);editingSiteTextId=null;$('siteTextValue').value='';$('saveSiteText').textContent='Thêm chữ vào website';renderSiteTextList();renderGallery();renderCustomSiteTexts();msg('siteTextMessage','Đã lưu chữ trên website.','success');}
async function toggleSiteText(id){const t=siteTexts.find(x=>x.id===id);if(!t||!isAdmin())return;const {data,error}=await db.from('site_texts').update({enabled:!t.enabled}).eq('id',id).select().single();if(error)return toast('Không thể cập nhật: '+error.message);Object.assign(t,data);renderSiteTextList();renderGallery();renderCustomSiteTexts();}
async function deleteSiteText(id){if(!isAdmin())return;const {error}=await db.from('site_texts').delete().eq('id',id);if(error)return toast('Không thể xóa: '+error.message);siteTexts=siteTexts.filter(t=>t.id!==id);if(editingSiteTextId===id){editingSiteTextId=null;$('siteTextValue').value='';$('saveSiteText').textContent='Thêm chữ vào website';}renderSiteTextList();renderGallery();renderCustomSiteTexts();}
function normalizeQuickOrder(ordered){
 const ids=ordered.map(m=>m.id).slice(0,8);
 const saved=ordered.find(m=>Array.isArray(m.quick_order)&&m.quick_order.length)?.quick_order;
 if(!Array.isArray(saved)||!saved.length)return [...ids,...Array(Math.max(0,8-ids.length)).fill(null)].slice(0,8);
 // New format stores eight positions (including null gaps); old compact arrays are upgraded safely.
 if(saved.length>=8){
   const used=new Set();
   const result=saved.slice(0,8).map(id=>{if(!id||!ids.includes(id)||used.has(id))return null;used.add(id);return id;});
   const remaining=ids.filter(id=>!used.has(id));
   for(let i=0;i<8&&remaining.length;i++)if(result[i]===null)result[i]=remaining.shift();
   return result;
 }
 const compact=[...saved.filter(id=>ids.includes(id)),...ids.filter(id=>!saved.includes(id))];
 return [...compact.slice(0,8),...Array(Math.max(0,8-compact.length)).fill(null)].slice(0,8);
}
async function saveQuickOrder(order){
 if(!isAdmin()||!db)return false;
 const normalized=Array.from({length:8},(_,i)=>order[i]||null);
 // Keep the same arrangement no matter which map is currently selected.
 const results=await Promise.all(maps.map(m=>db.from('maps').update({quick_order:normalized}).eq('id',m.id)));
 const failed=results.find(r=>r.error);
 if(failed){toast('Không lưu được vị trí ô. Hãy chạy quick-order-migration.sql và kiểm tra quyền quản trị Supabase. '+failed.error.message);return false;}
 maps.forEach(m=>{m.quick_order=normalized.slice();});
 renderGallery();toast('Đã lưu vị trí các ô biểu tượng.');return true;
}
function renderGallery(){
 const q=($('gallerySearch')?.value||'').toLowerCase(),d=$('galleryDifficulty')?.value||'all';
 const ordered=maps.slice().sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0));
 const difficultyMaps=ordered.filter(m=>d==='all'||m.difficulty===d);
 const filtered=difficultyMaps.filter(m=>(m.name||'').toLowerCase().includes(q));
 const host=$('mapGallery'),quick=$('quickMapGrid');if(!host)return;
 if(!filtered.length){host.innerHTML='<div class="empty">Chưa có bản đồ phù hợp. Hãy kết nối Supabase hoặc thêm bản đồ trong quản trị.</div>';if(quick)quick.innerHTML='<div class="empty">Chưa có sơ đồ</div>';return;}
 const defaultId=(ordered[0]||{}).id;
 if(quick){
   const active=byId(currentMapId)||difficultyMaps[0]||ordered[0],slots=Array.isArray(active?.quick_slots)?active.quick_slots:[],order=normalizeQuickOrder(difficultyMaps),layout=Array.from({length:9},(_,i)=>i===4?null:order[i<4?i:i-1]||null);
   quick.innerHTML=layout.map((id,i)=>{
     if(i===4){const door=slots[i]?.url;return `<div class="quick-map quick-door-slot quick-default" aria-label="Cửa chính, không thể chọn"><span class="quick-thumb">${door?`<img src="${esc(door)}" alt="">`:'🚪'}</span></div>`;}
     const slotIndex=i<4?i:i-1,m=byId(id),custom=slots[i]?.url;
     if(!m)return `<div class="quick-map quick-empty-slot ${session?'quick-drop-target':''}" data-slot-index="${slotIndex}" aria-label="Ô trống"><span class="quick-thumb">⌖</span></div>`;
     return `<button type="button" class="quick-map ${m.id===currentMapId?'quick-current':''} ${session?'quick-draggable':''}" data-quick-map="${m.id}" data-slot-index="${slotIndex}" title="${esc(m.name)}"><span class="quick-thumb">${custom?`<img src="${esc(custom)}" alt="">`:(m.thumbnail_url||m.image_url)?`<img src="${esc(m.thumbnail_url||m.image_url)}" alt="">`:'⌖'}</span></button>`;
   }).join('');
   const hint=$('quickLayoutHint');if(hint)hint.hidden=!session;
   let pointerDrag=null,suppressClick=false;
   if(session){
     quick.querySelectorAll('[data-slot-index]').forEach(tile=>{
       tile.addEventListener('pointerdown',e=>{
         if(e.button!==0||e.target.closest('.quick-door-slot'))return;
         pointerDrag={from:Number(tile.dataset.slotIndex),startX:e.clientX,startY:e.clientY,moved:false,pointerId:e.pointerId};
         tile.classList.add('dragging');
         try{tile.setPointerCapture(e.pointerId);}catch{}
         e.preventDefault();
       });
       tile.addEventListener('pointermove',e=>{
         if(!pointerDrag||pointerDrag.pointerId!==e.pointerId)return;
         if(Math.abs(e.clientX-pointerDrag.startX)+Math.abs(e.clientY-pointerDrag.startY)>6)pointerDrag.moved=true;
       });
       const finish=async e=>{
         if(!pointerDrag||pointerDrag.pointerId!==e.pointerId)return;
         const drag=pointerDrag;pointerDrag=null;
         quick.querySelectorAll('.dragging').forEach(el=>el.classList.remove('dragging'));
         if(!drag.moved)return;
         suppressClick=true;
         const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('#quickMapGrid [data-slot-index]');
         if(target){const to=Number(target.dataset.slotIndex);if(Number.isInteger(to)&&to>=0&&to<8&&to!==drag.from){const next=normalizeQuickOrder(ordered);[next[drag.from],next[to]]=[next[to],next[drag.from]];await saveQuickOrder(next);}}
         setTimeout(()=>{suppressClick=false;},250);
       };
       tile.addEventListener('pointerup',finish);tile.addEventListener('pointercancel',()=>{pointerDrag=null;tile.classList.remove('dragging');});
       tile.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopPropagation();return;}if(tile.dataset.quickMap)openMapPage(tile.dataset.quickMap);});
     });
   }else quick.querySelectorAll('[data-quick-map]').forEach(tile=>tile.addEventListener('click',()=>openMapPage(tile.dataset.quickMap)));
 }
 host.innerHTML=filtered.map((m,i)=>`<article class="gallery-card ${m.id===defaultId?'default-map':''}" data-gallery-card="${m.id}"><div class="gallery-thumb">${(m.thumbnail_url||m.image_url)?`<img src="${esc(m.thumbnail_url||m.image_url)}" alt="Ảnh ${esc(m.name)}">`:'<span class="thumb-placeholder">⌖</span>'}<span class="gallery-corner">${ordered.findIndex(x=>x.id===m.id)+1}</span><button class="corner-select" data-open-map="${m.id}" aria-label="Mở ${esc(m.name)}">↗</button></div><div class="gallery-card-copy"><strong>${esc(m.name)}</strong><small>${esc(m.notes||((m.area||'Lost Sanctum')+' · '+(m.difficulty||'Độ khó chưa đặt')))}</small><div class="card-bottom"><span class="map-tag ${/nightmare|chaos/i.test(m.difficulty||'')?'rare-tag':''}">${/nightmare|chaos/i.test(m.difficulty||'')?esc(siteTextFor('rare_badge','HIẾM HƠN')):esc(m.difficulty||'BẢN ĐỒ')}</span><span class="card-open">Mở bản đồ ⟶</span></div>${m.id===defaultId?`<span class="default-label">${esc(siteTextFor('default_badge','MẶC ĐỊNH'))}</span>`:''}${siteTexts.filter(t=>t.area==='gallery_card'&&t.enabled!==false).map(t=>`<span class="custom-card-label">${esc(t.text)}</span>`).join('')}</div></article>`).join('');
 renderCustomSiteTexts();
 host.querySelectorAll('[data-open-map]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();openMapPage(b.dataset.openMap);}));
 host.querySelectorAll('[data-gallery-card]').forEach(card=>card.addEventListener('click',()=>openMapPage(card.dataset.galleryCard)));
}

async function openMapPage(id){await selectMap(id);$('mapGalleryPage').hidden=true;$('mapDetailPage').hidden=false;renderCustomSiteTexts();window.scrollTo({top:0,behavior:'smooth'});}
async function moveMap(id,delta){if(!isAdmin()||!db)return;const ordered=maps.slice().sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0));const i=ordered.findIndex(m=>m.id===id),j=i+delta;if(i<0||j<0||j>=ordered.length)return;const a=ordered[i],b=ordered[j];const {error:e1}=await db.from('maps').update({sort_order:Number(b.sort_order??j)}).eq('id',a.id);const {error:e2}=await db.from('maps').update({sort_order:Number(a.sort_order??i)}).eq('id',b.id);if(e1||e2){toast('Không thể đổi thứ tự. Hãy chạy phần cập nhật SQL trong README.');return;}await loadMaps();toast('Đã cập nhật vị trí bản đồ.');}
async function selectMap(id){const m=byId(id);if(!m)return;if(currentMapId&&currentMapId!==id)clearProgress(currentMapId);currentMapId=id;placingPoint=false;renderMapList();renderGallery();$('currentTitle').textContent=m.name;$('currentMeta').textContent=`${m.area||'Lost Sanctum'} · ${m.difficulty||'Độ khó chưa đặt'}${m.notes?' · '+m.notes:''}`;$('mapPlaceholder').hidden=true;$('mapImage').hidden=false;$('mapImage').src=m.image_url;$('mapImage').alt=m.name;$('mapImage').onerror=()=>{$('mapImage').hidden=true;$('mapPlaceholder').hidden=false;$('mapPlaceholder').querySelector('h3').textContent='Không tải được ảnh bản đồ';};$('mapImage').onload=()=>{if($('mapImage').naturalWidth){$('mapCanvas').style.minHeight='0';$('mapCanvas').style.height='auto';$('mapImage').hidden=false;$('mapPlaceholder').hidden=true;}};if(db)await loadPoints(id);else renderMarkers();if(session){$('pointMap').value=id;renderPointList();}}
function clearMap(){$('mapCanvas').style.minHeight='100%';$('mapCanvas').style.height='auto';$('currentTitle').textContent='Chưa có bản đồ';$('currentMeta').textContent='Đăng nhập quản trị để thêm bản đồ đầu tiên.';$('mapImage').hidden=true;$('mapPlaceholder').hidden=false;$('markerLayer').innerHTML='';$('markerSummary').textContent='Chưa có điểm đánh dấu';}
async function loadPoints(id){if(!db)return;const {data,error}=await db.from('map_points').select('*').eq('map_id',id).order('created_at',{ascending:true});if(error){console.error(error);return;}points=data||[];renderMarkers();renderPointList();}
function renderMarkers(){const layer=$('markerLayer');if(!layer)return;const shown=points.filter(p=>visibleTypes[p.type]&&(isAdmin()||p.visible!==false));const done=shown.filter(p=>isCompleted(p.id)).length;layer.innerHTML=shown.map(p=>{const completed=isCompleted(p.id);return `<button class="marker ${esc(p.type)} ${completed?'completed':''}" data-point-id="${p.id}" style="left:${Number(p.x_pct)}%;top:${Number(p.y_pct)}%" title="${esc(p.label||ICONS[p.type])}${completed?' · Đã hoàn thành':''}" aria-pressed="${completed}">${(mapIcon(p.type).startsWith('http')?'<img class="marker-custom-icon" src="'+esc(mapIcon(p.type))+'" alt="">':esc(mapIcon(p.type)))}${completed?'<span class="completed-badge">✓</span>':''}${p.label?`<span class="marker-label">${esc(p.label)}</span>`:''}</button>`}).join('');layer.querySelectorAll('[data-point-id]').forEach(el=>{el.addEventListener('click',e=>{e.stopPropagation();if(drag&&drag.moved)return;toggleCompleted(el.dataset.pointId);});if(isAdmin())el.addEventListener('pointerdown',startDrag);});$('markerSummary').textContent=`${shown.length} điểm · ${done} đã hoàn thành · ${shown.length-done} còn lại`; }
function handleMapClick(e){if(!placingPoint||!isAdmin()||!currentMapId)return;const rect=$('mapImage').getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width*100,y=(e.clientY-rect.top)/rect.height*100;if(x<0||x>100||y<0||y>100)return;placingPoint=false;$('mapImage').style.cursor='';const type=$('pointType').value,label=$('pointLabel').value.trim(),visible=$('pointVisible').checked;db.from('map_points').insert({map_id:currentMapId,type,label,x_pct:+x.toFixed(3),y_pct:+y.toFixed(3),visible}).select().single().then(({data,error})=>{if(error){msg('pointMessage',error.message,'error');return;}points.push(data);renderMarkers();renderPointList();msg('pointMessage','Đã lưu điểm trên bản đồ.','success');$('pointLabel').value='';});}
function startPlacePoint(){if(!isAdmin()||!db)return;const id=$('pointMap').value||currentMapId;if(!id)return msg('pointMessage','Hãy thêm bản đồ trước.','error');if(id!==currentMapId){selectMap(id).then(()=>activatePlacement());}else activatePlacement();}
function activatePlacement(){closeAdmin();placingPoint=true;$('mapImage').style.cursor='crosshair';$('mapImage').classList.add('placing');switchTab('pointsTab');msg('pointMessage','Đang chờ vị trí — hãy bấm vào ảnh bản đồ.');toast('Bấm vào vị trí cần đánh dấu trên bản đồ.');}
async function saveMap(){if(!isAdmin()||!db)return;const name=$('mapName').value.trim(),file=$('mapFile').files[0];if(!name||!file)return msg('mapMessage','Vui lòng nhập tên và chọn ảnh bản đồ.','error');if(!file.type.startsWith('image/'))return msg('mapMessage','File tải lên phải là hình ảnh.','error');if(file.size>12*1024*1024)return msg('mapMessage','Ảnh quá lớn. Hãy chọn ảnh dưới 12 MB.','error');$('saveMap').disabled=true;msg('mapMessage','Đang tải ảnh lên…');const ext=(file.name.split('.').pop()||'png').replace(/[^a-zA-Z0-9]/g,'');const path=`${session.user.id}/${crypto.randomUUID()}.${ext}`;const up=await db.storage.from(STORAGE_BUCKET).upload(path,file,{cacheControl:'3600',upsert:false});if(up.error){$('saveMap').disabled=false;return msg('mapMessage','Tải ảnh thất bại: '+up.error.message,'error');}const {data:{publicUrl}}=db.storage.from(STORAGE_BUCKET).getPublicUrl(path);msg('mapMessage','Đang lưu thông tin bản đồ…');const sharedIconConfig=getSharedIconConfig();const {data,error}=await db.from('maps').insert({name,area:$('mapArea').value.trim()||'Lost Sanctum',difficulty:$('mapDifficulty').value,notes:$('mapNotes').value.trim(),image_url:publicUrl,thumbnail_url:publicUrl,image_path:path,icon_config:sharedIconConfig,published:$('mapPublished').checked,sort_order:maps.length?Math.min(...maps.map(m=>Number(m.sort_order)||0))-1:0,created_by:session.user.id}).select().single();$('saveMap').disabled=false;if(error){msg('mapMessage','Lưu bản đồ thất bại: '+error.message,'error');return;}maps.unshift(data);currentMapId=data.id;$('mapName').value='';$('mapNotes').value='';$('mapFile').value='';msg('mapMessage','Đã thêm bản đồ thành công.','success');renderMapList();refreshAdminLists();await selectMap(data.id);toast('Đã thêm bản đồ mới.');}
function refreshAdminLists(){if(!session)return;$('adminMapList').innerHTML=maps.map(m=>`<div class="admin-map-item"><div><strong>${esc(m.name)}</strong><small>${esc(m.difficulty||'')} · ${m.published?'Công khai':'Ẩn'}</small></div><div class="item-actions"><button class="mini-button" data-move-map="${m.id}" data-delta="-1" title="Lên">↑</button><button class="mini-button" data-move-map="${m.id}" data-delta="1" title="Xuống">↓</button><button class="mini-button" data-edit-map="${m.id}">Chọn</button><button class="mini-button danger" data-delete-map="${m.id}">Xóa</button></div></div>`).join('')||'<div class="empty">Chưa có bản đồ.</div>';document.querySelectorAll('[data-edit-map]').forEach(b=>b.onclick=async()=>{await selectMap(b.dataset.editMap);$('pointMap').value=b.dataset.editMap;switchTab('pointsTab');});document.querySelectorAll('[data-delete-map]').forEach(b=>b.onclick=()=>deleteMap(b.dataset.deleteMap));document.querySelectorAll('[data-move-map]').forEach(b=>b.onclick=()=>moveMap(b.dataset.moveMap,Number(b.dataset.delta)));const assetOld=$('assetMap').value;$('assetMap').innerHTML=maps.map(m=>`<option value="${m.id}">${esc(m.name)} · ${esc(m.area||'')}</option>`).join('');if(maps.some(m=>m.id===assetOld))$('assetMap').value=assetOld;else if(currentMapId)$('assetMap').value=currentMapId;renderIconPreviews();renderQuickSlotAdmin();const old=$('pointMap').value;$('pointMap').innerHTML=maps.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('');if(maps.some(m=>m.id===old))$('pointMap').value=old;else if(currentMapId)$('pointMap').value=currentMapId;renderPointList();}
async function deleteMap(id){const m=byId(id);if(!m||!confirm(`Xóa bản đồ “${m.name}” cùng toàn bộ điểm đã đánh dấu?`))return;const {error}=await db.from('maps').delete().eq('id',id);if(error)return toast('Không thể xóa: '+error.message);if(m.image_path)await db.storage.from(STORAGE_BUCKET).remove([m.image_path]);maps=maps.filter(x=>x.id!==id);if(currentMapId===id)currentMapId=maps[0]?.id||null;await loadMaps();toast('Đã xóa bản đồ.');}
function renderPointList(){if(!session)return;const list=points.filter(p=>p.map_id===($('pointMap').value||currentMapId));$('pointList').innerHTML=list.map(p=>`<div class="point-item"><div><strong>${ICONS[p.type]||'📍'} ${esc(p.label||p.type)}</strong><small>${esc(p.type)} · X ${Number(p.x_pct).toFixed(1)}% / Y ${Number(p.y_pct).toFixed(1)}% · ${p.visible?'Công khai':'Ẩn'}</small></div><div class="item-actions"><button class="mini-button danger" data-delete-point="${p.id}">Xóa</button></div></div>`).join('')||'<div class="empty">Chưa có điểm nào trên bản đồ này.</div>';document.querySelectorAll('[data-delete-point]').forEach(b=>b.onclick=()=>deletePoint(b.dataset.deletePoint));}
async function deletePoint(id){const {error}=await db.from('map_points').delete().eq('id',id);if(error)return toast('Không thể xóa điểm: '+error.message);points=points.filter(p=>p.id!==id);renderMarkers();renderPointList();toast('Đã xóa điểm.');}

function renderQuickSlotAdmin(){const host=$('quickSlotAdmin');if(!host)return;const m=byId($('assetMap')?.value);if(!m){host.innerHTML='';return;}const slots=Array.isArray(m.quick_slots)?m.quick_slots:[];$('editMapNotes').value=m.notes||'';host.innerHTML=Array.from({length:9},(_,i)=>`<div class="quick-slot-admin-item"><strong>${i===4?'Ô trung tâm · Cửa chính':'Ô '+(i+1)}</strong><div class="quick-slot-preview">${slots[i]?.url?`<img src="${esc(slots[i].url)}" alt="Thumbnail ô ${i+1}">`:i===4?'🚪':'⌖'}</div><input id="quickSlotFile${i}" class="control file-control" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Ảnh thumbnail ô ${i+1}"></div>`).join('');}
async function saveMapCustomization(){if(!isAdmin()||!db)return;const id=$('assetMap').value,m=byId(id);if(!m)return;const button=$('saveMapCustomization');button.disabled=true;msg('customizationMessage','Đang lưu thumbnail và ghi chú…');try{const slots=Array.from({length:9},(_,i)=>({...((Array.isArray(m.quick_slots)?m.quick_slots:[])[i]||{})}));for(let i=0;i<9;i++){const file=$(`quickSlotFile${i}`)?.files?.[0];if(!file)continue;if(!file.type.startsWith('image/'))throw new Error(`File ô ${i+1} không phải ảnh hợp lệ.`);if(file.size>12*1024*1024)throw new Error(`Ảnh ô ${i+1} vượt quá 12 MB.`);const ext=file.type==='image/jpeg'?'jpg':(file.type.split('/')[1]||'png');const path=`${session.user.id}/${id}-slot-${i+1}-${crypto.randomUUID()}.${ext}`;slots[i]={...(slots[i]||{}),url:await uploadAsset(file,path),path};}const {data,error}=await db.from('maps').update({notes:$('editMapNotes').value.trim(),quick_slots:slots}).eq('id',id).select().single();if(error)throw error;Object.assign(m,data);renderGallery();renderMapList();renderQuickSlotAdmin();if(currentMapId===id)await selectMap(id);msg('customizationMessage','Đã lưu thumbnail và ghi chú thành công.','success');toast('Đã cập nhật bảng thumbnail và ghi chú.');}catch(e){msg('customizationMessage','Không thể lưu: '+e.message,'error');}finally{button.disabled=false;}}

async function replaceMapImage(){
 if(!isAdmin()||!db)return;const id=$('assetMap').value,m=byId(id),file=$('replacementMapFile').files[0];if(!m||!file)return msg('assetMessage','Chọn bản đồ và ảnh mới trước.','error');
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))return msg('assetMessage','Chỉ hỗ trợ PNG, JPG hoặc WEBP.','error');if(file.size>12*1024*1024)return msg('assetMessage','Ảnh phải nhỏ hơn 12 MB.','error');
 $('replaceMapImage').disabled=true;try{const ext=file.type==='image/jpeg'?'jpg':file.type.split('/')[1];const path=`${session.user.id}/${id}-map-${crypto.randomUUID()}.${ext}`;const url=await uploadAsset(file,path);const {data,error}=await db.from('maps').update({image_url:url,image_path:path}).eq('id',id).select().single();if(error)throw error;Object.assign(m,data);$('replacementMapFile').value='';renderMapList();if(currentMapId===id)await selectMap(id);msg('assetMessage','Đã cập nhật ảnh bản đồ.','success');toast('Đã thay ảnh bản đồ.');}catch(e){msg('assetMessage','Không thể thay ảnh: '+e.message,'error');}finally{$('replaceMapImage').disabled=false;}
}

async function replaceMapThumbnail(){
 if(!isAdmin()||!db)return;const id=$('assetMap').value,m=byId(id),file=$('replacementThumbFile').files[0];if(!m||!file)return msg('assetMessage','Chọn bản đồ và ảnh thu nhỏ trước.','error');
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))return msg('assetMessage','Ảnh thu nhỏ chỉ hỗ trợ PNG, JPG hoặc WEBP.','error');if(file.size>12*1024*1024)return msg('assetMessage','Ảnh phải nhỏ hơn 12 MB.','error');
 $('replaceMapThumbnail').disabled=true;try{const ext=file.type==='image/jpeg'?'jpg':file.type.split('/')[1];const path=`${session.user.id}/${id}-thumbnail-${crypto.randomUUID()}.${ext}`;const url=await uploadAsset(file,path);const {data,error}=await db.from('maps').update({thumbnail_url:url}).eq('id',id).select().single();if(error)throw error;Object.assign(m,data);$('replacementThumbFile').value='';renderMapList();msg('assetMessage','Đã cập nhật ảnh thu nhỏ.','success');toast('Đã thay ảnh thu nhỏ của thẻ bản đồ.');}catch(e){msg('assetMessage','Không thể thay ảnh thu nhỏ: '+e.message,'error');}finally{$('replaceMapThumbnail').disabled=false;}
}
async function uploadMapIcon(type){
 if(!isAdmin()||!db)return;
 const id=$('assetMap').value,m=byId(id),file=$(`iconFile_${type}`).files[0];
 if(!m||!file)return msg('assetMessage','Chọn bản đồ và file icon trước.','error');
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))return msg('assetMessage','Icon chỉ hỗ trợ PNG, JPG hoặc WEBP.','error');
 if(file.size>5*1024*1024)return msg('assetMessage','Icon phải nhỏ hơn 5 MB.','error');
 const buttons=[...document.querySelectorAll('[data-upload-icon]')];buttons.forEach(b=>b.disabled=true);
 try{
  const ext=file.type==='image/jpeg'?'jpg':file.type.split('/')[1];
  const path=`${session.user.id}/shared-icon-${type}-${crypto.randomUUID()}.${ext}`;
  const url=await uploadAsset(file,path);
  // Icon types are shared by all maps. Save the same URL to every map so every map's markers use it.
  for(const map of maps){
   const config={...normalizedIconConfig(map.icon_config),[type]:url};
   const {data,error}=await db.from('maps').update({icon_config:config}).eq('id',map.id).select().single();
   if(error)throw new Error(`Không lưu được icon cho bản đồ "${map.name}": ${error.message}`);
   Object.assign(map,data);
  }
  renderIconPreviews();renderMarkers();renderGallery();
  msg('assetMessage',`Đã cập nhật icon ${type} cho tất cả bản đồ.`,'success');
  toast('Đã cập nhật icon trên tất cả bản đồ.');
 }catch(e){msg('assetMessage','Không thể cập nhật icon: '+e.message,'error');}
 finally{buttons.forEach(b=>b.disabled=false);}
}
async function resetMapIcon(type){
 if(!isAdmin()||!db)return;
 const buttons=[...document.querySelectorAll('[data-reset-icon]')];buttons.forEach(b=>b.disabled=true);
 try{
  // Reset this icon type globally, keeping each map's other icon settings intact.
  for(const map of maps){
   const config={...normalizedIconConfig(map.icon_config)};delete config[type];
   const {data,error}=await db.from('maps').update({icon_config:config}).eq('id',map.id).select().single();
   if(error)throw new Error(`Không đặt lại được icon cho bản đồ "${map.name}": ${error.message}`);
   Object.assign(map,data);
  }
  renderIconPreviews();renderMarkers();renderGallery();
  msg('assetMessage',`Đã khôi phục icon ${type} mặc định trên tất cả bản đồ.`,'success');
  toast('Đã đặt lại icon trên tất cả bản đồ.');
 }catch(e){msg('assetMessage','Không thể đặt lại icon: '+e.message,'error');}
 finally{buttons.forEach(b=>b.disabled=false);}
}
window.addEventListener('pagehide',()=>clearProgress(currentMapId));
function switchTab(id){activeTab=id;document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===id));document.querySelectorAll('.tab-panel').forEach(p=>p.hidden=p.id!==id);if(id==='siteTextTab')renderSiteTextList();}
function setZoom(v){zoom=Math.max(.5,Math.min(2.5,v));$('mapCanvas').style.width=(zoom*100)+'%';$('mapCanvas').style.minWidth=(zoom*100)+'%';$('zoomReset').textContent=Math.round(zoom*100)+'%';}
let drag=null;function startDrag(e){if(!isAdmin()||e.button!==0)return;const id=e.currentTarget.dataset.pointId;drag={id,startX:e.clientX,startY:e.clientY,moved:false};const move=ev=>{if(!drag)return;const dx=ev.clientX-drag.startX,dy=ev.clientY-drag.startY;if(Math.abs(dx)+Math.abs(dy)>3)drag.moved=true;const el=document.querySelector(`[data-point-id="${drag.id}"]`),img=$('mapImage'),r=img.getBoundingClientRect();if(el){el.style.left=Math.max(0,Math.min(100,(ev.clientX-r.left)/r.width*100))+'%';el.style.top=Math.max(0,Math.min(100,(ev.clientY-r.top)/r.height*100))+'%';}};const up=async ev=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);if(drag&&drag.moved){const el=document.querySelector(`[data-point-id="${drag.id}"]`),r=$('mapImage').getBoundingClientRect();if(el){const x=Math.max(0,Math.min(100,(ev.clientX-r.left)/r.width*100)),y=Math.max(0,Math.min(100,(ev.clientY-r.top)/r.height*100));const {error}=await db.from('map_points').update({x_pct:+x.toFixed(3),y_pct:+y.toFixed(3)}).eq('id',drag.id);if(error)toast('Không thể cập nhật vị trí: '+error.message);else{const p=points.find(p=>p.id===drag.id);if(p){p.x_pct=x;p.y_pct=y;}renderMarkers();renderPointList();}}}drag=null;};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true});}
window.addEventListener('DOMContentLoaded',init);
