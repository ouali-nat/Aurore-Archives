(function(){
  const TAB_ID='diagnostic-aurora';
  const tabBtn=document.querySelector('.admin-tab[data-tab="'+TAB_ID+'"]');
  const panel=document.querySelector('.admin-tab-panel[data-panel="'+TAB_ID+'"]');
  if(!tabBtn||!panel)return;

  const TESTS=[
    {id:'interface',label:'Interface Aurora'},
    {id:'session',label:'Session utilisateur'},
    {id:'token',label:'Token Supabase'},
    {id:'endpoint',label:'Endpoint Edge Function'},
    {id:'cors',label:'CORS / transport HTTP'},
    {id:'edgeauth',label:'Authentification Edge Function'},
    {id:'reception',label:'Réception de la requête'},
    {id:'deepseek',label:'DeepSeek API'},
    {id:'deepseek_resp',label:'Réponse DeepSeek'},
    {id:'edge_resp',label:'Réponse Edge Function'},
    {id:'json',label:'Parsing JSON'},
    {id:'affichage',label:'Affichage Aurora'}
  ];
  const IDS_CIRCUIT=['endpoint','cors','edgeauth','reception','deepseek','deepseek_resp','edge_resp','json','affichage'];
  const ICONS={ok:'🟢',warn:'🟡',fail:'🔴',pending:'⚪'};
  const MESSAGE_BONJOUR='Bonjour, réponds uniquement : Aurora opérationnelle.';
  const MESSAGE_DEEPSEEK_TEST='Réponds uniquement : TEST AURORA OK';
  const echapper=(typeof echapperHtmlPub==='function')?echapperHtmlPub:function(s){
    const d=document.createElement('div');d.textContent=String(s==null?'':s);return d.innerHTML;
  };

  let etats={};
  let diagnosticId=null;
  let journal=[];

  function estAdmin(){return !!(typeof session!=='undefined'&&session&&session.role==='admin');}

  function heureFr(){return new Date().toLocaleTimeString('fr-FR',{hour12:false});}

  function genererDiagnosticId(){
    const d=new Date();
    const pad=n=>String(n).padStart(2,'0');
    const horod=d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'-'+pad(d.getHours())+pad(d.getMinutes())+pad(d.getSeconds());
    const rnd=Array.from({length:4},()=>'0123456789ABCDEF'[Math.floor(Math.random()*16)]).join('');
    return 'AUR-'+horod+'-'+rnd;
  }

  function logEtape(texte){
    journal.push(heureFr()+' — '+texte);
    const el=document.getElementById('diagLog');
    if(el)el.textContent=journal.join('\n');
  }

  // ---------- Capture/affichage de l'exception brute (ajout ciblé) ----------

  function heureFrMs(){
    const d=new Date();
    const pad=(n,l)=>String(n).padStart(l||2,'0');
    return pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())+'.'+pad(d.getMilliseconds(),3);
  }

  function logEtapeMs(texte){
    journal.push(heureFrMs()+' — '+texte);
    const el=document.getElementById('diagLog');
    if(el)el.textContent=journal.join('\n');
  }

  function ajouterBlocJournal(bloc){
    journal.push(bloc);
    const el=document.getElementById('diagLog');
    if(el)el.textContent=journal.join('\n');
  }

  // Lit l'exception brute réellement reçue par le navigateur (déposée par
  // invokeAuroreIA sur e.rawBrowserError) sans jamais la remplacer par une
  // interprétation ("réseau"/"DNS"/"CORS") non prouvée.
  function formaterExceptionBrute(e){
    const info=(e&&e.rawBrowserError)||null;
    if(!info){
      return {
        nom:'non fourni',
        message:String((e&&e.message)!=null?e.message:(e!=null?e:'inconnue')),
        constructeur:'non fourni',
        code:'non fourni',
        causeTxt:'non fournie',
        stack:''
      };
    }
    return {
      nom:info.name||'non fourni',
      message:info.message||'',
      constructeur:info.constructorName||'non fourni',
      code:(info.code!=null&&info.code!=='')?String(info.code):'non fourni',
      causeTxt:info.causeName?(info.causeName+(info.causeMessage?(' — '+info.causeMessage):'')):'non fournie',
      stack:info.stack||''
    };
  }

  function construireDetailExceptionBrute(ex){
    let txt='Erreur brute du navigateur\n\n'
      +'Nom :\n'+ex.nom+'\n\n'
      +'Message :\n'+ex.message+'\n\n'
      +'Constructeur :\n'+ex.constructeur+'\n\n'
      +'Code :\n'+ex.code+'\n\n'
      +'Cause :\n'+ex.causeTxt+'\n\n'
      +'HTTP :\nAucune réponse\n\n'
      +'Classification :\nTransport interrompu avant réception d’une réponse HTTP\n\n'
      +'Confiance :\nIndéterminée';
    if(ex.stack)txt+='\n\n— Détail technique (pile d’appel navigateur) —\n'+ex.stack;
    return txt;
  }

  function construirePreuveTechnique(p){
    return 'PREUVE TECHNIQUE\n\n'
      +'Session :\n'+p.session+'\n\n'
      +'Token :\n'+p.token+'\n\n'
      +'OPTIONS :\n'+p.options+'\n\n'
      +'POST :\n'+p.post+'\n\n'
      +'HTTP :\n'+p.http+'\n\n'
      +'Exception :\n'+p.exception+'\n\n'
      +'DeepSeek :\n'+p.deepseek+'\n\n'
      +'Conclusion :\n'+p.conclusion;
  }

  function maskToken(t){
    if(!t)return '—';
    if(t.length<12)return '********';
    return '********'+t.slice(-4);
  }

  function decodeJwtPayload(t){
    try{
      const partie=t.split('.')[1];
      const b64=partie.replace(/-/g,'+').replace(/_/g,'/');
      const pad=b64.length%4?'='.repeat(4-(b64.length%4)):'';
      const json=decodeURIComponent(atob(b64+pad).split('').map(c=>'%'+('00'+c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      return JSON.parse(json);
    }catch(_){return null;}
  }

  function avecTimeout(promesse,ms,texte){
    return Promise.race([promesse,new Promise((_,rej)=>setTimeout(()=>rej(new Error(texte||'TIMEOUT')),ms))]);
  }

  function setRow(id,state,dureeMs,msg,detail){
    etats[id]={state,duree:(dureeMs!=null?dureeMs+' ms':'—'),heure:heureFr(),msg:msg||'',detail:detail||''};
    render();
  }

  function resetRows(){
    etats={};
    TESTS.forEach(t=>{etats[t.id]={state:'pending',duree:'—',heure:'—',msg:'Non testé',detail:''};});
    render();
  }

  function render(){
    const box=document.getElementById('diagRows');
    if(!box)return;
    box.innerHTML=TESTS.map(t=>{
      const e=etats[t.id]||{state:'pending',duree:'—',heure:'—',msg:'Non testé',detail:''};
      const detailId='diagDetail_'+t.id;
      let html='<div class="diag-row" data-state="'+e.state+'">'
        +'<div class="diag-row-top">'
          +'<span class="diag-row-icon">'+ICONS[e.state]+'</span>'
          +'<span class="diag-row-name">'+echapper(t.label)+'</span>'
          +'<span class="diag-row-duration">'+echapper(e.duree)+'</span>'
          +'<span class="diag-row-time">'+echapper(e.heure)+'</span>'
        +'</div>'
        +'<div class="diag-row-msg">'+echapper(e.msg)+'</div>';
      if(e.detail){
        html+='<button type="button" class="diag-row-detail-toggle" data-detail-toggle="'+detailId+'">Détail ›</button>'
          +'<pre class="diag-row-detail" id="'+detailId+'">'+echapper(e.detail)+'</pre>';
      }
      html+='</div>';
      return html;
    }).join('');
    box.querySelectorAll('[data-detail-toggle]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const d=document.getElementById(btn.getAttribute('data-detail-toggle'));
        if(d)d.classList.toggle('open');
      });
    });
    updateGlobalBadge();
  }

  function updateGlobalBadge(){
    const badge=document.getElementById('diagGlobalBadge');
    if(!badge)return;
    const states=TESTS.map(t=>(etats[t.id]||{}).state||'pending');
    let global='pending',label='⚪ Non testé';
    if(states.every(s=>s==='pending')){global='pending';label='⚪ Non testé';}
    else if(states.some(s=>s==='fail')){global='fail';label='🔴 Bloqué';}
    else if(states.some(s=>s==='warn')||states.some(s=>s==='pending')){global='warn';label='🟡 Dégradé';}
    else{global='ok';label='🟢 Fonctionnel';}
    badge.dataset.state=global;
    badge.textContent=label;
  }

  function setMsg(txt,cls){
    const el=document.getElementById('diagRunMsg');
    if(!el)return;
    el.style.display='block';
    el.textContent=txt;
    el.className='form-msg'+(cls?(' '+cls):'');
  }

  function afficherId(){
    const el=document.getElementById('diagId');
    if(!el)return;
    const endpoint=(typeof SUPABASE_URL!=='undefined'?SUPABASE_URL:'?')+'/functions/v1/aurora-deepseek-live';
    el.textContent='Identifiant : '+diagnosticId+' — connexion : '+(navigator.onLine?'en ligne':'hors-ligne')+' — endpoint : '+endpoint;
  }

  function marquerNonTestable(ids,motif){
    ids.forEach(id=>setRow(id,'pending',null,motif||'Non testé — étape précédente en échec ou non exécutée.'));
  }

  // ---------- Étapes 1 à 3 : gratuites, sans appel DeepSeek ----------

  async function testerInterface(){
    const debut=Date.now();
    const okFn=typeof window.invokeAuroreIA==='function';
    const okDom=!!document.getElementById('screen-aurore-ia');
    const duree=Date.now()-debut;
    if(okFn&&okDom){
      setRow('interface','ok',duree,'Interface et fonctions Aurora présentes dans la page.');
      logEtape('Interface Aurora détectée');
      return true;
    }
    setRow('interface','fail',duree,'Fonctions/écran Aurora introuvables.', 'invokeAuroreIA exposé : '+okFn+' — écran #screen-aurore-ia présent : '+okDom);
    logEtape('Échec — interface Aurora introuvable');
    return false;
  }

  async function testerSession(){
    const debut=Date.now();
    try{
      const client=await avecTimeout((async()=>{
        if(typeof assurerClientAuthGoogle==='function')return await assurerClientAuthGoogle();
        return (typeof AURORE_SUPABASE_AUTH!=='undefined')?AURORE_SUPABASE_AUTH:null;
      })(),5000,'TIMEOUT_CLIENT');
      if(!client)throw new Error('Client Supabase indisponible.');
      const {data,error}=await avecTimeout(client.auth.getSession(),5000,'TIMEOUT_SESSION');
      const duree=Date.now()-debut;
      if(error)throw error;
      if(!data||!data.session){
        setRow('session','fail',duree,'Aucune session Supabase active (utilisateur non authentifié côté Auth).');
        logEtape('Échec — aucune session Supabase active');
        return null;
      }
      setRow('session','ok',duree,'Session trouvée, utilisateur authentifié auprès de Supabase Auth.');
      logEtape('Session détectée');
      return data.session;
    }catch(e){
      const duree=Date.now()-debut;
      const brut=String((e&&e.message)||e);
      const msg=/TIMEOUT/.test(brut)?'Délai dépassé (5 s) lors de la vérification de session.':('Erreur de session : '+brut);
      setRow('session','fail',duree,msg);
      logEtape('Échec session — '+msg);
      return null;
    }
  }

  async function testerToken(sessionSupabase){
    const debut=Date.now();
    const token=(sessionSupabase&&sessionSupabase.access_token)||'';
    const duree=Date.now()-debut;
    if(!token){
      setRow('token','fail',duree,'Aucun jeton présent dans la session.');
      logEtape('Échec — jeton absent');
      return null;
    }
    const payload=decodeJwtPayload(token);
    const exp=(payload&&payload.exp)?new Date(payload.exp*1000):null;
    const valide=exp?(exp.getTime()>Date.now()):null;
    const msg='Token présent : oui — Token valide : '+(valide==null?'inconnu':(valide?'oui':'non'))+' — Token aperçu : '+maskToken(token);
    const detail='Expiration approximative : '+(exp?exp.toLocaleString('fr-FR'):'inconnue')+'\n(Le jeton complet n’est jamais affiché.)';
    setRow('token',valide===false?'fail':'ok',duree,msg,detail);
    logEtape(valide===false?'Échec — jeton expiré':'Jeton présent et exploitable');
    return token;
  }

  // ---------- Étapes 4 à 12 : un seul appel réel au circuit de production ----------
  // Réutilise window.invokeAuroreIA (même endpoint, mêmes paramètres qu'Aurora
  // en production) : aucune logique séparée n'est créée pour ce diagnostic.

  async function executerCircuit(message){
    IDS_CIRCUIT.forEach(id=>setRow(id,'pending',null,'En cours…'));
    logEtape('Requête Edge Function envoyée');
    if(typeof window.invokeAuroreIA!=='function'){
      IDS_CIRCUIT.forEach(id=>setRow(id,'fail',null,'invokeAuroreIA indisponible dans cette page.'));
      logEtape('Échec — invokeAuroreIA introuvable');
      return {ok:false,conclusion:'PROBLEME_NAVIGATEUR'};
    }
    const debut=Date.now();
    try{
      const data=await window.invokeAuroreIA(message);
      const duree=Date.now()-debut;
      logEtape('HTTP 200 reçu');
      setRow('endpoint','ok',duree,'Edge Function jointe.');
      setRow('cors','ok',duree,'Transport HTTP réussi, aucune erreur CORS.');
      setRow('edgeauth','ok',duree,'Jeton accepté par l’Edge Function.');
      setRow('reception','ok',duree,'Requête reçue et traitée par l’Edge Function.');
      const dureeDeepseek=(data&&data.elapsedMs!=null)?data.elapsedMs:duree;
      setRow('deepseek','ok',dureeDeepseek,'Réponse reçue de DeepSeek.'+(data&&data.model?(' Modèle : '+data.model):''));
      logEtape('DeepSeek répondu');
      const usage=data&&data.usage;
      const usageTxt=(usage&&(usage.total_tokens||usage.prompt_tokens||usage.completion_tokens))
        ?('Tokens — prompt : '+(usage.prompt_tokens==null?'—':usage.prompt_tokens)+', complétion : '+(usage.completion_tokens==null?'—':usage.completion_tokens)+', total : '+(usage.total_tokens==null?'—':usage.total_tokens))
        :'Réponse reçue — consommation non fournie par l’API';
      setRow('deepseek_resp','ok',null,usageTxt);
      setRow('edge_resp','ok',null,'route : '+((data&&data.route)||'—')+' — source : '+((data&&data.source)||'—')+' — finishReason : '+((data&&data.finishReason)||'—'));
      logEtape('JSON analysé');
      setRow('json','ok',null,'Réponse JSON valide.');
      const texte=(data&&typeof data.text==='string')?data.text.trim():'';
      const placeholderSuspect=/@@AURORAMATH|@@AURORA_MATH|\[MATH\]/i.test(texte);
      if(texte&&!placeholderSuspect){
        setRow('affichage','ok',null,'Réponse affichable : « '+texte.slice(0,80)+(texte.length>80?'…':'')+' »');
      }else{
        setRow('affichage','fail',null,'Réponse vide ou contenant un repère de formatage non résolu.');
      }
      logEtape('Diagnostic terminé');
      {
        const sessionEtat=(etats.session&&etats.session.state==='ok')?'OK':'non confirmé lors de cet appel';
        const tokenEtat=(etats.token&&etats.token.state==='ok')?'OK':'non confirmé lors de cet appel';
        ajouterBlocJournal(construirePreuveTechnique({
          session:sessionEtat,
          token:tokenEtat,
          options:'Non observable côté JavaScript (préflight CORS géré par le navigateur, invisible au code).',
          post:'Réponse HTTP reçue',
          http:'HTTP 200',
          exception:'Aucune',
          deepseek:'Atteint — réponse reçue'+(data&&data.model?(' (modèle : '+data.model+')'):''),
          conclusion:'Le circuit complet (navigateur → Supabase → Edge Function → DeepSeek → navigateur) a répondu de bout en bout pour cet appel.'
        }));
      }
      return {ok:true,conclusion:'CIRCUIT_COMPLET',data};
    }catch(e){
      const duree=Date.now()-debut;
      const brut=String((e&&e.message)||e);
      logEtape('Échec du circuit');
      logEtape(brut);
      const resultat=analyserEchecCircuit(brut,duree,e);
      {
        const sessionEtat=(etats.session&&etats.session.state==='ok')?'OK':'non confirmé lors de cet appel';
        const tokenEtat=(etats.token&&etats.token.state==='ok')?'OK':'non confirmé lors de cet appel';
        const reponseRecue=!!(e&&e.responseReceived);
        const httpTxt=reponseRecue?('HTTP '+(e.httpStatus!=null?e.httpStatus:'inconnu (voir détail ci-dessus)')):'Aucune réponse HTTP';
        let exceptionTxt='Aucune (une réponse HTTP a été reçue — voir détail ci-dessus)';
        if(!reponseRecue){
          const ex=formaterExceptionBrute(e);
          exceptionTxt=ex.nom+': '+ex.message;
        }
        ajouterBlocJournal(construirePreuveTechnique({
          session:sessionEtat,
          token:tokenEtat,
          options:'Non observable côté JavaScript (préflight CORS géré par le navigateur, invisible au code).',
          post:reponseRecue?'Réponse HTTP reçue':'Exception levée avant réception d’une réponse HTTP',
          http:httpTxt,
          exception:exceptionTxt,
          deepseek:reponseRecue?'Voir détail ci-dessus (réponse HTTP reçue).':'Non atteint — le POST n’a pas atteint l’Edge Function.',
          conclusion:reponseRecue
            ?'Une réponse HTTP a été reçue de l’Edge Function ; voir le détail ci-dessus pour la cause exacte.'
            :'Les tests échouent avant réception d’une réponse HTTP. Aucune preuve suffisante pour affirmer qu’il s’agit de CORS, de DNS ou du réseau.'
        }));
      }
      return resultat;
    }
  }

  function analyserEchecCircuit(brut,duree,e){
    // Session/jeton indisponible AVANT même l'envoi réseau (vérifié côté navigateur
    // par invokeAuroreIA lui-même, avant le fetch()).
    if(/Session Aurora absente|Connectez-vous à Aurore|espace sécurisé|trop de temps à répondre/i.test(brut)){
      setRow('endpoint','fail',duree,'Requête non envoyée : session/jeton indisponible côté navigateur.',brut);
      marquerNonTestable(IDS_CIRCUIT.slice(1));
      return {ok:false,conclusion:'PROBLEME_AUTH'};
    }
    // Échec avant toute réponse HTTP (fetch() a levé une exception). On affiche
    // ici l'exception brute réellement reçue (e.rawBrowserError), jamais une
    // interprétation ("réseau"/"DNS"/"CORS") qui ne serait pas prouvée.
    if(/Impossible de joindre Aurora/i.test(brut)){
      const ex=formaterExceptionBrute(e);
      const detailBrut=construireDetailExceptionBrute(ex);
      setRow('endpoint','fail',duree,'La requête n’a pas atteint l’Edge Function — aucune réponse HTTP reçue.',detailBrut);
      setRow('cors','fail',duree,'Aucune preuve suffisante pour désigner spécifiquement CORS, DNS ou le réseau — voir « Détail technique » ci-dessus pour l’exception brute exacte.');
      marquerNonTestable(IDS_CIRCUIT.slice(2));
      logEtapeMs('POST Edge Function terminé avec exception');
      logEtapeMs('error.name = '+ex.nom);
      logEtapeMs('error.message = '+ex.message);
      logEtapeMs('HTTP = aucune réponse');
      return {ok:false,conclusion:'PROBLEME_NAVIGATEUR'};
    }
    // Timeout côté navigateur en attendant la réponse (AbortController, 70 s) :
    // c'est aussi une exception avant réception d'une réponse HTTP (CAS 1),
    // on affiche donc l'exception brute plutôt que de supposer que DeepSeek a répondu.
    if(/n[’']a pas reçu la réponse de DeepSeek/i.test(brut)){
      const ex=formaterExceptionBrute(e);
      const detailBrut=construireDetailExceptionBrute(ex);
      setRow('endpoint','warn',duree,'Aucune réponse HTTP reçue avant l’abandon (70 s) — impossible de confirmer que la requête a atteint l’Edge Function.',detailBrut);
      setRow('cors','warn',duree,'Non déterminable : aucune réponse HTTP reçue avant l’abandon.');
      setRow('deepseek','fail',duree,'Délai dépassé côté navigateur en attendant la réponse (AbortError, 70 s).');
      marquerNonTestable(IDS_CIRCUIT.slice(5));
      logEtapeMs('POST Edge Function terminé avec exception');
      logEtapeMs('error.name = '+ex.nom);
      logEtapeMs('error.message = '+ex.message);
      logEtapeMs('HTTP = aucune réponse');
      return {ok:false,conclusion:'PROBLEME_DEEPSEEK'};
    }
    // Réponse HTTP reçue mais texte illisible (response.text() a échoué).
    if(/réponse illisible/i.test(brut)){
      setRow('endpoint','ok',duree,'Edge Function jointe.');
      setRow('cors','ok',duree,'Transport HTTP réussi.');
      setRow('edgeauth','ok',duree,'Jeton accepté (réponse HTTP reçue).');
      setRow('reception','ok',duree,'Requête traitée par l’Edge Function.');
      setRow('deepseek','warn',duree,'Étape non déterminable — réponse HTTP reçue mais illisible.');
      setRow('deepseek_resp','warn',duree,'Corps de réponse illisible.');
      setRow('edge_resp','fail',duree,'Impossible de lire le corps de la réponse Edge Function.',brut);
      marquerNonTestable(IDS_CIRCUIT.slice(8));
      return {ok:false,conclusion:'PROBLEME_EDGE_FUNCTION'};
    }
    // JSON.parse() a échoué côté navigateur.
    const mHttpSeul=brut.match(/\(HTTP (\d+)\)/);
    if(/réponse invalide/i.test(brut)){
      setRow('endpoint','ok',duree,'Edge Function jointe.');
      setRow('cors','ok',duree,'Transport HTTP réussi.');
      setRow('edgeauth','ok',duree,'Jeton accepté (réponse HTTP reçue).');
      setRow('reception','ok',duree,'Requête traitée par l’Edge Function.');
      setRow('deepseek','warn',duree,'Non déterminable — réponse HTTP reçue mais JSON invalide.');
      setRow('deepseek_resp','warn',duree,'Non déterminable.');
      setRow('edge_resp','warn',duree,'HTTP '+(mHttpSeul?mHttpSeul[1]:'inconnu')+' reçu, contenu non-JSON.');
      setRow('json','fail',duree,'Échec de l’analyse JSON de la réponse.',brut);
      marquerNonTestable(IDS_CIRCUIT.slice(8));
      return {ok:false,conclusion:'PROBLEME_EDGE_FUNCTION'};
    }
    // Réponse structurée { ok:false, stage, error, ... } réellement renvoyée par
    // aurora-deepseek-live (voir invokeAuroreIA : "[stage] erreur (HTTP xxx) — diagnostic DeepSeek : ...").
    const mStage=brut.match(/^\[([a-z_]+)\]\s*([\s\S]*)$/i);
    if(mStage){
      const stage=mStage[1];
      const reste=mStage[2];
      const mHttp=reste.match(/\(HTTP (\d+)\)/);
      const httpCode=mHttp?mHttp[1]:null;
      const mProbe=reste.match(/diagnostic DeepSeek : ([\s\S]+)$/);
      const probe=mProbe?mProbe[1]:null;

      setRow('endpoint','ok',duree,'Edge Function jointe.');
      setRow('cors','ok',duree,'Transport HTTP réussi, réponse reçue.');

      if(stage==='supabase_auth'){
        setRow('edgeauth','fail',duree,'Session rejetée par l’Edge Function'+(httpCode?(' (HTTP '+httpCode+')'):'')+'.',reste);
        marquerNonTestable(IDS_CIRCUIT.slice(3));
        return {ok:false,conclusion:'PROBLEME_AUTH'};
      }
      if(stage==='supabase_config'){
        setRow('edgeauth','fail',duree,'Configuration Supabase interne absente côté Edge Function.',reste);
        marquerNonTestable(IDS_CIRCUIT.slice(3));
        return {ok:false,conclusion:'PROBLEME_EDGE_FUNCTION'};
      }
      setRow('edgeauth','ok',duree,'Jeton accepté par l’Edge Function.');
      setRow('reception','ok',duree,'Requête reçue et traitée par l’Edge Function.');

      if(stage==='secret'){
        setRow('deepseek','fail',duree,'Clé DeepSeek absente des secrets Supabase.',reste);
        marquerNonTestable(IDS_CIRCUIT.slice(5));
        return {ok:false,conclusion:'PROBLEME_EDGE_FUNCTION'};
      }
      if(stage==='deepseek_generation'){
        setRow('deepseek','fail',duree,'Connexion à DeepSeek impossible ou expirée.'+(probe?(' Sonde /models : '+probe):''),reste);
        marquerNonTestable(IDS_CIRCUIT.slice(5));
        return {ok:false,conclusion:'PROBLEME_DEEPSEEK'};
      }
      if(stage==='deepseek_response'){
        setRow('deepseek','ok',duree,'DeepSeek a répondu'+(httpCode?(' (HTTP '+httpCode+')'):'')+'.');
        setRow('deepseek_resp','fail',duree,'Lecture ou contenu de la réponse DeepSeek en échec.',reste);
        marquerNonTestable(IDS_CIRCUIT.slice(6));
        return {ok:false,conclusion:'PROBLEME_DEEPSEEK'};
      }
      setRow('reception','fail',duree,'Erreur interne de l’Edge Function (étape « '+stage+' »).',reste);
      marquerNonTestable(IDS_CIRCUIT.slice(4));
      return {ok:false,conclusion:'PROBLEME_EDGE_FUNCTION'};
    }
    // Cas non reconnu : le message technique réel est conservé sans être
    // réinterprété à tort (voir consigne « ne plus tout réduire à un message générique »).
    setRow('endpoint','warn',duree,'Réponse reçue mais non reconnue par le diagnostic — voir le journal.',brut);
    marquerNonTestable(IDS_CIRCUIT.slice(1));
    return {ok:false,conclusion:'INDETERMINE'};
  }

  const LABELS_CONCLUSION={
    PROBLEME_NAVIGATEUR:'🔴 PROBLÈME NAVIGATEUR — le navigateur n’arrive pas à joindre l’Edge Function.',
    PROBLEME_AUTH:'🔴 PROBLÈME AUTH — la session existe mais le jeton n’est pas accepté (ou absent).',
    PROBLEME_EDGE_FUNCTION:'🔴 PROBLÈME EDGE FUNCTION — la fonction reçoit la requête mais échoue avant DeepSeek.',
    PROBLEME_DEEPSEEK:'🔴 PROBLÈME DEEPSEEK — la fonction fonctionne mais DeepSeek ne répond pas correctement.',
    CIRCUIT_COMPLET:'🟢 CIRCUIT COMPLET — navigateur → Supabase → Edge Function → DeepSeek → réponse → navigateur : OK.',
    PARTIEL:'🟡 Diagnostic partiel — circuit DeepSeek non testé (confirmation refusée).',
    INDETERMINE:'🟡 Résultat non reconnu automatiquement — voir le journal technique pour le message exact.'
  };

  function finaliser(conclusion){
    setMsg(LABELS_CONCLUSION[conclusion]||'Diagnostic terminé.',
      conclusion==='CIRCUIT_COMPLET'?'ok':((conclusion==='PARTIEL'||conclusion==='INDETERMINE')?'':'err'));
    logEtape('Diagnostic terminé');
  }

  async function lancerDiagnosticComplet(){
    if(!estAdmin())return;
    diagnosticId=genererDiagnosticId();
    journal=[];
    resetRows();
    afficherId();
    logEtape('Diagnostic démarré ('+diagnosticId+')');
    setMsg('Diagnostic en cours…','');

    await testerInterface();
    const sess=await testerSession();
    if(!sess){marquerNonTestable(['token'].concat(IDS_CIRCUIT));finaliser('PROBLEME_AUTH');return;}
    const token=await testerToken(sess);
    if(!token){marquerNonTestable(IDS_CIRCUIT);finaliser('PROBLEME_AUTH');return;}

    const confirme=window.confirm('Le diagnostic va maintenant appeler réellement Aurora → Supabase → DeepSeek pour tester tout le circuit.\nCela consomme de vrais tokens DeepSeek.\n\nContinuer ?');
    if(!confirme){
      marquerNonTestable(IDS_CIRCUIT,'Non testé — confirmation refusée par l’administrateur.');
      logEtape('Circuit DeepSeek non testé (confirmation refusée)');
      finaliser('PARTIEL');
      return;
    }
    const resultat=await executerCircuit(MESSAGE_DEEPSEEK_TEST);
    finaliser(resultat.conclusion);
  }

  async function lancerTestBonjour(){
    if(!estAdmin())return;
    const confirme=window.confirm('Envoyer un vrai message à Aurora (« '+MESSAGE_BONJOUR+' ») ?\nCeci utilise le circuit réel et consomme un vrai appel DeepSeek.');
    if(!confirme)return;
    if(!diagnosticId){diagnosticId=genererDiagnosticId();}
    afficherId();
    logEtape('Test Aurora réel lancé');
    setMsg('Test en cours…','');
    const sess=await testerSession();
    if(sess)await testerToken(sess);
    const resultat=await executerCircuit(MESSAGE_BONJOUR);
    finaliser(resultat.conclusion);
  }

  async function lancerTestDeepseekSeul(){
    if(!estAdmin())return;
    const confirme=window.confirm('Lancer un appel de test dédié à DeepSeek via l’Edge Function réelle ?\nCeci consomme de vrais tokens DeepSeek.');
    if(!confirme)return;
    if(!diagnosticId){diagnosticId=genererDiagnosticId();}
    afficherId();
    logEtape('Test DeepSeek (dédié) lancé');
    setMsg('Test en cours…','');
    const resultat=await executerCircuit(MESSAGE_DEEPSEEK_TEST);
    finaliser(resultat.conclusion);
  }

  document.getElementById('diagRunFull')?.addEventListener('click',lancerDiagnosticComplet);
  document.getElementById('diagRunBonjour')?.addEventListener('click',lancerTestBonjour);
  document.getElementById('diagRunDeepseek')?.addEventListener('click',lancerTestDeepseekSeul);
  document.getElementById('diagToggleLog')?.addEventListener('click',()=>{
    const box=document.getElementById('diagLogBox');
    if(box)box.style.display=(box.style.display==='none'?'block':'none');
  });
  document.getElementById('diagCopyLog')?.addEventListener('click',()=>{
    const txt=journal.join('\n');
    if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(txt).catch(()=>{});
  });

  resetRows();
})();

