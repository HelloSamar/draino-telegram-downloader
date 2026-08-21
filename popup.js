chrome.tabs.query({active:true,currentWindow:true},([tab])=>{
  const dot=document.getElementById('dot'),msg=document.getElementById('msg');
  if(tab?.url?.startsWith('https://web.telegram.org')){
    msg.innerHTML='<b>Active</b> — hover a video → click ↓';
  } else {
    dot.classList.add('off');
    msg.innerHTML='Open <b>web.telegram.org/k</b> first';
  }
});
