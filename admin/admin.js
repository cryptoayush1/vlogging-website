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

    const periodSwitcher = document.querySelector('#periodSwitcher');
    if(periodSwitcher){
      periodSwitcher.querySelectorAll('.period-btn').forEach(btn=>{
        btn.addEventListener('click',()=>{
          periodSwitcher.querySelectorAll('.period-btn').forEach(b=>b.classList.remove('active'));
          btn.classList.add('active');
          selectedPeriod = btn.dataset.period || 'all_time';
          updateActivePeriodKPIs();
        });
      });
    }

    const scaleSwitcher = document.querySelector('#trendScaleSwitcher');
    if(scaleSwitcher){
      scaleSwitcher.querySelectorAll('.period-btn').forEach(btn=>{
        btn.addEventListener('click',()=>{
          scaleSwitcher.querySelectorAll('.period-btn').forEach(b=>b.classList.remove('active'));
          btn.classList.add('active');
          selectedTrendScale = btn.dataset.scale || 'daily';
          renderTrendChart();
        });
      });
    }

    const resetBtn = document.querySelector('#resetAnalyticsBtn');
    if(resetBtn){
      resetBtn.addEventListener('click', async () => {
        const input = prompt('WARNING: This will permanently reset all analytics page views, clicks, and visitor counters to 0.\n\nType RESET in capital letters to confirm:');
        if (input !== 'RESET') {
          if (input !== null) alert('Action cancelled — you must type "RESET" exactly to reset metrics.');
          return;
        }
        try {
          resetBtn.disabled = true;
          resetBtn.textContent = 'Resetting…';
          await api('/api/admin/analytics/reset', { method: 'POST' });
          await loadAnalytics(false);
          alert('Analytics metrics have been reset to 0.');
        } catch (e) {
          alert('Could not reset analytics: ' + (e.message || 'Error'));
        } finally {
          resetBtn.disabled = false;
          resetBtn.textContent = '↺ Reset metrics to 0';
        }
      });
    }
  }
}

let currentAnalyticsData = null;
let selectedPeriod = 'all_time';
let selectedTrendScale = 'daily';

function updateActivePeriodKPIs(){
  if(!currentAnalyticsData) return;
  const reps = currentAnalyticsData.reports || {};
  let target = reps.all_time || {};
  let label = 'All-Time';

  if(selectedPeriod === 'weekly'){
    target = reps.weekly || {};
    label = 'Weekly (Last 7 Days)';
  } else if(selectedPeriod === 'monthly'){
    target = reps.monthly || {};
    label = 'Monthly (Last 30 Days)';
  } else if(selectedPeriod === 'yearly'){
    target = reps.yearly || {};
    label = 'Yearly (Last 365 Days)';
  }

  const vEl = document.querySelector('#metricViews');
  const cEl = document.querySelector('#metricClicks');
  const visEl = document.querySelector('#metricVisitors');
  const fEl = document.querySelector('#metricFeedback');
  const badge = document.querySelector('#activePeriodBadge');

  if(vEl) vEl.textContent = Number(target.views || 0).toLocaleString();
  if(cEl) cEl.textContent = Number(target.clicks || 0).toLocaleString();
  if(visEl) visEl.textContent = Number(target.visitors || 0).toLocaleString();
  if(fEl) fEl.textContent = Number(target.feedback || 0).toLocaleString();
  if(badge) badge.textContent = `Viewing: ${label}`;
}

function renderTrendChart(){
  const container = document.querySelector('#trendChartContainer');
  const sub = document.querySelector('#trendSubtitle');
  if(!container || !currentAnalyticsData) return;
  const reps = currentAnalyticsData.reports || {};

  if(selectedTrendScale === 'daily'){
    if(sub) sub.textContent = 'Daily traffic distribution over the last 7 days';
    const items = reps.daily_trend || [];
    if(!items.length){
      container.innerHTML = '<p class="muted" style="font-size:12px;padding:12px 0">No daily traffic recorded in the past 7 days yet.</p>';
      return;
    }
    const maxVal = Math.max(...items.map(d => d.views || 0), ...items.map(d => d.clicks || 0), 1);
    container.innerHTML = `
      <div class="trend-bars-list" style="display:flex;flex-direction:column;gap:12px;">
        ${items.map(d => {
          const vPct = Math.min(100, Math.round(((d.views || 0) / maxVal) * 100));
          const cPct = Math.min(100, Math.round(((d.clicks || 0) / maxVal) * 100));
          return `
            <div style="display:grid;grid-template-columns:90px 1fr 140px;align-items:center;gap:14px;font-size:12px;">
              <strong style="color:var(--ink)">${esc(d.day)}</strong>
              <div style="display:flex;flex-direction:column;gap:4px;">
                <div style="background:#e0e2db;height:7px;border-radius:4px;overflow:hidden;" title="${d.views || 0} views">
                  <div style="background:var(--ink);height:100%;width:${Math.max(vPct, 2)}%;border-radius:4px;"></div>
                </div>
                <div style="background:#e0e2db;height:7px;border-radius:4px;overflow:hidden;" title="${d.clicks || 0} clicks">
                  <div style="background:#747c31;height:100%;width:${Math.max(cPct, 2)}%;border-radius:4px;"></div>
                </div>
              </div>
              <span style="font-size:11px;color:var(--muted);text-align:right">
                <b>${d.views || 0}</b> views · <span style="color:#747c31"><b>${d.clicks || 0}</b> reads</span>
              </span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } else {
    if(sub) sub.textContent = 'Month-by-month traffic distribution over the last 12 months';
    const items = reps.monthly_trend || [];
    if(!items.length){
      container.innerHTML = '<p class="muted" style="font-size:12px;padding:12px 0">No monthly traffic recorded in the past 12 months yet.</p>';
      return;
    }
    const maxVal = Math.max(...items.map(d => d.views || 0), ...items.map(d => d.clicks || 0), 1);
    container.innerHTML = `
      <div class="trend-bars-list" style="display:flex;flex-direction:column;gap:12px;">
        ${items.map(m => {
          const vPct = Math.min(100, Math.round(((m.views || 0) / maxVal) * 100));
          const cPct = Math.min(100, Math.round(((m.clicks || 0) / maxVal) * 100));
          return `
            <div style="display:grid;grid-template-columns:90px 1fr 140px;align-items:center;gap:14px;font-size:12px;">
              <strong style="color:var(--ink)">${esc(m.month)}</strong>
              <div style="display:flex;flex-direction:column;gap:4px;">
                <div style="background:#e0e2db;height:7px;border-radius:4px;overflow:hidden;" title="${m.views || 0} views">
                  <div style="background:var(--ink);height:100%;width:${Math.max(vPct, 2)}%;border-radius:4px;"></div>
                </div>
                <div style="background:#e0e2db;height:7px;border-radius:4px;overflow:hidden;" title="${m.clicks || 0} clicks">
                  <div style="background:#747c31;height:100%;width:${Math.max(cPct, 2)}%;border-radius:4px;"></div>
                </div>
              </div>
              <span style="font-size:11px;color:var(--muted);text-align:right">
                <b>${m.views || 0}</b> views · <span style="color:#747c31"><b>${m.clicks || 0}</b> reads</span>
              </span>
            </div>
          `;
        }).join('')}
      </div>
    `;
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
    
    currentAnalyticsData=data;
    const reps=data.reports||{};
    const wk=reps.weekly||{};
    const mo=reps.monthly||{};
    const yr=reps.yearly||{};
    const all=reps.all_time||{};

    const setCard=(prefix,obj)=>{
      const vEl=document.querySelector(`#${prefix}Views`);
      const cEl=document.querySelector(`#${prefix}Clicks`);
      const visEl=document.querySelector(`#${prefix}Visitors`);
      const fEl=document.querySelector(`#${prefix}Feedback`);
      if(vEl) vEl.textContent=Number(obj.views||0).toLocaleString();
      if(cEl) cEl.textContent=Number(obj.clicks||0).toLocaleString();
      if(visEl) visEl.textContent=Number(obj.visitors||0).toLocaleString();
      if(fEl) fEl.textContent=Number(obj.feedback||0).toLocaleString();
    };

    setCard('repWeekly',wk);
    setCard('repMonthly',mo);
    setCard('repYearly',yr);
    setCard('repAll',all);

    updateActivePeriodKPIs();
    renderTrendChart();
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
let currentEditingVlogId=null;
let currentArchiveItems=[];

const cancelEditBtn=document.querySelector('#cancelEditBtn');
if(cancelEditBtn){
  cancelEditBtn.addEventListener('click',()=>exitEditMode());
}

function startEditingVlog(vlog){
  if(!vlog)return;
  currentEditingVlogId=vlog.id;
  const editVlogId=document.querySelector('#editVlogId');
  if(editVlogId) editVlogId.value=vlog.id;

  const formKicker=document.querySelector('#formKicker');
  const formTitle=document.querySelector('#formTitle');
  const submitBtn=uploadForm.querySelector('button[type="submit"]');
  const docDropTitle=document.querySelector('#docDropTitle');
  const docDropSubtitle=document.querySelector('#docDropSubtitle');
  const errEl=document.querySelector('#uploadError');
  const succEl=document.querySelector('#uploadSuccess');
  if(errEl) errEl.textContent='';
  if(succEl) succEl.textContent='';

  if(formKicker) formKicker.textContent='Editing publication';
  if(formTitle) formTitle.textContent=`Edit: ${vlog.title}`;
  if(cancelEditBtn) cancelEditBtn.classList.remove('hidden');
  if(submitBtn) submitBtn.innerHTML='Save & update vlog <span>↗</span>';
  if(docDropTitle) docDropTitle.textContent='Replace Word document (optional)';
  if(docDropSubtitle) docDropSubtitle.textContent='DOC or DOCX · Leave empty to keep existing text';
  fileInput.required=false;

  // Prepopulate standard fields
  const titleInput=uploadForm.querySelector('input[name="title"]');
  const categorySelect=uploadForm.querySelector('select[name="category"]');
  const authorInput=uploadForm.querySelector('input[name="author"]');
  const excerptTextarea=uploadForm.querySelector('textarea[name="excerpt"]');

  if(titleInput) titleInput.value=vlog.title||'';
  if(categorySelect) categorySelect.value=vlog.category||'Culture';
  if(authorInput) authorInput.value=vlog.author||'';
  if(excerptTextarea) excerptTextarea.value=vlog.excerpt||'';

  if(authorBioInput){
    authorBioInput.value=vlog.author_bio||'';
    updateAuthorBioWordCount();
  }

  // Prepopulate editable document preview textbox
  if(docPreviewContainer) docPreviewContainer.classList.remove('hidden');
  if(docPreviewText){
    docPreviewText.value=vlog.body_text||'';
    updateDocPreviewWordCount();
  }

  // Clear file inputs and reset removal flags
  fileInput.value='';
  if(thumbnailInput) thumbnailInput.value='';
  if(authorImageInput) authorImageInput.value='';
  const remThumb=document.querySelector('#removeThumbnailField');
  const remAuth=document.querySelector('#removeAuthorImageField');
  if(remThumb) remThumb.value='0';
  if(remAuth) remAuth.value='0';

  // Thumbnail preview
  if(thumbnailPreview){
    if(vlog.thumbnail_filename){
      thumbnailPreview.innerHTML=`
        <div class="preview-section">
          <span class="kicker">Current Thumbnail Picture</span>
          <div class="thumbnail-preview-card">
            <div class="thumbnail-preview-frame" style="background-image:url('/uploads/${encodeURIComponent(vlog.thumbnail_filename)}')">
              <span class="thumbnail-preview-badge">Current Thumbnail</span>
              <div class="thumbnail-preview-info">
                <div>
                  <strong>${esc(vlog.thumbnail_filename)}</strong>
                  <small>Active on public site · Choose a new file below to replace</small>
                </div>
                <button type="button" class="thumbnail-remove-btn" id="removeThumbnailBtn">Remove ×</button>
              </div>
            </div>
          </div>
        </div>
      `;
      thumbnailPreview.classList.remove('hidden');
      const remBtn=thumbnailPreview.querySelector('#removeThumbnailBtn');
      if(remBtn){
        remBtn.addEventListener('click',()=>{
          if(remThumb) remThumb.value='1';
          thumbnailPreview.innerHTML='';
          thumbnailPreview.classList.add('hidden');
        });
      }
    } else {
      thumbnailPreview.innerHTML='';
      thumbnailPreview.classList.add('hidden');
    }
  }

  // Author image preview
  if(authorImagePreview){
    if(vlog.author_image_filename){
      authorImagePreview.innerHTML=`
        <div class="preview-section">
          <span class="kicker">Current Author Picture</span>
          <div class="author-preview-card">
            <div class="author-preview-avatar" style="background-image:url('/uploads/${encodeURIComponent(vlog.author_image_filename)}')"></div>
            <div class="author-preview-details">
              <strong>${esc(vlog.author_image_filename)}</strong>
              <small>Active with author bio · Choose a new file below to replace</small>
            </div>
            <button type="button" class="author-remove-btn" id="removeAuthorImageBtn">Remove ×</button>
          </div>
        </div>
      `;
      authorImagePreview.classList.remove('hidden');
      const remBtn=authorImagePreview.querySelector('#removeAuthorImageBtn');
      if(remBtn){
        remBtn.addEventListener('click',()=>{
          if(remAuth) remAuth.value='1';
          authorImagePreview.innerHTML='';
          authorImagePreview.classList.add('hidden');
        });
      }
    } else {
      authorImagePreview.innerHTML='';
      authorImagePreview.classList.add('hidden');
    }
  }

  // Highlight active row in recent films
  document.querySelectorAll('.recent-item').forEach(el=>{
    if(String(el.dataset.id)===String(vlog.id)){
      el.classList.add('is-editing');
      const hint=el.querySelector('.recent-edit-hint');
      if(hint) hint.textContent='✎ Currently editing';
    } else {
      el.classList.remove('is-editing');
      const hint=el.querySelector('.recent-edit-hint');
      if(hint) hint.textContent='✎ Click to edit';
    }
  });

  uploadForm.scrollIntoView({behavior:'smooth',block:'start'});
}

function exitEditMode(){
  currentEditingVlogId=null;
  const editVlogId=document.querySelector('#editVlogId');
  if(editVlogId) editVlogId.value='';

  const remThumb=document.querySelector('#removeThumbnailField');
  const remAuth=document.querySelector('#removeAuthorImageField');
  if(remThumb) remThumb.value='0';
  if(remAuth) remAuth.value='0';

  const formKicker=document.querySelector('#formKicker');
  const formTitle=document.querySelector('#formTitle');
  const submitBtn=uploadForm.querySelector('button[type="submit"]');
  const docDropTitle=document.querySelector('#docDropTitle');
  const docDropSubtitle=document.querySelector('#docDropSubtitle');

  if(formKicker) formKicker.textContent='New publication';
  if(formTitle) formTitle.textContent='Upload a vlog';
  if(cancelEditBtn) cancelEditBtn.classList.add('hidden');
  if(submitBtn) submitBtn.innerHTML='Publish to journal <span>↗</span>';
  if(docDropTitle) docDropTitle.textContent='Choose a Word document';
  if(docDropSubtitle) docDropSubtitle.textContent='DOC or DOCX · Maximum file size 5 MB';
  fileInput.required=true;

  uploadForm.reset();
  if(docPreviewContainer) docPreviewContainer.classList.add('hidden');
  if(docPreviewText) docPreviewText.value='';
  if(docPreviewWordCount) docPreviewWordCount.textContent='0 / 6,000 words';
  if(authorBioWordCount) authorBioWordCount.textContent='0 / 200 words';
  if(authorImagePreview){
    authorImagePreview.innerHTML='';
    authorImagePreview.classList.add('hidden');
  }
  if(thumbnailPreview){
    thumbnailPreview.innerHTML='';
    thumbnailPreview.classList.add('hidden');
  }

  document.querySelectorAll('.recent-item').forEach(el=>{
    el.classList.remove('is-editing');
    const hint=el.querySelector('.recent-edit-hint');
    if(hint) hint.textContent='✎ Click to edit';
  });
}

uploadForm.addEventListener('submit',async e=>{
  e.preventDefault();
  if(isPublishing)return;
  const isEditing=Boolean(currentEditingVlogId);
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

  const endpoint=isEditing?`/api/admin/vlogs/${currentEditingVlogId}/update`:'/api/admin/vlogs';
  isPublishing=true;
  if(submitBtn){
    submitBtn.disabled=true;
    submitBtn.style.opacity='0.6';
    submitBtn.innerHTML=isEditing?'Saving updates… <span>⏳</span>':'Publishing to journal… <span>⏳</span>';
  }

  try{
    const result=await api(endpoint,{method:'POST',body:new FormData(uploadForm)});
    succEl.textContent=isEditing
      ? `Updated successfully — "${result.title}" (${result.word_count} words).`
      : `Published successfully — ${result.word_count} words${result.thumbnail_filename?' with custom thumbnail.':'.'}`;
    exitEditMode();
    await loadArchive(false);
  }catch(error){
    errEl.textContent=error.message;
  }finally{
    isPublishing=false;
    if(submitBtn){
      submitBtn.disabled=false;
      submitBtn.style.opacity='1';
      submitBtn.innerHTML=isEditing?'Save & update vlog <span>↗</span>':'Publish to journal <span>↗</span>';
    }
  }
});

let lastArchiveRaw='';
let isArchiving=false;

async function loadArchive(isPoll=false){
  if(isPoll && (isArchiving || document.hidden)) return;
  isArchiving=true;
  try{
    const items=await api('/api/vlogs?t='+Date.now());
    currentArchiveItems=items||[];
    const rawCheck=JSON.stringify(items);
    if(isPoll && rawCheck===lastArchiveRaw) return;
    lastArchiveRaw=rawCheck;

    document.querySelector('#vlogCount').textContent=items.length;
    const list=document.querySelector('#recentList');
    if(!items.length){
      list.innerHTML='<p class="muted">No uploaded films yet.</p>';
      return;
    }

    list.innerHTML=items.map(v=>{
      const isEditing=currentEditingVlogId && String(currentEditingVlogId)===String(v.id);
      return `
        <div class="recent-item ${isEditing?'is-editing':''}" data-id="${v.id}" title="Click to edit this vlog">
          <div>
            <strong>${esc(v.title)}</strong>
            <small>${esc(v.category)} · ${esc(v.author)} · ${v.word_count} words${v.thumbnail_filename?' · 🖼️ Custom JPEG':''}${v.author_image_filename?' · 👤 Author Picture':''}</small>
            <span class="recent-edit-hint">${isEditing?'✎ Currently editing':'✎ Click to edit'}</span>
          </div>
          <button class="delete-btn" data-id="${v.id}" title="Delete vlog">×</button>
        </div>
      `;
    }).join('');

    // Attach click-to-edit listener on each item
    list.querySelectorAll('.recent-item').forEach(item=>{
      item.addEventListener('click',e=>{
        if(e.target.closest('.delete-btn'))return;
        const vlog=currentArchiveItems.find(x=>String(x.id)===String(item.dataset.id));
        if(vlog) startEditingVlog(vlog);
      });
    });

    list.querySelectorAll('.delete-btn').forEach(btn=>btn.addEventListener('click',async e=>{
      e.stopPropagation();
      if(!confirm('Delete this vlog? This cannot be undone.'))return;
      const delId=btn.dataset.id;
      if(currentEditingVlogId && String(currentEditingVlogId)===String(delId)){
        exitEditMode();
      }
      try{await api(`/api/admin/vlogs/${delId}`,{method:'DELETE'});loadArchive(false);}catch(err){alert(err.message);}
    }));
  }catch(error){console.error(error);}
  finally{isArchiving=false;}
}

document.addEventListener('visibilitychange',()=>{
  if(!document.hidden && currentUser){
    loadArchive(true);
  }
});

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
