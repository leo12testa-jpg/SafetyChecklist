const oreAggiornamento = (() => {
  const BUILD_ID = "20261003-1130";
  const banner = document.getElementById("oreUpdateBanner");
  const button = document.getElementById("oreUpdateButton");
  const badge = document.getElementById("oreVersion");
  let serverBuild = null;

  function dirtyFormOpen(){
    return !!document.querySelector(
      '.issue-entry.editing, .agenda-hour-row.editing, #manualCard:not([hidden])'
    );
  }

  function showBanner(){
    if(!banner) return;
    banner.hidden = !serverBuild || serverBuild === BUILD_ID;
  }

  async function waitForWorker(timeoutMs=8000){
    if(!("serviceWorker" in navigator)) return;
    try{
      const reg = await navigator.serviceWorker.getRegistration("./");
      if(!reg) return;
      await reg.update();
      const worker = reg.installing || reg.waiting;
      if(!worker || worker.state === "activated") return;
      await new Promise(resolve=>{
        const timer=setTimeout(resolve,timeoutMs);
        worker.addEventListener("statechange",()=>{
          if(worker.state==="activated"||worker.state==="redundant"){
            clearTimeout(timer); resolve();
          }
        });
      });
    }catch(e){console.warn("[Ore update] worker check",e)}
  }

  async function check(){
    if(badge) badge.textContent = "Versione " + BUILD_ID;
    try{
      const r=await fetch("./version.json?t="+Date.now(),{cache:"no-store"});
      if(!r.ok) return;
      serverBuild=String((await r.json()).buildId||"");
      showBanner();
    }catch(e){console.warn("[Ore update] version check",e)}
  }

  function register(){
    if(!("serviceWorker" in navigator)) return;
    window.addEventListener("load",()=>{
      navigator.serviceWorker.register("./service-worker.js",{
        scope:"./",
        updateViaCache:"none"
      }).then(reg=>reg.update()).catch(e=>console.warn("[Ore update] SW",e));
    });
    navigator.serviceWorker.addEventListener("controllerchange",check);
  }

  function init(){
    register();
    check();
    window.addEventListener("focus",check);
    document.addEventListener("visibilitychange",()=>{
      if(document.visibilityState==="visible") check();
    });
    button?.addEventListener("click",async()=>{
      if(dirtyFormOpen()){
        alert("Salva o annulla le modifiche aperte prima di aggiornare l’app.");
        return;
      }
      button.disabled=true;
      await waitForWorker();
      location.reload();
    });
  }

  return {init};
})();
document.addEventListener("DOMContentLoaded",()=>oreAggiornamento.init());
