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
  if (!data || data.v !== 1 || typeof data.video !== 'string' || !/^[\w-]{11}$/.test(data.video) || !Number.isInteger(data.duration) || data.duration < 1 || data.duration > MAX_TIME || typeof data.title !== 'string' || data.title.length > 200 || !Array.isArray(data.clips) || data.clips.length > 200) throw Error('標註資料格式不正確，請使用完整的分享連結。');
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
const MAX_SHARE_BYTES=1500000;
function shareBase64(bytes){
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function limitedBytes(stream){
  const reader=stream.getReader(),chunks=[];let size=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>MAX_SHARE_BYTES){await reader.cancel();throw Error('分享資料過大。');}chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const output=new Uint8Array(size);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.byteLength;}return output;
}
export async function encodeShare(data){
  const record=validate(data);
  const packed=[record.video,record.duration,record.title,record.clips.map(c=>[c.start,c.end-c.start,c.title,c.note])];
  const bytes=new TextEncoder().encode(JSON.stringify(packed));
  let encoded='p.'+shareBase64(bytes);
  if(typeof CompressionStream!=='undefined'){
    try{
      const compressed=await limitedBytes(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate')));
      const candidate='z.'+shareBase64(compressed);if(candidate.length<encoded.length)encoded=candidate;
    }catch{}
  }
  if(encoded.length>60000)throw Error('標註內容過長，請減少備註文字或拆成兩份。');
  return encoded;
}
export async function decodeShare(value){
  if(typeof value!=='string')throw Error('分享連結不完整或內容過長。');
  if(!/^[pz]\./.test(value))return decode(value);
  if(value.length>60000||!/^([pz])\.([\w-]+)$/.test(value))throw Error('分享連結不完整或內容過長。');
  try{
    let bytes=Uint8Array.from(atob(value.slice(2).replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    if(value.startsWith('z.'))bytes=await limitedBytes(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')));
    if(bytes.byteLength>MAX_SHARE_BYTES)throw Error('分享資料過大。');
    const packed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!Array.isArray(packed)||packed.length!==4||!Array.isArray(packed[3])||packed[3].length>200)throw Error('分享資料格式無效。');
    const [video,duration,title,rows]=packed;
    const clips=rows.map((row,i)=>{
      if(!Array.isArray(row)||row.length!==4||!Number.isInteger(row[0])||!Number.isInteger(row[1])||row[1]<=0)throw Error('片段格式無效。');
      return {id:`s${i.toString(36)}`,start:row[0],end:row[0]+row[1],title:row[2],note:row[3]};
    });
    return validate({v:1,video,duration,title,clips});
  }catch{throw Error('無法讀取分享標註，請確認連結完整並使用新版瀏覽器。');}
}
export async function compactShareURL(data,base){
  const url=new URL(base);url.search='';url.hash='r='+await encodeShare(data);return url.href;
}
export function reviewPayload(hash){const match=/^#(?:r|review)=(.*)$/.exec(hash);return match?match[1]:null;}
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

export async function shortenURL(longURL,request=fetch){
  const target=new URL(longURL);
  if(target.protocol!=='https:'||target.hostname!=='naiya1222.github.io'||target.pathname!=='/vod-clipper/'||!/^#(?:r|review)=/.test(target.hash))throw Error('只能縮短正式網站的分享連結。');
  const response=await request('https://is.gd/create.php',{method:'POST',body:new URLSearchParams({format:'json',url:target.href}),signal:AbortSignal.timeout(15000),credentials:'omit',referrerPolicy:'no-referrer'});
  const result=await response.json();
  if(!response.ok||result.errorcode||typeof result.shorturl!=='string'||!/^https:\/\/is\.gd\/[A-Za-z0-9_]+$/.test(result.shorturl))throw Error('無法產生短連結。');
  return result.shorturl;
}
