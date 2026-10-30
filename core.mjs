export const MAX_TIME = 7 * 86400;
export function videoId(value) {
  try {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    let id;
    if (host === 'youtu.be') id = url.pathname.split('/')[1];
    else if (['youtube.com','m.youtube.com','youtube-nocookie.com'].includes(host)) {
      id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:live|shorts|embed)\/([^/]+)/.exec(url.pathname)?.[1];
    }
    return /^[\w-]{11}$/.test(id || '') ? id : null;
  } catch { return null; }
}
export function parseTime(value) {
  const text = String(value).trim();
  if (!/^\d+(?::\d{1,2}){0,2}$/.test(text)) return NaN;
  const parts = text.split(':').map(Number);
  if (parts.slice(1).some(n => n >= 60)) return NaN;
  const seconds = parts.reduce((a,n) => a * 60 + n, 0);
  return seconds <= MAX_TIME ? seconds : NaN;
}
export function time(value) {
  const n = Math.max(0, Math.floor(Number(value) || 0));
  return [Math.floor(n/3600), Math.floor(n/60)%60, n%60].map(x=>String(x).padStart(2,'0')).join(':');
}
export function validate(data) {
  if (!data || data.v !== 1 || !/^[\w-]{11}$/.test(data.video || '') || !Number.isInteger(data.duration) || data.duration < 1 || data.duration > MAX_TIME || typeof data.title !== 'string' || data.title.length > 200 || !Array.isArray(data.clips) || data.clips.length > 200) throw Error('標註資料格式不正確，請使用完整的分享連結。');
  const ids = new Set();
  for (const clip of data.clips) {
    if (typeof clip.id !== 'string' || clip.id.length > 80 || ids.has(clip.id) || !Number.isInteger(clip.start) || !Number.isInteger(clip.end) || clip.start < 0 || clip.end <= clip.start || clip.end > data.duration || typeof clip.title !== 'string' || clip.title.length > 120 || typeof clip.note !== 'string' || clip.note.length > 1000) throw Error('片段時間或文字無效，請重新取得分享連結。');
    ids.add(clip.id);
  }
  return {v:1,video:data.video,duration:data.duration,title:data.title,clips:data.clips.map(({id,start,end,title,note})=>({id,start,end,title,note}))};
}
export function encode(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(validate(data)));
  const encoded = btoa(Array.from(bytes,x=>String.fromCharCode(x)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  if (encoded.length > 60000) throw Error('標註內容過長，請減少備註文字或拆成兩份。');
  return encoded;
}
export function decode(value) {
  if (typeof value !== 'string' || value.length > 60000 || !/^[\w-]+$/.test(value)) throw Error('分享連結不完整或內容過長。');
  try { return validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))))); }
  catch { throw Error('無法讀取分享標註，請向剪輯師索取完整連結。'); }
}
export function shareURL(data, base) { const url = new URL(base); url.search = ''; url.hash = 'review=' + encode(data); return url.href; }
export function trimEndpoint(clip,field,value,duration) {
  if(!['start','end'].includes(field)||!Number.isFinite(value))throw Error('無效的片段端點');
  const min=field==='start'?0:clip.start+1;
  const max=field==='start'?clip.end-1:duration;
  return {...clip,[field]:Math.max(min,Math.min(max,Math.round(value)))};
}
export function createSeekSession({now=()=>performance.now(),settleMs=3000}={}) {
  let dragging=false,pending=false,target=null,committedAt=0;
  return {
    get dragging(){return dragging;},
    begin(seconds){dragging=true;pending=false;target=seconds;},
    preview(seconds){
      if(!dragging)this.begin(seconds);
      target=seconds;
    },
    request(seconds){dragging=false;pending=true;target=seconds;committedAt=now();},
    commit(){if(!dragging)return null;this.request(target);return target;},
    accept(actual,playing=false,playbackRate=1){
      if(dragging)return false;
      if(pending){
        const elapsed=now()-committedAt;
        const rate=Number.isFinite(playbackRate)&&playbackRate>0?playbackRate:1;
        const tolerance=.35+(playing?elapsed/1000*rate:0);
        // Paused embeds can keep reporting the pre-seek position. Preserve the
        // selected target until acknowledgement; playing has a bounded fallback.
        if((!playing||elapsed<settleMs)&&(elapsed<160||Math.abs(actual-target)>tolerance))return false;
        pending=false;
      }
      return true;
    },
    cancel(){dragging=false;pending=false;target=null;}
  };
}
export function timelineTime(x,left,width,duration){
  if(![x,left,width,duration].every(Number.isFinite)||width<=0||duration<=0)return 0;
  return Math.round(Math.max(0,Math.min(1,(x-left)/width))*duration*10)/10;
}
export function saveRecord(cache,key,record,updatedAt=Date.now()){
  return {...cache,last:key,records:{...cache.records,[key]:validate(record)},updated:{...cache.updated,[key]:updatedAt}};
}
export function deleteRecord(cache,key){
  const records={...cache.records},updated={...cache.updated};delete records[key];delete updated[key];
  return {...cache,records,updated,last:cache.last===key?(Object.keys(records).at(-1)||null):cache.last};
}
