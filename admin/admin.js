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
  if(currentUser.role==='admin' || currentUser.role==='coadmin'){
    if(currentUser.role==='admin') showAdminTools();
    setupAdminAnalytics();
  } else {
    const tabA=document.querySelector('#tabAnalytics');
    if(tabA)tabA.style.display='none';
  }
}

let analyticsInitialized=false;
let analyticsPollingTimer=null;
let lastAnalyticsRaw='';
let isAnalyticsFetching=false;

function startAnalyticsPolling(){
  stopAnalyticsPolling();
  // Fetch immediately
  loadAnalytics(true);
  analyticsPollingTimer=setInterval(async()=>{
    const viewA=document.querySelector('#analyticsView');
    if(viewA && !viewA.classList.contains('hidden') && currentUser && (currentUser.role==='admin' || currentUser.role==='coadmin')){
      if(isAnalyticsFetching) return;
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

  // If user opens straight to analytics view, begin polling
  if(viewA && !viewA.classList.contains('hidden')){
    loadAnalytics(false);
    startAnalyticsPolling();
  }

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

    const openShareModalBtn = document.querySelector('#openShareModalBtn');
    if(openShareModalBtn){
      openShareModalBtn.addEventListener('click', () => {
        openShareDialog('', '');
      });
    }

    const shareDialog = document.querySelector('#shareAnalyticsDialog');
    const closeShareDialogBtn = document.querySelector('#closeShareDialogBtn');
    const cancelShareDialogBtn = document.querySelector('#cancelShareDialogBtn');
    const shareForm = document.querySelector('#shareAnalyticsForm');

    if(closeShareDialogBtn && shareDialog){
      closeShareDialogBtn.addEventListener('click', () => shareDialog.close());
    }
    if(cancelShareDialogBtn && shareDialog){
      cancelShareDialogBtn.addEventListener('click', () => shareDialog.close());
    }
    if(shareDialog){
      shareDialog.addEventListener('click', (e) => {
        if(e.target === shareDialog) shareDialog.close();
      });
    }

    if(shareForm){
      shareForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const emailInput = document.querySelector('#shareRecipientEmail');
        const vlogIdInput = document.querySelector('#shareVlogId');
        const periodSelect = document.querySelector('#sharePeriodSelect');
        const submitBtn = document.querySelector('#submitShareBtn');
        const statusMsg = document.querySelector('#shareStatusMsg');

        const recipient_email = (emailInput ? emailInput.value : '').trim();
        const vlog_id = (vlogIdInput ? vlogIdInput.value : '').trim();
        const period = (periodSelect ? periodSelect.value : 'all_time');

        if(!recipient_email){
          if(statusMsg){
            statusMsg.style.display = 'block';
            statusMsg.style.background = '#fef2f2';
            statusMsg.style.color = '#b43434';
            statusMsg.style.border = '1px solid #fecaca';
            statusMsg.textContent = 'Please enter a valid recipient Gmail address.';
          }
          return;
        }

        try {
          if(submitBtn){
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span>✉️ Sending report to Gmail…</span>';
          }
          if(statusMsg){
            statusMsg.style.display = 'block';
            statusMsg.style.background = '#eff6ff';
            statusMsg.style.color = '#1e40af';
            statusMsg.style.border = '1px solid #bfdbfe';
            statusMsg.textContent = 'Contacting mail server and delivering report to ' + recipient_email + '…';
          }

          const res = await api('/api/admin/analytics/share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipient_email,
              vlog_id: vlog_id ? parseInt(vlog_id, 10) : null,
              period
            })
          });

          if(statusMsg){
            statusMsg.style.display = 'block';
            statusMsg.style.background = '#f0fdf4';
            statusMsg.style.color = '#166534';
            statusMsg.style.border = '1px solid #bbf7d0';
            statusMsg.textContent = '✓ ' + (res.message || ('Report successfully sent to ' + recipient_email + '. Please check your Gmail inbox!'));
          }

          setTimeout(() => {
            if(shareDialog && shareDialog.open){
              shareDialog.close();
            }
          }, 2400);
        } catch(err){
          if(statusMsg){
            statusMsg.style.display = 'block';
            statusMsg.style.background = '#fef2f2';
            statusMsg.style.color = '#b43434';
            statusMsg.style.border = '1px solid #fecaca';
            statusMsg.textContent = 'Error: ' + (err.message || 'Failed to send report. Please verify recipient email.');
          }
        } finally {
          if(submitBtn){
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>✉️ Send Report to Gmail</span>';
          }
        }
      });
    }
  }
}

function openShareDialog(vlogId = '', vlogTitle = ''){
  const dialog = document.querySelector('#shareAnalyticsDialog');
  if(!dialog) return;
  const titleEl = document.querySelector('#shareDialogTitle');
  const kickerEl = document.querySelector('#shareDialogKicker');
  const banner = document.querySelector('#shareVlogBanner');
  const bannerTitle = document.querySelector('#shareVlogBannerTitle');
  const periodGroup = document.querySelector('#sharePeriodGroup');
  const vlogIdInput = document.querySelector('#shareVlogId');
  const statusMsg = document.querySelector('#shareStatusMsg');
  const emailInput = document.querySelector('#shareRecipientEmail');

  if(statusMsg){
    statusMsg.style.display = 'none';
    statusMsg.textContent = '';
  }

  if(vlogIdInput) vlogIdInput.value = vlogId ? String(vlogId) : '';

  if(vlogId && vlogTitle){
    if(kickerEl) kickerEl.textContent = 'Single Film Analytics';
    if(titleEl) titleEl.textContent = 'Share Vlog Analytics via Gmail';
    if(banner) banner.style.display = 'block';
    if(bannerTitle) bannerTitle.textContent = vlogTitle;
    if(periodGroup) periodGroup.style.display = 'none';
  } else {
    if(kickerEl) kickerEl.textContent = 'Audience Intelligence';
    if(titleEl) titleEl.textContent = 'Share Overall Analytics via Gmail';
    if(banner) banner.style.display = 'none';
    if(periodGroup) periodGroup.style.display = 'block';
  }

  if(typeof dialog.showModal === 'function'){
    dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }

  if(emailInput) emailInput.focus();
}

let currentAnalyticsData = null;
let selectedPeriod = 'all_time';
let selectedTrendScale = 'daily';

function updateLiveValue(el, newVal){
  if(!el) return;
  const formatted = Number(newVal || 0).toLocaleString();
  if(el.textContent !== formatted){
    el.textContent = formatted;
    el.classList.add('number-pulse');
    setTimeout(() => el.classList.remove('number-pulse'), 450);
  }
}

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

  updateLiveValue(document.querySelector('#metricViews'), target.views);
  updateLiveValue(document.querySelector('#metricClicks'), target.clicks);
  updateLiveValue(document.querySelector('#metricVisitors'), target.visitors);
  updateLiveValue(document.querySelector('#metricFeedback'), target.feedback);

  const badge = document.querySelector('#activePeriodBadge');
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
  if(isBackgroundPoll && isAnalyticsFetching) return;
  isAnalyticsFetching = true;
  const chartsEl=document.querySelector('#vlogChartsContainer');
  const tableEl=document.querySelector('#feedbackTableContainer');
  const countBadge=document.querySelector('#feedbackCountBadge');
  
  try{
    const data=await api('/api/admin/analytics?t='+Date.now());
    const dataString=JSON.stringify(data);
    
    // Heartbeat flash on all live indicators across the dashboard
    document.querySelectorAll('.live-pulse').forEach(el=>{
      el.classList.add('flash');
      setTimeout(()=>el.classList.remove('flash'),450);
    });

    currentAnalyticsData=data;
    const reps=data.reports||{};
    const wk=reps.weekly||{};
    const mo=reps.monthly||{};
    const yr=reps.yearly||{};
    const all=reps.all_time||{};

    const setCard=(prefix,obj)=>{
      updateLiveValue(document.querySelector(`#${prefix}Views`), obj.views);
      updateLiveValue(document.querySelector(`#${prefix}Clicks`), obj.clicks);
      updateLiveValue(document.querySelector(`#${prefix}Visitors`), obj.visitors);
      updateLiveValue(document.querySelector(`#${prefix}Feedback`), obj.feedback);
    };

    setCard('repWeekly',wk);
    setCard('repMonthly',mo);
    setCard('repYearly',yr);
    setCard('repAll',all);

    updateActivePeriodKPIs();

    if(countBadge){
      const fbTotal=data.total_feedback||0;
      countBadge.textContent=`${fbTotal} ${fbTotal===1?'Reflection':'Reflections'}`;
    }

    // Only re-render heavy trend charts and lists if data actually changed
    if(dataString===lastAnalyticsRaw){
      return;
    }
    lastAnalyticsRaw=dataString;

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
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <span class="meta-sub" style="font-weight:600;color:var(--ink)">
                  ${v.clicks||0} reads · ${v.feedback_count||0} reflections
                </span>
                <button type="button" class="share-vlog-btn" data-id="${v.id}" data-title="${esc(v.title)}" title="Share this vlog's performance via Gmail">
                  ✉️ Share report
                </button>
              </div>
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

      chartsEl.querySelectorAll('.share-vlog-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          openShareDialog(btn.dataset.id, btn.dataset.title);
        });
      });
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
  }finally{
    isAnalyticsFetching = false;
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
const docPreviewVisual=document.querySelector('#docPreviewVisual');
const docPreviewWordCount=document.querySelector('#docPreviewWordCount');
const editorFontFamily=document.querySelector('#editorFontFamily');
const editorFontSize=document.querySelector('#editorFontSize');
const editorImageInput=document.querySelector('#editorImageInput');
const btnInsertPhoto=document.querySelector('#btnInsertPhoto');

function countWords(str){
  if(!str||!str.trim()) return 0;
  // Clean out HTML tags for accurate word counting
  const plain = str.replace(/<[^>]+>/g, ' ').trim();
  if(!plain) return 0;
  return plain.split(/\s+/).filter(Boolean).length;
}

function syncVisualToText(){
  if(!docPreviewVisual || !docPreviewText) return;
  docPreviewText.value = docPreviewVisual.innerHTML;
  updateDocPreviewWordCount();
}

function makeImagesDraggable(){
  if(!docPreviewVisual) return;
  docPreviewVisual.querySelectorAll('img, figure').forEach(el => {
    el.setAttribute('draggable', 'true');
  });
}

function setPreviewContent(content){
  deselectEditorImage();
  if(!content){
    if(docPreviewVisual) docPreviewVisual.innerHTML='';
    if(docPreviewText) docPreviewText.value='';
    updateDocPreviewWordCount();
    return;
  }
  // Check if content is HTML or plain text
  if(!/<[a-z][\s\S]*>/i.test(content)){
    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split(/\n+/).filter(Boolean);
    const html = lines.map(l => `<p>${esc(l)}</p>`).join('');
    if(docPreviewVisual) docPreviewVisual.innerHTML = html;
    if(docPreviewText) docPreviewText.value = html;
  } else {
    if(docPreviewVisual) docPreviewVisual.innerHTML = content;
    if(docPreviewText) docPreviewText.value = content;
  }
  makeImagesDraggable();
  updateDocPreviewWordCount();
}

function updateDocPreviewWordCount(){
  if(!docPreviewWordCount) return;
  const raw = docPreviewVisual ? (docPreviewVisual.innerText || docPreviewVisual.textContent || '') : (docPreviewText ? docPreviewText.value : '');
  const count=countWords(raw);
  docPreviewWordCount.textContent=`${count.toLocaleString()} / 6,000 words`;
  if(count>6000){
    docPreviewWordCount.style.color='#b43434';
  } else {
    docPreviewWordCount.style.color='var(--muted)';
  }
}

if(docPreviewVisual){
  docPreviewVisual.addEventListener('input', syncVisualToText);
  docPreviewVisual.addEventListener('blur', syncVisualToText);
}

// Formatting Toolbar Action Handlers (Bold, Italics, Underline, Justification, Lists)
document.querySelectorAll('.editor-tool-btn[data-cmd]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if(!docPreviewVisual) return;
    docPreviewVisual.focus();
    const cmd = btn.dataset.cmd;
    document.execCommand(cmd, false, null);
    syncVisualToText();
  });
});

// Hyperlink Handler
const btnLink = document.querySelector('#btnLink');
if(btnLink){
  btnLink.addEventListener('click', (e) => {
    e.preventDefault();
    if(!docPreviewVisual) return;
    docPreviewVisual.focus();
    const url = prompt('Enter link destination URL (e.g. https://example.com):', 'https://');
    if(!url || !url.trim()) return;
    const cleanUrl = url.trim();
    document.execCommand('createLink', false, cleanUrl);
    syncVisualToText();
  });
}

// Font Size Handler
if(editorFontSize){
  editorFontSize.addEventListener('change', () => {
    const size = editorFontSize.value;
    if(!size || !docPreviewVisual) return;
    docPreviewVisual.focus();
    document.execCommand('fontSize', false, size);
    syncVisualToText();
  });
}

// Bengali / English Font Selector
if(editorFontFamily){
  editorFontFamily.addEventListener('change', () => {
    const font = editorFontFamily.value;
    if(!docPreviewVisual) return;
    docPreviewVisual.focus();
    if(!font){
      docPreviewVisual.style.fontFamily = 'inherit';
    } else {
      docPreviewVisual.style.fontFamily = font;
      // If user has highlighted specific text, apply font to selection
      const sel = window.getSelection();
      if(sel && sel.rangeCount > 0 && !sel.isCollapsed){
        document.execCommand('fontName', false, font);
      }
    }
    syncVisualToText();
  });
}

// External Photo Upload Handler
if(btnInsertPhoto && editorImageInput){
  btnInsertPhoto.addEventListener('click', (e) => {
    e.preventDefault();
    editorImageInput.click();
  });

  editorImageInput.addEventListener('change', async () => {
    const file = editorImageInput.files[0];
    if(!file) return;

    if(file.size > 5 * 1024 * 1024){
      alert('Selected photo exceeds the 5 MB limit. Please select a photo under 5 MB.');
      editorImageInput.value = '';
      return;
    }

    btnInsertPhoto.disabled = true;
    btnInsertPhoto.innerHTML = 'Uploading photo… <span>⏳</span>';

    try {
      let finalImgUrl = '';
      try {
        const fd = new FormData();
        fd.append('image', file);
        const res = await api('/api/admin/vlogs/upload-body-image', { method: 'POST', body: fd });
        if(res && res.url) finalImgUrl = res.url;
      } catch(err) {
        // Fallback to Base64 Data URL if offline or local server
        finalImgUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = e => resolve(e.target.result);
          reader.readAsDataURL(file);
        });
      }

      if(finalImgUrl && docPreviewVisual){
        docPreviewVisual.focus();
        const photoCaption = prompt('Optional caption for this photo (leave empty for none):', '');
        const captionHtml = photoCaption && photoCaption.trim()
          ? `<figcaption style="font-size:12px;color:var(--muted);font-style:italic;margin-top:6px;">${esc(photoCaption.trim())}</figcaption>`
          : '';
        const figureHtml = `
          <figure draggable="true" style="margin:20px 0;text-align:center;">
            <img draggable="true" src="${finalImgUrl}" alt="${esc(photoCaption || 'Vlog photo')}" style="max-width:100%;height:auto;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,0.08);display:block;margin:0 auto;" />
            ${captionHtml}
          </figure>
          <p><br></p>
        `;
        document.execCommand('insertHTML', false, figureHtml);
        makeImagesDraggable();
        syncVisualToText();
      }
    } catch(err) {
      alert('Error inserting photo: ' + err.message);
    } finally {
      btnInsertPhoto.disabled = false;
      btnInsertPhoto.innerHTML = '📷 Insert Photo';
      editorImageInput.value = '';
    }
  });
}

// ==========================================
// MICROSOFT WORD-STYLE PICTURE TOOLS & RESIZER
// ==========================================
const pictureToolbar = document.querySelector('#pictureToolbar');
const picWidthSlider = document.querySelector('#picWidthSlider');
const picWidthLabel = document.querySelector('#picWidthLabel');
const picStyleSelect = document.querySelector('#picStyleSelect');
const btnPicResetSize = document.querySelector('#btnPicResetSize');
const btnPicCaption = document.querySelector('#btnPicCaption');
const btnPicReplace = document.querySelector('#btnPicReplace');
const btnPicDelete = document.querySelector('#btnPicDelete');
const btnPicDone = document.querySelector('#btnPicDone');
const btnPicMoveUp = document.querySelector('#btnPicMoveUp');
const btnPicMoveDown = document.querySelector('#btnPicMoveDown');
const overlayMovePill = document.querySelector('#overlayMovePill');
const editorDropLine = document.querySelector('#editorDropLine');
const replaceImageInput = document.querySelector('#replaceImageInput');
const imgResizeOverlay = document.querySelector('#imgResizeOverlay');
const resizeDimBadge = document.querySelector('#resizeDimBadge');

let activeSelectedImg = null;
let isDraggingResize = false;
let draggedItem = null;

function showDropLine(clientX, clientY) {
  if (!editorDropLine || !docPreviewVisual) return;
  const containerRect = docPreviewVisual.parentElement.getBoundingClientRect();

  let top = null;

  // Try caret range first
  let range = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(clientX, clientY);
  } else if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(clientX, clientY);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  }

  if (range && docPreviewVisual.contains(range.startContainer)) {
    let block = range.startContainer;
    if (block.nodeType === Node.TEXT_NODE) block = block.parentElement;
    if (block && docPreviewVisual.contains(block)) {
      const blockRect = block.getBoundingClientRect();
      top = (blockRect.top - containerRect.top) + (clientY > blockRect.top + blockRect.height / 2 ? blockRect.height : 0) + docPreviewVisual.parentElement.scrollTop;
    }
  }

  if (top === null) {
    // Fallback using elementFromPoint
    let el = document.elementFromPoint(clientX, clientY);
    if (el && draggedItem && draggedItem.contains(el)) {
      draggedItem.style.visibility = 'hidden';
      el = document.elementFromPoint(clientX, clientY);
      draggedItem.style.visibility = '';
    }
    if (el && docPreviewVisual.contains(el)) {
      const block = el.closest('p, blockquote, h1, h2, h3, h4, div, figure') || el;
      if (block && docPreviewVisual.contains(block)) {
        const blockRect = block.getBoundingClientRect();
        top = (blockRect.top - containerRect.top) + (clientY > blockRect.top + blockRect.height / 2 ? blockRect.height : 0) + docPreviewVisual.parentElement.scrollTop;
      }
    }
  }

  if (top === null) {
    top = (clientY - containerRect.top) + docPreviewVisual.parentElement.scrollTop;
  }

  editorDropLine.style.top = `${Math.max(0, top)}px`;
  editorDropLine.style.left = `14px`;
  editorDropLine.style.width = `${Math.max(120, docPreviewVisual.clientWidth - 28)}px`;
  editorDropLine.classList.remove('hidden');
}

function hideDropLine() {
  if (editorDropLine) editorDropLine.classList.add('hidden');
}

function positionImageOverlay(img) {
  if (!img || !imgResizeOverlay || !docPreviewVisual) return;
  const containerRect = docPreviewVisual.parentElement.getBoundingClientRect();
  const imgRect = img.getBoundingClientRect();

  const top = (imgRect.top - containerRect.top);
  const left = (imgRect.left - containerRect.left);

  imgResizeOverlay.style.top = `${top}px`;
  imgResizeOverlay.style.left = `${left}px`;
  imgResizeOverlay.style.width = `${imgRect.width}px`;
  imgResizeOverlay.style.height = `${imgRect.height}px`;
  imgResizeOverlay.classList.remove('hidden');

  const parentWidth = Math.max(100, docPreviewVisual.clientWidth - 32);
  const pct = Math.min(100, Math.max(10, Math.round((imgRect.width / parentWidth) * 100)));
  if (resizeDimBadge) {
    resizeDimBadge.textContent = `${Math.round(imgRect.width)}px · ${pct}%`;
  }
  if (picWidthSlider) picWidthSlider.value = pct;
  if (picWidthLabel) picWidthLabel.textContent = `${pct}%`;
}

function selectEditorImage(img) {
  if (!img) return;
  activeSelectedImg = img;
  if (pictureToolbar) pictureToolbar.classList.remove('hidden');
  positionImageOverlay(img);

  const fig = img.closest('figure');
  const targetEl = fig || img;
  const curFloat = targetEl.style.float || 'none';
  const curDisplay = targetEl.style.display || '';

  document.querySelectorAll('[data-img-wrap]').forEach(btn => {
    const wrap = btn.dataset.imgWrap;
    let isActive = false;
    if (wrap === 'left' && curFloat === 'left') isActive = true;
    else if (wrap === 'right' && curFloat === 'right') isActive = true;
    else if (wrap === 'center' && (curFloat === 'none' || !curFloat) && (targetEl.style.margin && targetEl.style.margin.includes('auto'))) isActive = true;
    else if (wrap === 'inline' && curDisplay.includes('inline')) isActive = true;
    btn.classList.toggle('is-active', isActive);
  });
}

function deselectEditorImage() {
  activeSelectedImg = null;
  if (imgResizeOverlay) imgResizeOverlay.classList.add('hidden');
  if (pictureToolbar) pictureToolbar.classList.add('hidden');
  document.querySelectorAll('[data-img-size]').forEach(b => b.classList.remove('is-active'));
  document.querySelectorAll('[data-img-wrap]').forEach(b => b.classList.remove('is-active'));
}

// Move photo position Up before previous block
if (btnPicMoveUp) {
  btnPicMoveUp.addEventListener('click', (e) => {
    e.preventDefault();
    if (!activeSelectedImg) return;
    const target = activeSelectedImg.closest('figure') || activeSelectedImg;
    const prev = target.previousElementSibling;
    if (prev) {
      target.parentElement.insertBefore(target, prev);
      positionImageOverlay(activeSelectedImg);
      syncVisualToText();
    }
  });
}

// Move photo position Down after next block
if (btnPicMoveDown) {
  btnPicMoveDown.addEventListener('click', (e) => {
    e.preventDefault();
    if (!activeSelectedImg) return;
    const target = activeSelectedImg.closest('figure') || activeSelectedImg;
    const next = target.nextElementSibling;
    if (next) {
      target.parentElement.insertBefore(target, next.nextElementSibling);
      positionImageOverlay(activeSelectedImg);
      syncVisualToText();
    }
  });
}

// Move pill on the selection overlay (drag to move)
if (overlayMovePill) {
  overlayMovePill.addEventListener('dragstart', (e) => {
    if (!activeSelectedImg) return;
    const target = activeSelectedImg.closest('figure') || activeSelectedImg;
    draggedItem = target;
    draggedItem.classList.add('is-dragging');
    imgResizeOverlay.classList.add('hidden');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'vlog-image-move');

    if (e.dataTransfer.setDragImage && activeSelectedImg) {
      try {
        e.dataTransfer.setDragImage(activeSelectedImg, 40, 40);
      } catch(err) {}
    }
  });
}

if (docPreviewVisual) {
  docPreviewVisual.addEventListener('click', (e) => {
    const img = e.target.closest('img');
    if (img && docPreviewVisual.contains(img)) {
      e.stopPropagation();
      selectEditorImage(img);
    } else if (!isDraggingResize) {
      deselectEditorImage();
    }
  });

  docPreviewVisual.addEventListener('scroll', () => {
    if (activeSelectedImg) positionImageOverlay(activeSelectedImg);
  });

  // DRAG & DROP REPOSITIONING (Moves picture to where the cursor is)
  docPreviewVisual.addEventListener('dragstart', (e) => {
    const target = e.target.closest('figure') || (e.target.tagName === 'IMG' ? e.target : null);
    if (!target) return;

    draggedItem = target;
    draggedItem.classList.add('is-dragging');
    if (imgResizeOverlay) imgResizeOverlay.classList.add('hidden');

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'vlog-image-move');

    const img = target.querySelector('img') || (target.tagName === 'IMG' ? target : null);
    if (img && e.dataTransfer.setDragImage) {
      try {
        e.dataTransfer.setDragImage(img, Math.min(img.clientWidth / 2, 80), Math.min(img.clientHeight / 2, 80));
      } catch(err) {}
    }
  });

  function handleEditorDragOver(e) {
    if (!draggedItem) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    showDropLine(e.clientX, e.clientY);
  }

  function handleEditorDrop(e) {
    if (!draggedItem) return;
    e.preventDefault();
    e.stopPropagation();
    hideDropLine();

    const clientX = e.clientX;
    const clientY = e.clientY;
    let placed = false;

    // 1. Try caretRangeFromPoint / caretPositionFromPoint
    let range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(clientX, clientY);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(clientX, clientY);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }

    if (range && docPreviewVisual.contains(range.startContainer) && !draggedItem.contains(range.startContainer)) {
      let node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        const parentP = node.closest('p, blockquote, div, h1, h2, h3, h4, figure') || node.parentElement;
        if (parentP && parentP !== docPreviewVisual && docPreviewVisual.contains(parentP)) {
          if (range.startOffset < (node.length / 2)) {
            parentP.parentElement.insertBefore(draggedItem, parentP);
          } else {
            parentP.parentElement.insertBefore(draggedItem, parentP.nextSibling);
          }
          placed = true;
        }
      } else if (node === docPreviewVisual) {
        if (range.startOffset < node.childNodes.length) {
          node.insertBefore(draggedItem, node.childNodes[range.startOffset]);
        } else {
          node.appendChild(draggedItem);
        }
        placed = true;
      } else {
        const block = node.closest('p, blockquote, h1, h2, h3, h4, div, figure') || node;
        if (block && block !== draggedItem && block.parentElement) {
          block.parentElement.insertBefore(draggedItem, block.nextSibling);
          placed = true;
        }
      }
    }

    // 2. Fallback: find element directly under mouse cursor with elementFromPoint
    if (!placed) {
      let el = document.elementFromPoint(clientX, clientY);
      if (el && draggedItem.contains(el)) {
        draggedItem.style.visibility = 'hidden';
        el = document.elementFromPoint(clientX, clientY);
        draggedItem.style.visibility = '';
      }

      if (el && docPreviewVisual.contains(el)) {
        const block = el.closest('p, blockquote, h1, h2, h3, h4, div, figure') || el;
        if (block && block !== draggedItem && docPreviewVisual.contains(block)) {
          const rect = block.getBoundingClientRect();
          if (clientY < rect.top + rect.height / 2) {
            block.parentElement.insertBefore(draggedItem, block);
          } else {
            block.parentElement.insertBefore(draggedItem, block.nextSibling);
          }
          placed = true;
        }
      }
    }

    // 3. Fallback: if dropped at top or bottom / empty area of editor
    if (!placed) {
      const visualRect = docPreviewVisual.getBoundingClientRect();
      if (clientY < visualRect.top + 60) {
        docPreviewVisual.insertBefore(draggedItem, docPreviewVisual.firstChild);
      } else {
        docPreviewVisual.appendChild(draggedItem);
      }
      placed = true;
    }

    // Ensure empty paragraph exists after figure so user can keep typing easily
    if (!draggedItem.nextElementSibling || draggedItem.nextElementSibling.tagName === 'FIGURE') {
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      draggedItem.parentElement.insertBefore(p, draggedItem.nextSibling);
    }

    const img = draggedItem.querySelector('img') || (draggedItem.tagName === 'IMG' ? draggedItem : null);
    draggedItem.classList.remove('is-dragging');
    draggedItem = null;

    makeImagesDraggable();
    if (img) {
      selectEditorImage(img);
    }
    syncVisualToText();
  }

  docPreviewVisual.addEventListener('dragover', handleEditorDragOver);
  docPreviewVisual.addEventListener('drop', handleEditorDrop);

  if (docPreviewVisual.parentElement) {
    docPreviewVisual.parentElement.addEventListener('dragover', handleEditorDragOver);
    docPreviewVisual.parentElement.addEventListener('drop', handleEditorDrop);
  }

  docPreviewVisual.addEventListener('dragleave', (e) => {
    if (!docPreviewVisual.contains(e.relatedTarget)) {
      hideDropLine();
    }
  });

  docPreviewVisual.addEventListener('dragend', () => {
    if (draggedItem) {
      draggedItem.classList.remove('is-dragging');
      draggedItem = null;
    }
    hideDropLine();
  });
}

window.addEventListener('resize', () => {
  if (activeSelectedImg) positionImageOverlay(activeSelectedImg);
});

function setImageSize(widthVal) {
  if (!activeSelectedImg) return;
  const fig = activeSelectedImg.closest('figure');
  const widthStr = typeof widthVal === 'number' ? `${widthVal}%` : String(widthVal);

  activeSelectedImg.style.width = widthStr;
  activeSelectedImg.style.maxWidth = '100%';
  activeSelectedImg.style.height = 'auto';

  if (fig) {
    fig.style.width = widthStr;
    fig.style.maxWidth = '100%';
  }

  positionImageOverlay(activeSelectedImg);
  syncVisualToText();
}

document.querySelectorAll('[data-img-size]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!activeSelectedImg) return;
    const size = btn.dataset.imgSize;
    setImageSize(size);
    document.querySelectorAll('[data-img-size]').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
  });
});

if (picWidthSlider) {
  picWidthSlider.addEventListener('input', () => {
    if (!activeSelectedImg) return;
    const val = picWidthSlider.value;
    setImageSize(val);
    if (picWidthLabel) picWidthLabel.textContent = `${val}%`;
  });
}

if (btnPicResetSize) {
  btnPicResetSize.addEventListener('click', (e) => {
    e.preventDefault();
    if (!activeSelectedImg) return;
    setImageSize('100%');
  });
}

document.querySelectorAll('[data-img-wrap]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!activeSelectedImg) return;
    const wrap = btn.dataset.imgWrap;
    const fig = activeSelectedImg.closest('figure');
    const target = fig || activeSelectedImg;

    if (wrap === 'left') {
      target.style.float = 'left';
      target.style.margin = '10px 20px 14px 0';
      target.style.clear = 'left';
      target.style.display = 'block';
      target.style.textAlign = 'left';
    } else if (wrap === 'center') {
      target.style.float = 'none';
      target.style.margin = '20px auto';
      target.style.clear = 'both';
      target.style.display = 'block';
      target.style.textAlign = 'center';
    } else if (wrap === 'right') {
      target.style.float = 'right';
      target.style.margin = '10px 0 14px 20px';
      target.style.clear = 'right';
      target.style.display = 'block';
      target.style.textAlign = 'right';
    } else if (wrap === 'inline') {
      target.style.float = 'none';
      target.style.margin = '6px 12px';
      target.style.clear = 'none';
      target.style.display = 'inline-block';
      target.style.verticalAlign = 'middle';
    }

    document.querySelectorAll('[data-img-wrap]').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');

    positionImageOverlay(activeSelectedImg);
    syncVisualToText();
  });
});

if (picStyleSelect) {
  picStyleSelect.addEventListener('change', () => {
    if (!activeSelectedImg) return;
    const style = picStyleSelect.value;
    const img = activeSelectedImg;

    img.style.borderRadius = '';
    img.style.boxShadow = '';
    img.style.border = '';
    img.style.padding = '';
    img.style.background = '';
    img.style.aspectRatio = '';
    img.style.objectFit = '';

    if (style === 'rounded') {
      img.style.borderRadius = '12px';
    } else if (style === 'shadow') {
      img.style.borderRadius = '4px';
      img.style.boxShadow = '0 10px 28px rgba(0,0,0,0.18)';
    } else if (style === 'frame') {
      img.style.borderRadius = '2px';
      img.style.border = '3px solid #20221f';
    } else if (style === 'matte') {
      img.style.borderRadius = '2px';
      img.style.padding = '8px';
      img.style.background = '#ffffff';
      img.style.border = '1px solid #d8dad2';
      img.style.boxShadow = '0 4px 14px rgba(0,0,0,0.1)';
    } else if (style === 'circle') {
      img.style.borderRadius = '50%';
      img.style.aspectRatio = '1 / 1';
      img.style.objectFit = 'cover';
    }

    positionImageOverlay(activeSelectedImg);
    syncVisualToText();
  });
}

if (btnPicCaption) {
  btnPicCaption.addEventListener('click', (e) => {
    e.preventDefault();
    if (!activeSelectedImg) return;
    let fig = activeSelectedImg.closest('figure');
    if (!fig) {
      fig = document.createElement('figure');
      fig.style.margin = '20px auto';
      fig.style.textAlign = 'center';
      activeSelectedImg.parentNode.insertBefore(fig, activeSelectedImg);
      fig.appendChild(activeSelectedImg);
    }

    let captionEl = fig.querySelector('figcaption');
    const currentCaption = captionEl ? captionEl.textContent.trim() : '';
    const newCaption = prompt('Enter or edit image caption (leave empty to remove):', currentCaption);

    if (newCaption === null) return;
    if (newCaption.trim()) {
      if (!captionEl) {
        captionEl = document.createElement('figcaption');
        captionEl.style.fontSize = '12px';
        captionEl.style.color = 'var(--muted)';
        captionEl.style.fontStyle = 'italic';
        captionEl.style.marginTop = '6px';
        fig.appendChild(captionEl);
      }
      captionEl.textContent = newCaption.trim();
    } else {
      if (captionEl) captionEl.remove();
    }

    positionImageOverlay(activeSelectedImg);
    syncVisualToText();
  });
}

if (btnPicReplace && replaceImageInput) {
  btnPicReplace.addEventListener('click', (e) => {
    e.preventDefault();
    if (!activeSelectedImg) return;
    replaceImageInput.click();
  });

  replaceImageInput.addEventListener('change', async () => {
    const file = replaceImageInput.files[0];
    if (!file || !activeSelectedImg) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('Selected replacement photo exceeds the 5 MB limit.');
      replaceImageInput.value = '';
      return;
    }

    btnPicReplace.innerHTML = 'Replacing… <span>⏳</span>';
    try {
      let newUrl = '';
      try {
        const fd = new FormData();
        fd.append('image', file);
        const res = await api('/api/admin/vlogs/upload-body-image', { method: 'POST', body: fd });
        if (res && res.url) newUrl = res.url;
      } catch(err) {
        newUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = e => resolve(e.target.result);
          reader.readAsDataURL(file);
        });
      }

      if (newUrl && activeSelectedImg) {
        activeSelectedImg.src = newUrl;
        positionImageOverlay(activeSelectedImg);
        syncVisualToText();
      }
    } catch(err) {
      alert('Failed to replace picture: ' + err.message);
    } finally {
      btnPicReplace.innerHTML = '🔄 Replace';
      replaceImageInput.value = '';
    }
  });
}

if (btnPicDelete) {
  btnPicDelete.addEventListener('click', (e) => {
    e.preventDefault();
    if (!activeSelectedImg) return;
    if (!confirm('Remove this photo from the vlog?')) return;
    const fig = activeSelectedImg.closest('figure');
    if (fig) fig.remove();
    else activeSelectedImg.remove();
    deselectEditorImage();
    syncVisualToText();
  });
}

if (btnPicDone) {
  btnPicDone.addEventListener('click', (e) => {
    e.preventDefault();
    deselectEditorImage();
  });
}

if (imgResizeOverlay) {
  imgResizeOverlay.querySelectorAll('.resize-handle').forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!activeSelectedImg) return;

      isDraggingResize = true;
      const startX = e.clientX;
      const startWidth = activeSelectedImg.getBoundingClientRect().width;
      const handleType = handle.dataset.handle;
      const parentWidth = Math.max(100, docPreviewVisual.clientWidth - 32);

      function onMouseMove(moveEvent) {
        if (!isDraggingResize || !activeSelectedImg) return;
        const deltaX = moveEvent.clientX - startX;
        let newPx = startWidth;

        if (handleType === 'se' || handleType === 'ne') {
          newPx = startWidth + deltaX;
        } else {
          newPx = startWidth - deltaX;
        }

        newPx = Math.max(60, Math.min(newPx, parentWidth));
        const newPct = Math.min(100, Math.max(10, Math.round((newPx / parentWidth) * 100)));

        setImageSize(`${newPct}%`);
        if (resizeDimBadge) resizeDimBadge.textContent = `${Math.round(newPx)}px · ${newPct}%`;
        if (picWidthSlider) picWidthSlider.value = newPct;
        if (picWidthLabel) picWidthLabel.textContent = `${newPct}%`;
      }

      function onMouseUp() {
        isDraggingResize = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        if (activeSelectedImg) positionImageOverlay(activeSelectedImg);
        syncVisualToText();
      }

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  });
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
    setPreviewContent('');
    return;
  }

  // 5 MB file size limit check
  const MAX_DOC_BYTES=5*1024*1024;
  if(f.size>MAX_DOC_BYTES){
    const sizeMb=(f.size/(1024*1024)).toFixed(2);
    if(errEl) errEl.textContent=`Word document exceeds the 5 MB limit (${sizeMb} MB). Please choose a file under 5 MB.`;
    fileInput.value='';
    if(docPreviewContainer) docPreviewContainer.classList.add('hidden');
    setPreviewContent('');
    return;
  }

  if(docPreviewContainer) docPreviewContainer.classList.remove('hidden');
  setPreviewContent('Parsing document preview…');
  if(docPreviewWordCount) docPreviewWordCount.textContent='Parsing…';

  try{
    const fd=new FormData();
    fd.append('document',f);
    const result=await api('/api/admin/vlogs/preview',{method:'POST',body:fd});
    setPreviewContent(result.body_text||'');
  }catch(err){
    if(errEl) errEl.textContent=err.message;
    setPreviewContent('');
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
  setPreviewContent(vlog.body_text||'');

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
  setPreviewContent('');
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
  syncVisualToText();
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
