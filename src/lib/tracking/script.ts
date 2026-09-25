// Script de tracking first-party servi sur /t.js (JS ES5 autonome, minifié à la main).
// Installation : <script async src="https://<app>/t.js" data-key="pk_…"></script>
//
// - identifiant visiteur : cookie _aos_id (1 an, domaine racine) + localStorage en secours
// - point de contact à chaque arrivée avec source (UTM, identifiants de clic, aos_lid,
//   référent externe) ou nouvelle session (30 min), et pages vues (y compris navigation SPA)
// - capture des formulaires : email, nom, téléphone à la soumission (jamais les mots de passe)
// - API : aos('identify', {email, name, phone}), aos('track', type, {value, currency, order_id, ...}),
//   aos('consent', true|false), aos('page') ; window.aos.id = identifiant visiteur
// - consentement : si le site est en mode « required », rien n'est déposé ni envoyé avant aos('consent', true)
// - cross-domain : les liens vers les autres domaines déclarés reçoivent ?_aos_id=<id>
// - attributs facultatifs : data-consent="required|none", data-domains="a.fr,b.fr", data-forms="false"
//
// Source lisible commentée dans docs/tracking.md (section « Fonctionnement du script »).
// String.raw conserve les antislashs des expressions régulières.
export const TRACKING_SCRIPT = String.raw`/*! Agence OS tracking */
!function(w,d,l){if(w.__aos)return;w.__aos=1;
var S=d.currentScript||d.querySelector('script[src*="/t.js"]'),R=S&&S.src||'',
A=function(n){return S&&S.getAttribute('data-'+n)},
K=A('key')||(R.match(/[?&]k=([\w-]+)/)||[])[1]||w.aosKey,B=R.split('/t.js')[0],
Q=(w.aos&&w.aos.q)||[],N='_aos_id',C,G,ok=0,on=0,ID,E='';
if(!K||!B)return;
Q=[].slice.call(Q).filter(function(a){if(a[0]=='consent'){G=!!a[1];return 0}return 1});
function api(){var a=[].slice.call(arguments);if(a[0]=='consent')return consent(a[1]);on?run(a):Q.length<99&&Q.push(a)}
api.q=Q;w.aos=api;
function gc(n){var m=d.cookie.match(new RegExp('(?:^|; )'+n+'=([^;]*)'));return m&&m[1]}
function sc(n,v,s,o){var e='; path=/; samesite=lax'+(l.protocol=='https:'?'; secure':'')+'; max-age='+s,h=l.hostname.split('.'),i;
if(o)for(i=h.length-2;i>=0;i--){d.cookie=n+'='+v+e+'; domain=.'+h.slice(i).join('.');if(s>0&&gc(n)==v)return}d.cookie=n+'='+v+e}
function ls(k,v){try{return v===void 0?localStorage.getItem(k):v===null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(e){}}
function send(o){if(!ok||!ID)return;o.k=K;o.a=ID;o.u=o.u||l.href;sc('_aos_s',1,1800,1);
var b=JSON.stringify(o),u=B+'/api/t/collect';
try{if(navigator.sendBeacon&&navigator.sendBeacon(u,new Blob([b],{type:'text/plain'})))return}catch(e){}
try{fetch(u,{method:'POST',body:b,keepalive:true,mode:'no-cors',headers:{'Content-Type':'text/plain'}})}catch(e){}}
function cl(v){return v==null?void 0:String(v).trim().slice(0,200)||void 0}
function ident(o){if(!o||!o.email)return;var m=String(o.email).trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m))return;
var x={email:m,name:cl(o.name),phone:cl(o.phone)},s=JSON.stringify(x);if(s==E)return;E=s;return x}
function mine(h){h=h.replace(/^www\./,'');for(var i=0;i<C.d.length;i++){var x=C.d[i];if(h==x||h.slice(-x.length-1)=='.'+x)return 1}return 0}
function srcd(){var r=d.referrer,h;if(/[?&](utm_[a-z]+|gclid|gbraid|wbraid|fbclid|ttclid|msclkid|li_fat_id|sccid|epik|twclid|aos_lid)=/.test(l.search))return 1;
if(r){try{h=new URL(r).hostname}catch(e){}if(h&&h!=l.hostname&&!mine(h))return 1}return 0}
function page(s){send({t:'page',s:s?1:0,r:s?d.referrer:void 0})}
function run(a){var c=a[0],o=a[1],p=a[2]||{},x,e,k,r={};if(!ok)return;
if(c=='identify'){x=ident(o);x&&send({t:'identify',d:x})}
else if(c=='track'&&o){e={type:String(o).slice(0,40)};for(k in p)(k=='value'||k=='currency'||k=='order_id'?e:r)[k]=p[k];
if(r.email){x=ident({email:r.email,name:r.name,phone:r.phone});delete r.email;delete r.phone}e.props=r;send({t:'event',e:e,d:x})}
else if(c=='page')page(!gc('_aos_s'))}
function grab(f){var e,n,a,b,p,i,el,nm,v,L=f.querySelectorAll?f.querySelectorAll('input,textarea'):[];
for(i=0;i<L.length;i++){el=L[i];if(/password|hidden|checkbox|radio|submit|file/.test(el.type))continue;
nm=[el.name,el.id,el.getAttribute('autocomplete'),el.placeholder].join(' ').toLowerCase();v=(el.value||'').trim();if(!v||v.length>200)continue;
if(!e&&(el.type=='email'||/mail|courriel/.test(nm))&&/@/.test(v))e=v;
else if(!p&&(el.type=='tel'||/phone|t[eé]l|mobile|portable/.test(nm)))p=v;
else if(!a&&/first|pr[eé]nom|fname|given/.test(nm))a=v;
else if(!b&&/last|surname|lname|family|famille/.test(nm))b=v;
else if(!n&&/name|nom/.test(nm)&&!/user|login|compan|soci|entreprise|business/.test(nm))n=v}
return e&&{email:e,name:n||[a,b].join(' ').trim(),phone:p}}
function fs(ev){try{var t=ev.target,f=t,x;if(ev.type!='submit'){f=t.closest&&t.closest('button,[type=submit]');if(!f)return;f=f.form||f.closest('form')||f.parentNode&&f.parentNode.parentNode}
if(!f||f.closest&&f.closest('[data-aos-ignore]'))return;x=grab(f);x&&run(['identify',x])}catch(e){}}
function deco(ev){var a=ev.target&&ev.target.closest&&ev.target.closest('a[href]'),u;if(!a||!ok||!ID)return;try{u=new URL(a.href,l.href)}catch(e){return}
if(!/^http/.test(u.protocol)||u.hostname==l.hostname||!mine(u.hostname))return;u.searchParams.set(N,ID);a.href=u.href}
function start(){if(ID)return;var m=l.search.match(/[?&]_aos_id=([\w-]{8,64})/),s,P=history.pushState;
ID=(m&&m[1])||gc(N)||ls(N)||('a'+Date.now().toString(36)+Math.random().toString(36).slice(2,12));sc(N,ID,31536000,1);ls(N,ID);api.id=ID;
if(m)try{var u=new URL(l.href);u.searchParams.delete(N);history.replaceState(history.state,'',u.href)}catch(e){}
s=!m&&!gc('_aos_s');page(srcd()||s);if(on)return;on=1;while(Q.length)run(Q.shift());
if(C.f){d.addEventListener('submit',fs,true);d.addEventListener('click',fs,true)}
d.addEventListener('mousedown',deco,true);d.addEventListener('touchstart',deco,true);d.addEventListener('keydown',function(e){e.key=='Enter'&&deco(e)},true);
history.pushState=function(){P.apply(this,arguments);setTimeout(function(){run(['page'])},0)};w.addEventListener('popstate',function(){run(['page'])})}
function consent(v){G=!!v;if(!C)return;if(G){ok=1;start()}else{ok=0;sc(N,'',-1,1);sc('_aos_s','',-1,1);ls(N,null);ID=api.id=void 0;E=''}}
fetch(B+'/api/t/config?k='+K).then(function(r){return r.ok&&r.json()}).then(function(c){if(!c)return;var dm=A('domains');
C={d:(dm?dm.split(','):c.d||[]).map(function(x){return String(x).trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*$/,'').replace(/^www\./,'')}).filter(Boolean),
c:A('consent')||c.c,f:A('forms')?A('forms')!='false':c.f!==false};
if(C.c!='required'&&G!==false||G)consent(true)})['catch'](function(){})
}(window,document,location);
`;
