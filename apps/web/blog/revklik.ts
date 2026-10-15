// What the Revklik tag may report, and the filter that enforces it.
//
// The tag (klikapa.js) has no route exclusion and rides in every HTML page as a
// script of its own. A filter that lives in the app bundle only works when the
// bundle runs, and runs first: when the bundle was stale, failed to load, or
// threw during import, the tag reported /makan and /beranda by itself. So the
// filter is plain JS inlined in <head> right before the tag (analyticsTag in
// render.ts), and nothing in the bundle needs to cooperate.
//
// Pageviews and events pass only on the marketing funnel (landing, pricing,
// sign-up, payment, privacy, blog) and the public community pages (/u/<handle>
// profiles, /p/<id> posts). In-app screens (Beranda, Makan, ...) are not
// tracked. Conversions (`t: "c"`: onboarding_complete, founder_purchase) pass
// wherever they fire.
export const TRACKED_PATHS = /^\/(?:$|harga|login|pembayaran|privasi|blog|u\/|p\/)/;

// /gabung/<kode> is a capability link: whoever holds the code can join the
// group. /gabung pageviews are dropped by TRACKED_PATHS; this also covers the
// pieces that survive (conversions fired on that page, /login?redirect=... and
// referrers that carry it, plain or URL-encoded) by cutting the code out of
// anything that leaves the page.
export const INVITE_PATH = /(\/|%2F)gabung(?:\/|%2F)[A-Za-z0-9]+/gi;

/**
 * Wraps window.fetch, the one place the tag's batches leave the page (flush,
 * including its keepalive flush on unload and the heartbeat on page hide, is a
 * fetch to `/api/track`). Batches are cut down to what the policy allows and
 * a batch left empty never reaches the network. Anything that is not a
 * parseable track batch goes through untouched.
 */
export const REVKLIK_GUARD = `(()=>{
const TRACKED=${TRACKED_PATHS};
const INVITE=${INVITE_PATH};
const original=window.fetch;
if(typeof original!=="function")return;
const isTrack=(input)=>{
try{
const u=new URL(typeof input==="string"?input:input.url||input.href,location.href);
return u.pathname==="/api/track"&&(u.hostname==="revklik.com"||u.hostname.endsWith(".revklik.com"));
}catch(e){return false}
};
window.fetch=function(input,init){
if(!input||!init||typeof init.body!=="string"||!isTrack(input))return original.apply(window,arguments);
let batch;
try{batch=JSON.parse(init.body)}catch(e){return original.apply(window,arguments)}
if(!Array.isArray(batch))return original.apply(window,arguments);
const kept=batch.filter((item)=>item&&(item.t==="c"||TRACKED.test(String(item.p==null?"":item.p))));
if(!kept.length)return Promise.resolve(new Response("{}",{headers:{"Content-Type":"application/json"}}));
return original.call(window,input,Object.assign({},init,{body:JSON.stringify(kept).replace(INVITE,"$1gabung")}));
};
})();`;
