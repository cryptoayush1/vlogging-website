const loginView=document.querySelector('#loginView'), dashboardView=document.querySelector('#dashboardView');
let currentUser=null;
const loginForm=document.querySelector('#loginForm'), loginError=document.querySelector('#loginError');
function esc(str){const d=document.createElement('div');d.textContent=String(str||'');return d.innerHTML;}
async function api(path, options={}){const response=await fetch(path,{credentials:'include',...options});let body;try{body=await response.json()}catch{body={}}if(!response.ok)throw new Error(body.error||response.statusText||'Request failed');return body||{}}
function showDashboard(user){
  currentUser=user||currentUser;
  loginView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  document.querySelector('#accountLabel').textContent=`${currentUser.username} · ${currentUser.role}`;
  checkSetupStatus();
  loadArchive();
  if(currentUser.role==='admin'){
    showAdminTools();
    setupAdminAnalytics();
  } else {
    const tabA=document.querySelector('#tabAnalytics');
    if(tabA)tabA.style.display='none';
  }
}

let analyticsInitialized=false;
let analyticsPollingTimer=null;
let lastAnalyticsRaw='';

function startAnalyticsPolling(){
  stopAnalyticsPolling();
  analyticsPollingTimer=setInterval(async()=>{
    const viewA=document.querySelector('#analyticsView');
    if(viewA && !viewA.classList.contains('hidden') && currentUser && currentUser.role==='admin'){
      await loadAnalytics(true);
    }
  },2000);
}

function stopAnalyticsPolling(){
  if(analyticsPollingTimer){
    clearInterval(analyticsPollingTimer);
    analyticsPollingTimer=null;
  }
}

function setupAdminAnalytics(){
  const tabA=document.querySelector('#tabAnalytics');
  const tabW=document.querySelector('#tabWorkspace');
  const viewW=document.querySelector('#workspaceView');
  const viewA=document.querySelector('#analyticsView');
  const refreshBtn=document.querySelector('#refreshAnalyticsBtn');
  
  if(tabA) tabA.style.display='inline-block';

  if(!analyticsInitialized){
    analyticsInitialized=true;
    if(tabW && tabA && viewW && viewA){
      tabW.addEventListener('click',()=>{
        tabW.classList.add('active');
        tabA.classList.remove('active');
        viewW.classList.remove('hidden');
        viewA.classList.add('hidden');
        stopAnalyticsPolling();
      });
      tabA.addEventListener('click',()=>{
        tabA.classList.add('active');
        tabW.classList.remove('active');
        viewA.classList.remove('hidden');
        viewW.classList.add('hidden');
        loadAnalytics(false);
        startAnalyticsPolling();
      });
    }
    if(refreshBtn){
      refreshBtn.addEventListener('click',()=>loadAnalytics(false));
    }
    const resetBtn = document.querySelector('#resetAnalyticsBtn');
    if(resetBtn){
      resetBtn.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to reset all analytics counters to 0?')) return;
        try {
          await api('/api/admin/analytics/reset', { method: 'POST' });
          await loadAnalytics(false);
        } catch (e) {
          alert('Could not reset analytics: ' + (e.message || 'Error'));
        }
      });
    }
  }
}

async function loadAnalytics(isBackgroundPoll=false){
  const chartsEl=document.querySelector('#vlogChartsContainer');
  const tableEl=document.querySelector('#feedbackTableContainer');
  const countBadge=document.querySelector('#feedbackCountBadge');
  const liveIndicator=document.querySelector('#liveSyncStatus');
  
  try{
    const data=await api('/api/admin/analytics?t='+Date.now());
    const dataString=JSON.stringify(data);
    
    // Heartbeat flash on live indicator
    if(liveIndicator){
      liveIndicator.classList.add('flash');
      setTimeout(()=>liveIndicator.classList.remove('flash'),400);
    }

    // If background polling and data hasn't changed, skip re-rendering to prevent UI jitter
    if(isBackgroundPoll && dataString===lastAnalyticsRaw){
      return;
    }
    lastAnalyticsRaw=dataString;
    
    document.querySelector('#metricViews').textContent=Number(data.total_views||0).toLocaleString();
    document.querySelector('#metricClicks').textContent=Number(data.total_clicks||0).toLocaleString();
    document.querySelector('#metricVisitors').textContent=Number(data.unique_visitors||0).toLocaleString();
    document.querySelector('#metricFeedback').textContent=Number(data.total_feedback||0).toLocaleString();
    if(countBadge){
      const fbTotal=data.total_feedback||0;
      countBadge.textContent=`${fbTotal} ${fbTotal===1?'Reflection':'Reflections'}`;
    }
    
    const vlogs=data.vlogs||[];
    if(!vlogs.length){
      chartsEl.innerHTML='<p class="muted">No published films yet. Once films are published, readership and engagement charts will appear here.</p>';
    } else {
      const maxClicks=Math.max(...vlogs.map(v=>v.clicks||0), 1);
      const maxFeedback=Math.max(...vlogs.map(v=>v.feedback_count||0), 1);
      
      chartsEl.innerHTML=vlogs.map(v=>{
        const clickPercent=Math.min(100,Math.round(((v.clicks||0)/maxClicks)*100));
        const fbPercent=Math.min(100,Math.round(((v.feedback_count||0)/maxFeedback)*100));
        
        return `
          <div class="vlog-chart-item">
            <div class="chart-meta">
              <div>
                <h3>${esc(v.title)}</h3>
                <span class="meta-sub">${esc(v.category)} · By ${esc(v.author)} · ${v.word_count||0} words</span>
              </div>
              <span class="meta-sub" style="font-weight:600;color:var(--ink)">
                ${v.clicks||0} reads · ${v.feedback_count||0} reflections
              </span>
            </div>
            <div class="chart-bars-wrap">
              <div class="chart-bar-row">
                <span class="bar-name">Reads / Clicks</span>
                <div class="bar-track" title="${v.clicks||0} reads">
                  <div class="bar-fill clicks" style="width:${Math.max(clickPercent,2)}%"></div>
                </div>
                <span class="bar-number">${v.clicks||0}</span>
              </div>
              <div class="chart-bar-row">
                <span class="bar-name">Reflections</span>
                <div class="bar-track" title="${v.feedback_count||0} reflections">
                  <div class="bar-fill feedback" style="width:${Math.max(fbPercent,2)}%"></div>
                </div>
                <span class="bar-number">${v.feedback_count||0}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
    
    const feedbackList=data.feedback||[];
    if(!feedbackList.length){
      tableEl.innerHTML='<p class="muted" style="padding:16px 0">No reader reflections submitted yet.</p>';
    } else {
      tableEl.innerHTML=`
        <table class="feedback-table">
          <thead>
            <tr>
              <th>Published Article</th>
              <th>Reader</th>
              <th>Reflection</th>
              <th>Date</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${feedbackList.map(fb=>`
              <tr data-feedback-id="${fb.id}">
                <td>
                  <span class="article-badge" title="${esc(fb.vlog_title)}">
                    ${esc(fb.vlog_title||'Untitled Article')}
                  </span>
                </td>
                <td class="feedback-author-cell">
                  <strong>${esc(fb.author_name)}</strong>
                  <small>${esc(fb.author_email||'No email provided')}</small>
                </td>
                <td class="feedback-comment-cell">
                  ${esc(fb.comment)}
                </td>
                <td style="color:var(--muted);white-space:nowrap;font-size:12px">
                  ${esc(String(fb.created_at||'').split(' ')[0]||'Recent')}
                </td>
                <td>
                  <button type="button" class="delete-feedback-btn" data-id="${fb.id}" title="Delete this feedback">
                    Delete
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      
      tableEl.querySelectorAll('.delete-feedback-btn').forEach(btn=>{
        btn.addEventListener('click',async()=>{
          if(!confirm('Are you sure you want to delete this reader reflection? This cannot be undone.'))return;
          const tr=btn.closest('tr');
          if(tr){
            tr.style.opacity='0.4';
            tr.style.pointerEvents='none';
          }
          btn.textContent='Deleting…';
          try{
            await api(`/api/admin/feedback/${btn.dataset.id}`,{method:'DELETE'});
            await loadAnalytics(false);
          }catch(err){
            alert('Failed to delete feedback: '+err.message);
            if(tr){
              tr.style.opacity='1';
              tr.style.pointerEvents='auto';
            }
            btn.textContent='Delete';
          }
        });
      });
    }
  }catch(err){
    if(!isBackgroundPoll){
      if(chartsEl) chartsEl.innerHTML=`<p class="form-error">Could not load analytics: ${esc(err.message)}</p>`;
      if(tableEl) tableEl.innerHTML=`<p class="form-error">Could not load feedback: ${esc(err.message)}</p>`;
    }
  }
}
async function checkSession(){try{const session=await api('/admin');showDashboard(session.user)}catch{}}
loginForm.addEventListener('submit',async e=>{e.preventDefault();loginError.textContent='';const data=Object.fromEntries(new FormData(loginForm));try{await api('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(result=>showDashboard(result.user))}catch(error){loginError.textContent=error.message}});
document.querySelector('#logoutButton').addEventListener('click',async()=>{await api('/api/admin/logout',{method:'POST'});location.reload()});

const uploadForm=document.querySelector('#uploadForm');
const fileInput=uploadForm.querySelector('input[name="document"]');
const thumbnailInput=uploadForm.querySelector('#thumbnailInput');
const thumbnailPreview=document.querySelector('#thumbnailPreview');
const authorImageInput=uploadForm.querySelector('#authorImageInput');
const authorImagePreview=document.querySelector('#authorImagePreview');
const authorBioInput=uploadForm.querySelector('#authorBioInput');
const authorBioWordCount=document.querySelector('#authorBioWordCount');
const docPreviewContainer=document.querySelector('#docPreviewContainer');
const docPreviewText=document.querySelector('#docPreviewText');
const docPreviewWordCount=document.querySelector('#docPreviewWordCount');

function countWords(str){
  if(!str||!str.trim()) return 0;
  return str.trim().split(/\s+/).length;
}

function updateDocPreviewWordCount(){
  if(!docPreviewText||!docPreviewWordCount) return;
  const count=countWords(docPreviewText.value);
  docPreviewWordCount.textContent=`${count.toLocaleString()} / 6,000 words`;
  if(count>6000){
    docPreviewWordCount.style.color='#b43434';
  } else {
    docPreviewWordCount.style.color='var(--muted)';
  }
}

if(docPreviewText){
  docPreviewText.addEventListener('input',updateDocPreviewWordCount);
}

function updateAuthorBioWordCount(){
  if(!authorBioInput||!authorBioWordCount) return;
  const count=countWords(authorBioInput.value);
  authorBioWordCount.textContent=`${count} / 200 words`;
  if(count>200){
    authorBioWordCount.style.color='#b43434';
  } else {
    authorBioWordCount.style.color='var(--muted)';
  }
}

if(authorBioInput){
  authorBioInput.addEventListener('input',updateAuthorBioWordCount);
}

fileInput.addEventListener('change',async()=>{
  const f=fileInput.files[0];
  const errEl=document.querySelector('#uploadError');
  if(errEl) errEl.textContent='';

  if(!f){
    if(docPreviewContainer) docPreviewContainer.classList.add('hidden');
    if(docPreviewText) docPreviewText.value='';
    if(docPreviewWordCount) docPreviewWordCount.textContent='0 / 6,000 words';
    return;
  }

  // 5 MB file size limit check
  const MAX_DOC_BYTES=5*1024*1024;
  if(f.size>MAX_DOC_BYTES){
    const sizeMb=(f.size/(1024*1024)).toFixed(2);
    if(errEl) errEl.textContent=`Word document exceeds the 5 MB limit (${sizeMb} MB). Please choose a file under 5 MB.`;
    fileInput.value='';
    if(docPreviewContainer) docPreviewContainer.classList.add('hidden');
    if(docPreviewText) docPreviewText.value='';
    if(docPreviewWordCount) docPreviewWordCount.textContent='0 / 6,000 words';
    return;
  }

  if(docPreviewContainer) docPreviewContainer.classList.remove('hidden');
  if(docPreviewText) docPreviewText.value='Parsing document preview…';
  if(docPreviewWordCount) docPreviewWordCount.textContent='Parsing…';

  try{
    const fd=new FormData();
    fd.append('document',f);
    const result=await api('/api/admin/vlogs/preview',{method:'POST',body:fd});
    if(docPreviewText){
      docPreviewText.value=result.body_text||'';
      updateDocPreviewWordCount();
    }
  }catch(err){
    if(errEl) errEl.textContent=err.message;
    if(docPreviewText) docPreviewText.value='';
    if(docPreviewContainer) docPreviewContainer.classList.add('hidden');
  }
});

if(authorImageInput && authorImagePreview){
  authorImageInput.addEventListener('change',()=>{
    const file=authorImageInput.files[0];
    const errEl=document.querySelector('#uploadError');
    if(errEl) errEl.textContent='';

    if(!file){
      authorImagePreview.classList.add('hidden');
      authorImagePreview.innerHTML='';
      return;
    }

    const isImage=file.type==='image/jpeg'||file.type==='image/png'||/\.(jpe?g|png)$/i.test(file.name);
    if(!isImage){
      if(errEl) errEl.textContent='Invalid image format. Only JPEG and PNG images (.jpg, .jpeg, .png) are supported for author pictures.';
      authorImageInput.value='';
      authorImagePreview.classList.add('hidden');
      authorImagePreview.innerHTML='';
      return;
    }

    const MAX_AUTHOR_BYTES=200*1024;
    if(file.size>MAX_AUTHOR_BYTES){
      const sizeKb=(file.size/1024).toFixed(1);
      if(errEl) errEl.textContent=`Author picture size is ${sizeKb} KB. Author picture must be under 200 KB.`;
      authorImageInput.value='';
      authorImagePreview.classList.add('hidden');
      authorImagePreview.innerHTML='';
      return;
    }

    const reader=new FileReader();
    reader.onload=(e)=>{
      const dataUrl=e.target.result;
      const img=new Image();
      img.onload=()=>{
        const sizeKb=(file.size/1024).toFixed(1);
        authorImagePreview.innerHTML=`
          <div class="preview-section">
            <span class="kicker">Author Picture Preview (${sizeKb} KB)</span>
            <div class="author-preview-card">
              <div class="author-preview-avatar" style="background-image:url('${dataUrl}')"></div>
              <div class="author-preview-details">
                <strong>${esc(file.name)}</strong>
                <small>${img.naturalWidth} × ${img.naturalHeight}px · ${sizeKb} KB (under 200 KB limit)</small>
              </div>
              <button type="button" class="author-remove-btn" id="removeAuthorImageBtn">Remove ×</button>
            </div>
          </div>
        `;
        authorImagePreview.classList.remove('hidden');

        const removeBtn=authorImagePreview.querySelector('#removeAuthorImageBtn');
        if(removeBtn){
          removeBtn.addEventListener('click',()=>{
            authorImageInput.value='';
            authorImagePreview.innerHTML='';
            authorImagePreview.classList.add('hidden');
          });
        }
      };
      img.src=dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

if(thumbnailInput && thumbnailPreview){
  thumbnailInput.addEventListener('change',()=>{
    const file=thumbnailInput.files[0];
    const errEl=document.querySelector('#uploadError');
    if(errEl) errEl.textContent='';

    if(!file){
      thumbnailPreview.classList.add('hidden');
      thumbnailPreview.innerHTML='';
      return;
    }

    const isJpeg=file.type==='image/jpeg' || /\.(jpe?g)$/i.test(file.name);
    if(!isJpeg){
      if(errEl) errEl.textContent='Invalid picture format. Only JPEG images (.jpg or .jpeg) are supported.';
      thumbnailInput.value='';
      thumbnailPreview.classList.add('hidden');
      thumbnailPreview.innerHTML='';
      return;
    }

    const MAX_BYTES=250*1024;
    if(file.size>MAX_BYTES){
      const sizeKb=(file.size/1024).toFixed(1);
      if(errEl) errEl.textContent=`Picture size is ${sizeKb} KB. Thumbnail image must be under 250 KB.`;
      thumbnailInput.value='';
      thumbnailPreview.classList.add('hidden');
      thumbnailPreview.innerHTML='';
      return;
    }

    const reader=new FileReader();
    reader.onload=(e)=>{
      const dataUrl=e.target.result;
      const img=new Image();
      img.onload=()=>{
        const sizeKb=(file.size/1024).toFixed(1);
        thumbnailPreview.innerHTML=`
          <div class="preview-section">
            <span class="kicker">Thumbnail Picture Preview (JPEG · ${sizeKb} KB)</span>
            <div class="thumbnail-preview-card">
              <div class="thumbnail-preview-frame" style="background-image:url('${dataUrl}')">
                <span class="thumbnail-preview-badge">Public Site Thumbnail</span>
                <div class="thumbnail-preview-info">
                  <div>
                    <strong>${esc(file.name)}</strong>
                    <small>${img.naturalWidth} × ${img.naturalHeight}px · ${sizeKb} KB (fits &lt; 250 KB limit)</small>
                  </div>
                  <button type="button" class="thumbnail-remove-btn" id="removeThumbnailBtn">Remove ×</button>
                </div>
              </div>
            </div>
          </div>
        `;
        thumbnailPreview.classList.remove('hidden');

        const removeBtn=thumbnailPreview.querySelector('#removeThumbnailBtn');
        if(removeBtn){
          removeBtn.addEventListener('click',()=>{
            thumbnailInput.value='';
            thumbnailPreview.innerHTML='';
            thumbnailPreview.classList.add('hidden');
          });
        }
      };
      img.src=dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

let isPublishing=false;
uploadForm.addEventListener('submit',async e=>{
  e.preventDefault();
  if(isPublishing)return;
  const submitBtn=uploadForm.querySelector('button[type="submit"]');
  const errEl=document.querySelector('#uploadError');
  const succEl=document.querySelector('#uploadSuccess');
  errEl.textContent='';
  succEl.textContent='';

  if(authorBioInput){
    const bioWords=countWords(authorBioInput.value);
    if(bioWords>200){
      errEl.textContent=`Author bio exceeds the 200-word limit (${bioWords} words).`;
      return;
    }
  }

  if(docPreviewText && docPreviewText.value){
    const previewWords=countWords(docPreviewText.value);
    if(previewWords>6000){
      errEl.textContent=`Document text exceeds the 6,000-word limit (${previewWords.toLocaleString()} words).`;
      return;
    }
  }

  isPublishing=true;
  if(submitBtn){submitBtn.disabled=true;submitBtn.style.opacity='0.6';submitBtn.innerHTML='Publishing to journal… <span>⏳</span>';}
  try{
    const result=await api('/api/admin/vlogs',{method:'POST',body:new FormData(uploadForm)});
    succEl.textContent='Published successfully — '+result.word_count+' words'+(result.thumbnail_filename?' with custom thumbnail.':'.');
    uploadForm.reset();
    if(docPreviewContainer){
      docPreviewContainer.classList.add('hidden');
      if(docPreviewText) docPreviewText.value='';
      if(docPreviewWordCount) docPreviewWordCount.textContent='0 / 6,000 words';
    }
    if(authorBioWordCount) authorBioWordCount.textContent='0 / 200 words';
    if(authorImagePreview){
      authorImagePreview.innerHTML='';
      authorImagePreview.classList.add('hidden');
    }
    if(thumbnailPreview){
      thumbnailPreview.innerHTML='';
      thumbnailPreview.classList.add('hidden');
    }
    loadArchive();
  }catch(error){
    errEl.textContent=error.message;
  }finally{
    isPublishing=false;
    if(submitBtn){submitBtn.disabled=false;submitBtn.style.opacity='1';submitBtn.innerHTML='Publish to journal <span>↗</span>';}
  }
});

let lastArchiveRaw='';
async function loadArchive(isPoll=false){
  try{
    const items=await api('/api/vlogs?t='+Date.now());
    const rawCheck=JSON.stringify(items);
    if(isPoll && rawCheck===lastArchiveRaw) return;
    lastArchiveRaw=rawCheck;

    document.querySelector('#vlogCount').textContent=items.length;
    const list=document.querySelector('#recentList');
    list.innerHTML=items.length?items.map(v=>`<div class="recent-item"><strong>${esc(v.title)}</strong><small>${esc(v.category)} · ${esc(v.author)} · ${v.word_count} words${v.thumbnail_filename?' · 🖼️ Custom JPEG':''}${v.author_image_filename?' · 👤 Author Picture':''}</small><button class="delete-btn" data-id="${v.id}" title="Delete vlog">×</button></div>`).join(''):'<p class="muted">No uploaded films yet.</p>';
    document.querySelectorAll('.delete-btn').forEach(btn=>btn.addEventListener('click',async()=>{
      if(!confirm('Delete this vlog? This cannot be undone.'))return;
      try{await api(`/api/admin/vlogs/${btn.dataset.id}`,{method:'DELETE'});loadArchive(false);}catch(err){alert(err.message);}
    }));
  }catch(error){console.error(error);}
}

// Auto-sync studio archive every 1 second
setInterval(()=>{
  const viewW=document.querySelector('#workspaceView');
  if(viewW && !viewW.classList.contains('hidden') && currentUser){
    loadArchive(true);
  }
},1000);

async function showAdminTools(){
  if(document.querySelector('#accessPanel'))return;
  const panel=document.createElement('section');
  panel.className='panel';
  panel.id='accessPanel';
  panel.innerHTML=`<div class="panel-title"><div><p class="kicker">Access control</p><h2>Co-admin accounts</h2></div></div><form id="coadminForm"><div class="two-col"><label>New ID<input name="username" minlength="3" required></label><label>Gmail / Email<input name="email" type="email" placeholder="coadmin@gmail.com" required></label></div><label>Password<input name="password" type="password" minlength="8" required></label><button class="primary" type="submit">Register co-admin <span>↗</span></button></form><p class="form-error" id="accessError"></p><p class="form-success" id="accessSuccess"></p><div id="usersList"></div>`;
  document.querySelector('.workspace').prepend(panel);
  document.querySelector('#coadminForm').addEventListener('submit',registerUser);
  loadUsers();
}

async function registerUser(e){
  e.preventDefault();
  const err=document.querySelector('#accessError'),succ=document.querySelector('#accessSuccess');
  if(err)err.textContent='';
  if(succ)succ.textContent='';
  try{
    const res=await api('/api/admin/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
    e.target.reset();
    if(succ)succ.textContent=`Co-admin ${res.username} registered. Credentials sent to ${res.email}.`;
    loadUsers();
  }catch(error){if(err)err.textContent=error.message;}
}

async function loadUsers(){
  const users=await api('/api/admin/users');
  document.querySelector('#usersList').innerHTML=users.filter(u=>u.role==='coadmin').map(u=>`<div class="recent-item"><strong>${esc(u.username)}</strong> <small style="display:inline;color:var(--muted)">(${esc(u.email||'no email')})</small><small>${u.active?'Active':'Suspended'} · <button data-user="${u.id}" data-active="${u.active?0:1}" class="access-toggle">${u.active?'Suspend':'Restore'}</button>${!u.active?' <button data-user="'+u.id+'" class="delete-user-btn" title="Delete co-admin">×</button>':''}</small></div>`).join('')||'<p class="muted">No co-admin accounts yet.</p>';
  document.querySelectorAll('.access-toggle').forEach(button=>button.addEventListener('click',async()=>{
    await api('/api/admin/users/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:button.dataset.user,active:button.dataset.active==='1'})});
    loadUsers();
  }));
  document.querySelectorAll('.delete-user-btn').forEach(button=>button.addEventListener('click',async()=>{
    if(!confirm('Delete this co-admin? Their vlogs will be reassigned to admin. This cannot be undone.'))return;
    try{await api(`/api/admin/users/${button.dataset.user}`,{method:'DELETE'});loadUsers();}catch(err){alert(err.message);}
  }));
}

async function checkSetupStatus(){
  try{
    const res=await api('/api/admin/setup-status');
    const isTurso = res && res.database === 'turso';
    const statusDot=document.querySelector('#studioStatusDot');
    if(statusDot){
      statusDot.textContent=isTurso ? '● Studio online · Turso Cloud DB' : '● Studio online';
      statusDot.title=isTurso ? 'Connected to Turso Cloud SQLite. Data persists permanently across restarts.' : 'Local SQLite';
    }
    const loginBadge=document.querySelector('#loginDbBadge');
    const registerBadge=document.querySelector('#registerDbBadge');
    const badgeText = isTurso ? '● Connected to Turso Cloud DB (Persistent)' : '● Connecting database…';
    const badgeColor = isTurso ? '#5c751f' : 'var(--muted)';
    if(loginBadge){ loginBadge.textContent=badgeText; loginBadge.style.color=badgeColor; }
    if(registerBadge){ registerBadge.textContent=badgeText; registerBadge.style.color=badgeColor; }
    const roleSelect=document.querySelector('#roleSelect');
    const optAdmin=document.querySelector('#optAdmin');
    const optCoadmin=document.querySelector('#optCoadmin');
    const registerMuted=document.querySelector('#registerMuted');
    if(res && res.has_admin){
      if(optAdmin){ optAdmin.disabled=true; optAdmin.style.display='none'; }
      if(optCoadmin){ optCoadmin.selected=true; }
      if(roleSelect){ roleSelect.value='coadmin'; }
      if(registerMuted){ registerMuted.textContent='An administrator is already registered. You are creating a Co-admin account.'; }
    }else{
      if(optAdmin){ optAdmin.disabled=false; optAdmin.style.display=''; optAdmin.selected=true; }
      if(roleSelect){ roleSelect.value='admin'; }
      if(registerMuted){ registerMuted.textContent='Initial setup: Creating the Primary Administrator account.'; }
    }
  }catch(err){}
}

document.querySelector('#registerButton').addEventListener('click',()=>{
  checkSetupStatus();
  loginView.classList.add('hidden');
  document.querySelector('#registerView').classList.remove('hidden');
});
document.querySelector('#backToLogin').addEventListener('click',()=>{document.querySelector('#registerView').classList.add('hidden');loginView.classList.remove('hidden');});
document.querySelector('#registerForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const error=document.querySelector('#registerError');
  error.textContent='';
  try{
    const registrationData=Object.fromEntries(new FormData(e.target));
    const result=await api('/api/admin/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(registrationData)});
    alert(`Registration complete for ${result.username}. Credentials sent to ${result.email}. You can now log in.`);
    e.target.reset();
    document.querySelector('#registerView').classList.add('hidden');
    loginView.classList.remove('hidden');
    checkSetupStatus();
  }catch(err){error.textContent=err.message;}
});

checkSession();
checkSetupStatus();
