import { FB, firebaseUrl } from './fb.js?v=20260706b';
let CURRENT_EVENT_ID=null;
export function getCurrentEventId(){return CURRENT_EVENT_ID;}
export function setCurrentEventId(id){CURRENT_EVENT_ID=id||null;const u=new URL(location.href);if(id)u.searchParams.set('event',id);else u.searchParams.delete('event');history.replaceState(null,'',u);}
export async function listEvents(){const idx=await FB.get('/events_index')||{};return Object.entries(idx).map(([id,m])=>({id,name:m?.name||'（未命名）',client:m?.client||'',listed:m?.listed!==false})).sort((a,b)=>a.name.localeCompare(b.name));}
export function getFirebaseDebugUrl(path='/events_index'){return firebaseUrl(path);}
export async function createEvent(name,client=''){const id='e'+Math.floor(Date.now()+Math.random()*1e6).toString(36);const meta={name:name||'新活動',client,listed:true};await FB.patch(`/events/${id}/meta`,meta);await FB.put(`/events/${id}/info`,{title:meta.name,client,dateTime:'',venue:'',address:'',mapUrl:'',bus:'',train:'',parking:'',notes:''});await FB.put(`/events/${id}/people`,[]);await FB.put(`/events/${id}/prizes`,[]);await FB.put(`/events/${id}/currentPrizeId`,null);await FB.put(`/events/${id}/questions`,[]);await FB.put(`/events/${id}/photos`,[]);await FB.put(`/events/${id}/logo`,"");await FB.put(`/events/${id}/banner`,"");await FB.put(`/events_index/${id}`,meta);return id;}
export async function upsertEventMeta(id,meta){await FB.patch(`/events/${id}/meta`,meta);await FB.patch(`/events_index/${id}`,meta);}
export async function getEventInfo(id){const [meta,info]=await Promise.all([FB.get(`/events/${id}/meta`),FB.get(`/events/${id}/info`)]);return {meta:meta||{},info:info||{}};}
export async function saveEventInfo(id,info){await FB.patch(`/events/${id}/info`,info||{});}
export async function getPeople(id){return (await FB.get(`/events/${id}/people`))||[];}
export async function setPeople(id,arr){return await FB.put(`/events/${id}/people`,arr||[]);}
export async function getPrizes(id){return (await FB.get(`/events/${id}/prizes`))||[];}
export async function setPrizes(id,arr){return await FB.put(`/events/${id}/prizes`,arr||[]);}
export async function getCurrentPrizeIdRemote(id){return await FB.get(`/events/${id}/currentPrizeId`);}
export async function setCurrentPrizeIdRemote(id,pid){return await FB.put(`/events/${id}/currentPrizeId`,pid||null);}
export async function getQuestions(id){return (await FB.get(`/events/${id}/questions`))||[];}
export async function setQuestions(id,arr){return await FB.put(`/events/${id}/questions`,arr||[]);}
export async function getAssets(id){
  const clean = (v)=> typeof v === 'string'
    ? v.trim()
    : (v && typeof v.url === 'string' ? v.url.trim() : '');

  const [bannerRaw, logoRaw, landingBannerRaw, backgroundRaw, photos, assetSettings] = await Promise.all([
    FB.get(`/events/${id}/banner`),
    FB.get(`/events/${id}/logo`),
    FB.get(`/events/${id}/landingBanner`).catch(() => ''),
    FB.get(`/events/${id}/background`),
    FB.get(`/events/${id}/photos`),
    FB.get(`/events/${id}/assetSettings`)
  ]);

  return {
    banner: clean(bannerRaw),
    logo: clean(logoRaw),
    landingBanner: clean(assetSettings?.landingBanner) || clean(landingBannerRaw),
    background: clean(backgroundRaw),
    photos: Array.isArray(photos) ? photos : [],
    hideLogoOnDraws: assetSettings?.hideLogoOnDraws === true
  };
}

export async function setAssets(id, assets){
  const {
    banner,
    landingBanner,
    logo,
    background,
    photos,
    hideLogoOnDraws
  } = assets || {};

  if (banner !== undefined) {
    await FB.put(`/events/${id}/banner`, banner || '');
  }
  if (logo !== undefined) {
    await FB.put(`/events/${id}/logo`, logo || '');
  }
  if (background !== undefined) {
    await FB.put(`/events/${id}/background`, background || '');
  }

  if (photos !== undefined) {
    await FB.put(`/events/${id}/photos`, photos || []);
  }
  if (landingBanner !== undefined || hideLogoOnDraws !== undefined) {
    const settings = {};
    if (landingBanner !== undefined) settings.landingBanner = landingBanner || '';
    if (hideLogoOnDraws !== undefined) settings.hideLogoOnDraws = hideLogoOnDraws === true;
    await FB.patch(`/events/${id}/assetSettings`, settings);
  }
}

export async function getPolls(id){return (await FB.get(`/events/${id}/polls`))||{};}
export async function setPoll(id,poll){return await FB.put(`/events/${id}/polls/${poll.id}`,poll);}
export async function deleteEvent(id){
  await FB.patch('/', {
    [`/events/${id}`]: null,
    [`/events_index/${id}`]: null
  });
}
