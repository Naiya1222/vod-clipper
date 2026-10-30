import {videoId,parseTime,time,validate,decode,shareURL,trimEndpoint,createSeekSession,timelineTime,saveRecord,deleteRecord,MAX_TIME} from './core.mjs?v=20261030-speed-slider';
const $ = id => document.getElementById(id);
let data=null, selected=null, editing=null, player=null, ready=false, current=0, stopAt=null, focusBounds=[0,1], generation=0, readOnly=false, demo=false, activeDraftKey=null;
let draftMarks={start:false,end:false},overviewGesture=null,suppressOverviewClickUntil=0;
let autoSelection=null,titleEditRevision=0;
const KEY='vod-review-drafts-v1';
const seekSession=createSeekSession();
let scrubWasPlaying=false;
let speedRates=[1],speedDragging=false,speedPending=null,speedSyncTimer=null;
let cache={last:null,records:{},updated:{}};
try { const saved=JSON.parse(localStorage.getItem(KEY)||'null'); if(saved?.records&&typeof saved.records==='object') cache={...saved,updated:saved.updated||{}}; } catch {}
const sorted=()=>data?[...data.clips].sort((a,b)=>a.start-b.start||a.end-b.end):[];
const active=()=>data?.clips.find(c=>c.id===selected);
const uid=()=>crypto.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2);
function announce(message){const notice=$('notice');notice.textContent=message;notice.hidden=!message;if(message)notice.append(button('關閉',()=>{notice.hidden=true;},'quiet dismiss'));}
function error(message){$('formError').textContent=message;$('formError').hidden=!message;}
function persist(){
  if(!data||readOnly||demo)return;
  try{const next=saveRecord(cache,activeDraftKey||data.video,data);localStorage.setItem(KEY,JSON.stringify(next));cache=next;if($('historyDrawer').open)renderHistory();}
  catch{announce('無法儲存影片記錄，請先複製分享連結備份。');}
}
function historyMessage(message,undo){
  const el=$('historyNotice');el.replaceChildren(text('span',message));if(undo)el.append(button('復原',undo,'quiet'));el.hidden=false;
}
function renderHistory(){
  const list=$('historyList');list.replaceChildren();
  const records=Object.entries(cache.records).filter(([,record])=>{try{validate(record);return true;}catch{return false;}}).sort((a,b)=>(cache.updated[b[0]]||0)-(cache.updated[a[0]]||0));
  if(!records.length){list.append(text('p','尚無影片記錄','history-empty'));return;}
  for(const [key,record] of records){
    const row=text('div','',`history-row${key===activeDraftKey&&!readOnly?' current':''}`);
    const open=button('',()=>{openData(record,{draftKey:key});history.replaceState(null,'',location.pathname+location.search);$('historyDrawer').close();},'history-open');
    const thumb=document.createElement('img');thumb.src=`https://i.ytimg.com/vi/${record.video}/mqdefault.jpg`;thumb.alt='';thumb.loading='lazy';
    const copy=text('span','','history-copy');copy.append(text('strong',record.title||'未命名片段擷取'),text('small',`${record.clips.length} 段片段 · ${record.video}`));open.append(thumb,copy);row.append(open);
    const remove=button('',()=>removeHistory(key),'quiet history-delete');remove.setAttribute('aria-label',`刪除影片記錄：${record.title||record.video}`);remove.title='刪除影片記錄';remove.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></svg>';row.append(remove);list.append(row);
  }
}
function removeHistory(key){
  const removed=cache.records[key],updatedAt=cache.updated[key];if(!removed)return;
  try{const next=deleteRecord(cache,key);localStorage.setItem(KEY,JSON.stringify(next));cache=next;}
  catch{historyMessage('無法刪除，請確認瀏覽器允許儲存資料。');return;}
  if(activeDraftKey===key&&!readOnly){
    ++generation;player?.destroy?.();player=null;ready=false;data=null;activeDraftKey=null;selected=null;editing=null;seekSession.cancel();$('source').value='';$('sharePanel').hidden=true;render();
  }
  renderHistory();$('closeHistory').focus();
  historyMessage('已刪除影片記錄。',()=>{
    try{const next=saveRecord(cache,key,removed,updatedAt||Date.now());localStorage.setItem(KEY,JSON.stringify(next));cache=next;renderHistory();$('historyNotice').hidden=true;}
    catch{historyMessage('無法復原，請確認瀏覽器允許儲存資料。');}
  });
}
function text(tag,value,cls){const el=document.createElement(tag);el.textContent=value;if(cls)el.className=cls;return el;}
function button(label,fn,cls='quiet'){const el=text('button',label,cls);el.type='button';el.addEventListener('click',fn);return el;}
function updateTime(){
  $('currentTime').textContent=time(current);
  $('seek').value=current;
  if(!data)return;
  $('seek').setAttribute('aria-valuetext',time(current));
  $('playhead').hidden=false;$('playhead').style.left=`${Math.min(100,current/data.duration*100)}%`;
  const [a,b]=focusBounds;$('focusHead').hidden=current<a||current>b;$('focusHead').style.left=`${(current-a)/(b-a)*100}%`;
}
function paintDraftMarks(){
  if(!data)return;
  const start=parseTime($('start').value),end=parseTime($('end').value);
  for(const [id,field,value,label] of [['draftStartMarker','start',start,'起點'],['draftEndMarker','end',end,'終點']]){
    const marker=$(id),visible=!readOnly&&draftMarks[field]&&Number.isFinite(value)&&value<=data.duration;
    marker.hidden=!visible;if(visible){const ratio=value/data.duration,width=$('overview').getBoundingClientRect().width;marker.style.left=`${ratio*100}%`;marker.classList.toggle('near-left',ratio*width<30);marker.classList.toggle('near-right',(1-ratio)*width<30);marker.title=`${label} ${time(value)}`;marker.setAttribute('aria-label',`${label} ${time(value)}`);}
    $(field==='start'?'markStart':'markEnd').classList.toggle('is-marked',visible);
  }
  const valid=!readOnly&&draftMarks.start&&draftMarks.end&&Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end<=data.duration;
  $('draftRange').hidden=!valid;if(valid){$('draftRange').style.left=`${start/data.duration*100}%`;$('draftRange').style.width=`${(end-start)/data.duration*100}%`;}
}
function seek(seconds,play=false){
  if(!data)return;
  current=Math.max(0,Math.min(data.duration,seconds));stopAt=null;
  seekSession.request(current);
  if(ready){player.seekTo(current,true);if(play)player.playVideo();}
  else if(play)announce('播放器還沒準備好。請稍候；若無法嵌入，仍可編輯標註時間。');
  updateTime();
}
function playClip(clip){
  if(!clip)return;
  selected=clip.id;renderList();renderTimeline();$('reviewNote').textContent=clip.note||'這個片段尚未填寫備註。';
  seek(clip.start,true);if(ready)stopAt=clip.end;
}
function renderList(){
  const list=$('clipList');list.replaceChildren();
  const clips=sorted();
  if(!clips.length){const empty=text('div','', 'empty-list');empty.append(text('p','尚無片段'));list.append(empty);}
  clips.forEach((clip,i)=>{
    const row=text('div','',`clip-row${selected===clip.id?' selected':''}`);
    const pick=button('',()=>playClip(clip),'clip-select');pick.setAttribute('aria-label',`播放片段 ${i+1}：${clip.title}，${time(clip.start)} 至 ${time(clip.end)}`);pick.setAttribute('aria-pressed',String(selected===clip.id));
    const copy=text('span','','clip-copy');copy.append(text('strong',clip.title),text('small',`${time(clip.start)} – ${time(clip.end)} · ${time(clip.end-clip.start)}`));
    pick.append(text('span',String(i+1).padStart(2,'0'),'clip-number'),copy);row.append(pick);
    if(!readOnly){const actions=text('div','','row-actions');actions.append(button('編輯',()=>edit(clip)),button('刪除',()=>remove(clip),'quiet delete'));row.append(actions);}
    list.append(row);
  });
  $('clipCount').textContent=clips.length;
  const seconds=clips.reduce((s,c)=>s+c.end-c.start,0);
  $('summary').textContent=clips.length?`${clips.length} 段標註 · 片段時長合計 ${time(seconds)}${demo?' · 示範標註':''}`:'尚無標註片段';
  $('shareBtn').disabled=!clips.length;$('playClipBtn').disabled=!active();
  $('reviewNote').textContent=active()?.note||'這個片段尚未填寫備註。';
  const index=clips.findIndex(c=>c.id===selected);$('prevClip').disabled=index<=0;$('nextClip').disabled=index<0||index>=clips.length-1;
}
function ticks(el,a,b,count=6){el.replaceChildren();for(let i=0;i<=count;i++)el.append(text('span',time(a+(b-a)*i/count)));}
function paintFocus(c){
  const [a,b]=focusBounds;
  $('focusSpan').style.left=`${(c.start-a)/(b-a)*100}%`;$('focusSpan').style.width=`${(c.end-c.start)/(b-a)*100}%`;
  $('trimStartTime').textContent=time(c.start);$('trimEndTime').textContent=time(c.end);
  const width=$('focusTimeline').getBoundingClientRect().width;
  let left=Math.max(2,Math.min(width-24,(c.start-a)/(b-a)*width-22));
  let right=Math.max(2,Math.min(width-24,(c.end-a)/(b-a)*width));
  if(right-left<24){left=Math.max(2,Math.min(width-48,(left+right)/2-12));right=left+24;}
  for(const [id,field,x] of [['startHandle','start',left],['endHandle','end',right]]){
    const handle=$(id);handle.style.left=`${x}px`;handle.setAttribute('aria-valuemin',field==='start'?0:c.start+1);handle.setAttribute('aria-valuemax',field==='start'?c.end-1:data.duration);
    handle.setAttribute('aria-valuenow',c[field]);handle.setAttribute('aria-valuetext',time(c[field]));
  }
}
function renderTimeline({keepFocus=false}={}){
  if(!data)return;
  const clips=sorted(),bars=$('clipBars');bars.replaceChildren();
  const lanes=[];
  clips.forEach((clip,i)=>{
    let lane=lanes.findIndex(end=>end<=clip.start);if(lane<0)lane=lanes.length;lanes[lane]=clip.end;
    const bar=button(String(i+1).padStart(2,'0'),()=>{if(performance.now()>suppressOverviewClickUntil)playClip(clip);},`clip-bar${selected===clip.id?' selected':''}`);bar.dataset.clipId=clip.id;
    bar.style.left=`${clip.start/data.duration*100}%`;bar.style.width=`${(clip.end-clip.start)/data.duration*100}%`;bar.style.top=`${30+lane*26}px`;
    bar.title=`${clip.title} ${time(clip.start)} – ${time(clip.end)}`;bar.setAttribute('aria-label',bar.title);bars.append(bar);
  });
  const height=Math.max(90,lanes.length*26+44);$('overview').style.height=`${height}px`;
  ticks($('overviewTicks'),0,data.duration);
  const c=active();$('focusEmpty').hidden=!!c;$('focusSpan').hidden=!c;$('rangeReadout').hidden=!c;$('trimHint').hidden=!c||readOnly;
  $('startHandle').hidden=!c||readOnly;$('endHandle').hidden=!c||readOnly;
  if(c){
    const padding=600*Math.pow(1/120,Number($('zoom').value)/100);const [a,b]=keepFocus?focusBounds:[Math.max(0,c.start-padding),Math.min(data.duration,c.end+padding)];focusBounds=[a,b];
    paintFocus(c);
    ticks($('focusTicks'),a,b,4);
  }else{$('focusTicks').replaceChildren();focusBounds=[0,data.duration];}
  $('zoom').disabled=!c;$('zoomOut').disabled=!c||Number($('zoom').value)===0;$('zoomIn').disabled=!c||Number($('zoom').value)===100;
  $('zoom').setAttribute('aria-valuetext',`顯示 ${time(focusBounds[1]-focusBounds[0])} 的時間範圍`);
  updateTime();paintDraftMarks();
}
function render(){
  const reviewing=readOnly;document.body.classList.toggle('review',reviewing);document.body.classList.toggle('is-home',!data);$('workspace').hidden=!data;$('shareBtn').hidden=!data;
  $('projectTitle').value=data?.title||'未命名片段擷取';$('projectTitle').disabled=!data||reviewing;
  $('editorFields').disabled=!data||reviewing;
  $('ownCopy').hidden=!readOnly;$('reviewDetails').hidden=!reviewing;
  if(data){$('totalTime').textContent=time(data.duration);$('seek').max=data.duration;$('seek').disabled=false;renderList();renderTimeline();}
}
function resetEditor(){editing=null;autoSelection=null;draftMarks={start:false,end:false};$('clipForm').reset();$('start').value=time(Math.floor(current));$('end').value=time(Math.min(data?.duration||30,Math.floor(current)+30));$('clipTitle').value='';$('note').value='';$('saveClipLabel').textContent='新增片段';$('editorHeading').textContent='新增片段';$('cancelEdit').hidden=true;error('');paintDraftMarks();}
function edit(clip,{automatic=false,focus=true}={}){
  if(readOnly)return;
  stopAt=null;
  editing=clip.id;autoSelection=automatic?clip.id:null;selected=clip.id;$('start').value=time(clip.start);$('end').value=time(clip.end);$('clipTitle').value=clip.title;$('note').value=clip.note;
  draftMarks={start:true,end:true};$('editorHeading').textContent=automatic?'片段內容':'編輯片段';$('saveClipLabel').textContent=automatic?'新增下一段':'儲存修改';$('cancelEdit').hidden=automatic;error('');renderList();renderTimeline();if(focus)$('start').focus({preventScroll:true});
}
function remove(clip){
  if(readOnly)return;
  stopAt=null;
  data.clips=data.clips.filter(c=>c.id!==clip.id);if(editing===clip.id)resetEditor();if(selected===clip.id)selected=sorted()[0]?.id||null;
  renderList();renderTimeline();persist();
  const notice=$('notice');notice.replaceChildren(text('span',`已刪除「${clip.title}」。 `),button('復原刪除',()=>{if(data.clips.some(c=>c.id===clip.id))return;data.clips.push(clip);selected=clip.id;announce('已復原片段。');renderList();renderTimeline();persist();}));notice.hidden=false;
}
let apiPromise;
function api(){
  if(window.YT?.Player)return Promise.resolve();
  if(apiPromise)return apiPromise;
  apiPromise=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('YouTube 播放器載入逾時，請檢查網路後重新載入影片。')),18000);
    window.onYouTubeIframeAPIReady=()=>{clearTimeout(timer);resolve();};
    const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.onerror=()=>{clearTimeout(timer);reject(Error('無法連線到 YouTube。請檢查網路或瀏覽器的內容阻擋設定。'));};document.head.append(script);
  }).catch(e=>{apiPromise=null;throw e;});return apiPromise;
}
function playerMessage(message){$('playerMessage').textContent=message;$('playerMessage').hidden=!message;}
function updatePlayButton(playing=false){
  $('playIcon').toggleAttribute('hidden',playing);$('pauseIcon').toggleAttribute('hidden',!playing);
  $('playBtn').setAttribute('aria-label',playing?'暫停':'播放');$('playBtn').title=playing?'暫停':'播放';
}
function syncPlaybackRate(actual){
  const slider=$('playbackRate');
  if(!ready||!player){
    clearTimeout(speedSyncTimer);speedRates=[1];speedDragging=false;speedPending=null;
    slider.min=0;slider.max=0;slider.value=0;slider.disabled=true;showPlaybackRate(1);return;
  }
  const currentRate=Number.isFinite(actual)?actual:(player.getPlaybackRate?.()||1);
  if(speedDragging||(speedPending!==null&&currentRate!==speedPending))return;
  speedPending=null;speedRates=[...new Set([1,...(player.getAvailablePlaybackRates?.()||[]),currentRate])].filter(rate=>Number.isFinite(rate)&&rate>0).sort((a,b)=>a-b);
  slider.min=0;slider.max=speedRates.length-1;slider.value=speedRates.indexOf(currentRate);slider.disabled=speedRates.length<=1;
  slider.title=slider.disabled?'這支影片只支援一般速度':'左右拖曳調整播放速度';showPlaybackRate(currentRate);
}
function showPlaybackRate(rate){
  $('playbackRateValue').textContent=`${rate}×`;$('playbackRate').setAttribute('aria-valuetext',`${rate} 倍速`);
}
function confirmPlaybackRate(){
  clearTimeout(speedSyncTimer);const token=generation;
  speedSyncTimer=setTimeout(()=>{if(token===generation&&ready&&!speedDragging){speedPending=null;syncPlaybackRate();}},400);
}
async function loadVideoTitle(record,token){
  const revision=titleEditRevision,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
    const url=new URL('https://www.youtube.com/oembed');url.searchParams.set('url',`https://www.youtube.com/watch?v=${record.video}`);url.searchParams.set('format','json');
    const response=await fetch(url,{signal:controller.signal});if(!response.ok)return;
    const metadata=await response.json(),title=typeof metadata.title==='string'?metadata.title.trim().slice(0,200):'';
    if(!title||token!==generation||data!==record||readOnly||revision!==titleEditRevision)return;
    data.title=title;$('projectTitle').value=title;$('projectTitle').title=title;persist();
  }catch{}finally{clearTimeout(timer);}
}
async function mountPlayer({syncTitle=false}={}){
  const token=++generation;ready=false;$('playBtn').disabled=true;updatePlayButton();syncPlaybackRate();stopAt=null;seekSession.cancel();player?.destroy?.();player=null;
  if(!readOnly&&(syncTitle||/^未命名(?:片段擷取|審片)$/.test(data.title)||!data.title))loadVideoTitle(data,token);
  let mount=$('playerMount');if(!mount){mount=document.createElement('div');mount.id='playerMount';$('playerShell').append(mount);}mount.hidden=false;mount.replaceChildren();
  playerMessage('正在連接 YouTube 播放器…');
  try{
    await api();if(token!==generation)return;
    player=new YT.Player('playerMount',{videoId:data.video,playerVars:{origin:location.origin,playsinline:1,rel:0},events:{
      onReady:event=>{
        if(token!==generation)return;ready=true;$('playBtn').disabled=false;syncPlaybackRate();
        event.target.getIframe().title='YouTube VOD 播放器';event.target.getIframe().setAttribute('referrerpolicy','strict-origin-when-cross-origin');
        const actual=Math.floor(event.target.getDuration());
        if(actual>0&&actual<=MAX_TIME&&!readOnly){
          const maxEnd=Math.max(0,...data.clips.map(c=>c.end));
          if(actual>=maxEnd){data.duration=actual;$('totalTime').textContent=time(actual);$('seek').max=actual;renderTimeline();persist();}
          else announce('影片實際長度小於部分標註終點，請檢查那些時間段。');
        }
        playerMessage('');
      },
      onStateChange:event=>{if(token!==generation)return;if(event.data!==3){updatePlayButton(event.data===1);syncPlaybackRate();}},
      onPlaybackRateChange:event=>{if(token===generation)syncPlaybackRate(event.data);},
      onError:event=>{
        if(token!==generation)return;ready=false;$('playBtn').disabled=true;updatePlayButton();syncPlaybackRate();
        const messages={2:'影片連結無效。',5:'瀏覽器無法播放這支影片。',100:'影片已移除或設為私人。',101:'頻道主未允許外部嵌入播放。',150:'頻道主未允許外部嵌入播放。',153:'YouTube 未接受這個頁面的播放器識別，請以本機啟動檔或正式網站開啟。'};
        playerMessage(`${messages[event.data]||'YouTube 影片暫時無法播放。'} 你仍可手動標註時間；這不會解除原片的觀看限制。`);
      }
    }});
  }catch(e){if(token===generation)playerMessage(e.message);}
}
function openData(next,{isDemo=false,isReview=false,draftKey=null,importTitle=false}={}){
  data=validate(next);activeDraftKey=draftKey||data.video;demo=isDemo;readOnly=isReview;selected=sorted()[0]?.id||null;editing=null;current=0;stopAt=null;
  $('source').value=`https://www.youtube.com/watch?v=${data.video}`;$('sharePanel').hidden=true;resetEditor();render();mountPlayer({syncTitle:importTitle});persist();
}
function newData(id){return {v:1,video:id,title:'未命名片段擷取',duration:10800,clips:[]};}
$('sourceForm').addEventListener('submit',event=>{
  event.preventDefault();const id=videoId($('source').value);if(!id){announce('請貼上單支 YouTube 影片連結，例如 https://www.youtube.com/watch?v=影片編號。');return;}
  announce('');history.replaceState(null,'',location.pathname+location.search);if(data?.video===id&&!readOnly){mountPlayer({syncTitle:true});return;}
  let next;try{next=validate(cache.records[id]);}catch{next=newData(id);}
  openData(next,{importTitle:true});
});
$('historyBtn').addEventListener('click',()=>{renderHistory();$('historyNotice').hidden=true;$('historyDrawer').showModal();});
$('closeHistory').addEventListener('click',()=>$('historyDrawer').close());
$('historyDrawer').addEventListener('click',event=>{if(event.target===$('historyDrawer')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});
function saveClip({keepEditing=false,automatic=false}={}){
  if(!data||readOnly)return;
  const start=parseTime($('start').value),end=parseTime($('end').value);
  if(!Number.isFinite(start)||!Number.isFinite(end)){error('請輸入有效時間，例如 00:12:34；分和秒須介於 00–59。');return;}
  if(end<=start){error('結束時間必須晚於開始時間。');return;}
  if(end>data.duration){error(`結束時間超過影片總長度 ${time(data.duration)}，請修正時間。`);return;}
  if(!editing&&data.clips.length>=200){error('單份片段擷取最多 200 段，請另外建立一份。');return;}
  const clip={id:editing||uid(),start,end,title:$('clipTitle').value.trim()||`未命名片段 ${data.clips.length+1}`,note:$('note').value.trim()};
  stopAt=null;
  if(editing)data.clips=data.clips.map(c=>c.id===editing?clip:c);else data.clips.push(clip);
  selected=clip.id;
  if(keepEditing)edit(clip,{automatic,focus:false});
  else{resetEditor();renderList();renderTimeline();}
  persist();return clip;
}
$('clipForm').addEventListener('submit',event=>{
  event.preventDefault();if(autoSelection&&editing===autoSelection){resetEditor();return;}saveClip();
});
$('cancelEdit').addEventListener('click',resetEditor);
function mark(id){
  if(!data||readOnly)return;
  if(id==='start'&&autoSelection&&editing===autoSelection)resetEditor();
  $(id).value=time(current);draftMarks[id]=true;error('');paintDraftMarks();$('markFeedback').textContent=`${id==='start'?'起點':'終點'}已設為 ${time(current)}`;
  if(draftMarks.start&&draftMarks.end){
    const wasEditing=!!editing,automatic=!editing||autoSelection===editing;
    if(saveClip({keepEditing:true,automatic}))$('markFeedback').textContent=wasEditing?'片段已更新。':'片段已建立並儲存。';
  }
}
for(const id of ['clipTitle','note'])$(id).addEventListener('input',()=>{
  if(!autoSelection||editing!==autoSelection||readOnly)return;
  const clip=data?.clips.find(c=>c.id===autoSelection);if(!clip)return;
  clip.title=$('clipTitle').value.trim()||'未命名片段';clip.note=$('note').value.trim();renderList();renderTimeline({keepFocus:true});persist();
});
for(const id of ['start','end'])$(id).addEventListener('input',()=>{draftMarks[id]=true;paintDraftMarks();});
$('markStart').addEventListener('click',()=>mark('start'));$('markEnd').addEventListener('click',()=>mark('end'));
document.addEventListener('keydown',e=>{if($('historyDrawer').open||e.ctrlKey||e.metaKey||e.altKey||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;if(e.key.toLowerCase()==='i')mark('start');if(e.key.toLowerCase()==='o')mark('end');});
$('projectTitle').addEventListener('input',()=>{if(!data||readOnly)return;++titleEditRevision;data.title=$('projectTitle').value;$('projectTitle').title=data.title;persist();});
$('playBtn').addEventListener('click',()=>{if(!ready)return;stopAt=null;const playing=$('playBtn').getAttribute('aria-label')==='暫停';updatePlayButton(!playing);playing?player.pauseVideo():player.playVideo();});
$('playbackRate').addEventListener('pointerdown',event=>{
  if(!ready||event.button!==0||!event.isPrimary)return;speedDragging=true;event.currentTarget.setPointerCapture(event.pointerId);
});
$('playbackRate').addEventListener('input',()=>{
  if(!ready||!player)return;const rate=speedRates[Number($('playbackRate').value)];if(!Number.isFinite(rate))return;
  speedPending=rate;showPlaybackRate(rate);player.setPlaybackRate(rate);confirmPlaybackRate();
});
for(const event of ['change','pointerup','pointercancel','lostpointercapture','blur'])$('playbackRate').addEventListener(event,()=>{speedDragging=false;confirmPlaybackRate();});
window.addEventListener('blur',()=>{speedDragging=false;confirmPlaybackRate();});
$('playClipBtn').addEventListener('click',()=>playClip(active()));
function commitScrub(){
  const target=seekSession.commit();if(target===null)return;
  current=target;if(ready){const wasPaused=player.getPlayerState()===2;player.seekTo(target,true);if(!scrubWasPlaying&&!wasPaused)player.pauseVideo();}updateTime();
}
function beginScrub(){
  scrubWasPlaying=ready&&player.getPlayerState()===1;
  seekSession.begin(current);stopAt=null;
}
function cancelScrub(){
  if(!seekSession.dragging)return;
  seekSession.cancel();const actual=ready?player.getCurrentTime():current;
  if(Number.isFinite(actual))current=actual;updateTime();
}
$('seek').addEventListener('input',()=>{
  if(!data)return;
  if(!seekSession.dragging)beginScrub();
  current=Math.max(0,Math.min(data.duration,Number($('seek').value)));stopAt=null;
  seekSession.preview(current);updateTime();
});
$('seek').addEventListener('change',commitScrub);
$('seek').addEventListener('blur',commitScrub);
function previewOverview(x){
  const r=$('overview').getBoundingClientRect();current=timelineTime(x,r.left,r.width,data.duration);seekSession.preview(current);updateTime();
}
$('overview').addEventListener('pointerdown',event=>{
  if(!data||event.button!==0||!event.isPrimary||overviewGesture)return;
  const bar=event.target.closest('.clip-bar');event.preventDefault();$('seek').focus({preventScroll:true});
  overviewGesture={pointerId:event.pointerId,x:event.clientX,bar,dragging:!bar};
  $('overview').setPointerCapture(event.pointerId);
  if(!bar){beginScrub();previewOverview(event.clientX);}
});
$('overview').addEventListener('pointermove',event=>{
  const drag=overviewGesture;if(!drag||drag.pointerId!==event.pointerId)return;
  if(!drag.dragging&&Math.abs(event.clientX-drag.x)>4){drag.dragging=true;beginScrub();}
  if(drag.dragging)previewOverview(event.clientX);
});
function finishOverview(event,cancel=false){
  const drag=overviewGesture;if(!drag||drag.pointerId!==event.pointerId)return;overviewGesture=null;
  suppressOverviewClickUntil=performance.now()+350;
  if(cancel){if(drag.dragging)cancelScrub();}
  else if(drag.dragging){previewOverview(event.clientX);commitScrub();}
  else if(drag.bar)playClip(data?.clips.find(c=>c.id===drag.bar.dataset.clipId));
  if($('overview').hasPointerCapture(event.pointerId))$('overview').releasePointerCapture(event.pointerId);
}
$('overview').addEventListener('pointerup',event=>finishOverview(event));
$('overview').addEventListener('pointercancel',event=>finishOverview(event,true));
$('overview').addEventListener('lostpointercapture',event=>finishOverview(event,true));
window.addEventListener('blur',()=>{if(overviewGesture)finishOverview({pointerId:overviewGesture.pointerId},true);else cancelScrub();});
let dragSession=null,suppressFocusClickUntil=0;
$('focusTimeline').addEventListener('click',e=>{if(!data||!active()||e.target.closest('.trim-handle')||performance.now()<suppressFocusClickUntil)return;const r=$('focusTimeline').getBoundingClientRect();seek(focusBounds[0]+(e.clientX-r.left)/r.width*(focusBounds[1]-focusBounds[0]));});
$('zoom').addEventListener('input',()=>renderTimeline());
for(const [id,delta] of [['zoomOut',-10],['zoomIn',10]])$(id).addEventListener('click',()=>{$('zoom').value=Math.max(0,Math.min(100,Number($('zoom').value)+delta));renderTimeline();});
function applyTrim(c,field,value){
  c[field]=trimEndpoint(c,field,value,data.duration)[field];stopAt=null;
  if(editing===c.id)$(field).value=time(c[field]);
  renderList();renderTimeline({keepFocus:true});
}
function finishTrim(event,cancel=false){
  const drag=dragSession;if(!drag||event.pointerId!==drag.pointerId)return;
  dragSession=null;suppressFocusClickUntil=performance.now()+350;$('focusTimeline').classList.remove('is-trimming');
  if(data===drag.data){const c=data.clips.find(c=>c.id===drag.clipId);if(c){if(cancel)applyTrim(c,drag.field,drag.original);else persist();}}
  if(drag.handle.hasPointerCapture(event.pointerId))drag.handle.releasePointerCapture(event.pointerId);
}
for(const [id,field] of [['startHandle','start'],['endHandle','end']]){
  const handle=$(id);
  handle.addEventListener('click',event=>event.stopPropagation());
  handle.addEventListener('pointerdown',event=>{
    if(readOnly||dragSession||!event.isPrimary||event.button!==0)return;
    const c=active();if(!c)return;event.preventDefault();event.stopPropagation();
    handle.focus({preventScroll:true});
    dragSession={pointerId:event.pointerId,handle,field,clipId:c.id,data,original:c[field],x:event.clientX,width:$('focusTimeline').getBoundingClientRect().width,bounds:[...focusBounds]};
    stopAt=null;handle.setPointerCapture(event.pointerId);$('focusTimeline').classList.add('is-trimming');
  });
  handle.addEventListener('pointermove',event=>{
    const drag=dragSession;if(!drag||event.pointerId!==drag.pointerId||readOnly||data!==drag.data)return;
    const c=data.clips.find(c=>c.id===drag.clipId);if(!c)return;
    const [a,b]=drag.bounds;applyTrim(c,field,Math.max(a,Math.min(b,drag.original+(event.clientX-drag.x)/drag.width*(b-a))));
  });
  handle.addEventListener('pointerup',event=>finishTrim(event));
  handle.addEventListener('pointercancel',event=>finishTrim(event,true));
  handle.addEventListener('lostpointercapture',event=>finishTrim(event,true));
  handle.addEventListener('keydown',event=>{
    if(readOnly||dragSession)return;const c=active();if(!c)return;
    const step=event.shiftKey?10:1;
    const keys={ArrowLeft:c[field]-step,ArrowDown:c[field]-step,ArrowRight:c[field]+step,ArrowUp:c[field]+step,PageDown:c[field]-10,PageUp:c[field]+10,Home:field==='start'?0:c.start+1,End:field==='start'?c.end-1:data.duration};
    if(!(event.key in keys))return;event.preventDefault();event.stopPropagation();applyTrim(c,field,keys[event.key]);
    if(c.start<focusBounds[0]||c.end>focusBounds[1])renderTimeline();persist();
  });
}
new ResizeObserver(()=>{const c=active();if(c)paintFocus(c);paintDraftMarks();}).observe($('focusTimeline'));
$('ownCopy').addEventListener('click',()=>{activeDraftKey=`${data.video}:${uid()}`;readOnly=false;demo=false;history.replaceState(null,'',location.pathname+location.search);resetEditor();render();persist();announce('已建立獨立的影片記錄；原分享連結與既有記錄都不受影響。');});
$('shareBtn').addEventListener('click',()=>{
  if(!data||!data.clips.length)return;
  try{const url=shareURL(data,location.href);$('shareLink').value=url;$('sharePanel').hidden=false;$('localWarning').hidden=!['localhost','127.0.0.1','[::1]'].includes(location.hostname);$('longWarning').hidden=url.length<8000;$('sharePanel').scrollIntoView({behavior:'smooth',block:'nearest'});}
  catch(e){announce(e.message);}
});
$('copyBtn').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText($('shareLink').value);$('copyBtn').textContent='已複製';setTimeout(()=>$('copyBtn').textContent='複製連結',1800);}
  catch{$('shareLink').focus();$('shareLink').select();announce('瀏覽器未允許自動複製。連結已選取，請按 Ctrl+C 複製。');}
});
$('closeShare').addEventListener('click',()=>$('sharePanel').hidden=true);
for(const [id,delta] of [['prevClip',-1],['nextClip',1]])$(id).addEventListener('click',()=>{const clips=sorted();const index=clips.findIndex(c=>c.id===selected);playClip(clips[index+delta]);});
setInterval(()=>{
  if(!ready||!player)return;
  const t=player.getCurrentTime?.();if(!Number.isFinite(t)||!seekSession.accept(t,player.getPlayerState?.()===1,player.getPlaybackRate?.()||1))return;current=t;
  if(stopAt!==null&&current>=stopAt){const endpoint=stopAt;stopAt=null;const clips=sorted(),i=clips.findIndex(c=>c.id===selected);
    if($('autoNext').checked&&clips[i+1])playClip(clips[i+1]);
    else{player.pauseVideo();player.seekTo(endpoint,true);current=endpoint;}
  }
  updateTime();
},160);
function readHash(){
  if(!location.hash.startsWith('#review='))return false;
  try{openData(decode(location.hash.slice(8)),{isReview:true});announce('這是免登入片段擷取版本。點擊任一片段，即可從標註起點觀看。');return true;}
  catch(e){announce(e.message);return false;}
}
window.addEventListener('hashchange',()=>{if(location.hash.startsWith('#review='))readHash();});
readHash();
if(location.protocol==='file:')announce('請使用資料夾內的啟動檔開啟這個網站。直接開啟 HTML 可能使播放器或分享功能無法正常運作。');
