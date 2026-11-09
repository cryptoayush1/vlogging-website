let vlogs = [];
let currentOpenVlog = null;

function esc(str){
  const d=document.createElement('div');
  d.textContent=String(str||'');
  return d.innerHTML;
}

function formatDate(dateStr){
  if (!dateStr) return 'Recent';
  try {
    const safe = String(dateStr).replace(' ', 'T');
    const d = new Date(safe);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', {month:'short', day:'2-digit', year:'numeric'});
    }
  } catch(e){}
  return String(dateStr).split(' ')[0] || 'Recent';
}

const grid = document.querySelector('#vlogGrid');
const dialog = document.querySelector('#vlogDialog');

function renderVlogs(items = vlogs){
  const countEl = document.querySelector('.section-heading .count');
  const heroCard = document.querySelector('#heroCard');

  if (!items || items.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 56px 24px; text-align: center; border: 1px dashed var(--border); border-radius: 8px; background: rgba(0,0,0,0.015);">
        <p class="eyebrow" style="margin-bottom: 8px;">Quiet Archives</p>
        <h3 style="font-family: var(--serif); font-size: 24px; font-weight: normal; margin-bottom: 8px;">No published films yet</h3>
        <p class="muted" style="max-width: 440px; margin: 0 auto; font-size: 14px; line-height: 1.6;">Films published through the editorial desk will appear here automatically. Login to the admin studio to publish your first vlog.</p>
      </div>
    `;
    if (countEl) countEl.textContent = '00 — 00';
    if (heroCard) {
      heroCard.style.cursor = 'default';
      heroCard.innerHTML = `
        <div class="hero-image image-a"><span class="play-mark">✦</span></div>
        <div class="hero-card-meta"><span>Editorial Studio</span><span>Awaiting Stories</span></div>
        <h2>Stories in progress</h2>
        <p>New films and visual essays published in the editorial studio will appear here automatically.</p>
      `;
    }
    return;
  }

  grid.innerHTML = items.map((v, i) => {
    const thumbStyle = v.thumbnail_filename
      ? `style="background-image:url('/uploads/${encodeURIComponent(v.thumbnail_filename)}');background-size:cover;background-position:center"`
      : '';
    return `
      <article class="vlog-card" data-index="${vlogs.indexOf(v)}">
        <div class="vlog-thumb ${esc(v.style || 'one')}" ${thumbStyle}></div>
        <div class="vlog-meta">
          <span>${esc(v.category)}</span>
          <span>${esc(v.date)}</span>
        </div>
        <h3>${esc(v.title)}</h3>
        <p>${esc(v.excerpt)}</p>
      </article>
    `;
  }).join('');

  if (countEl) {
    countEl.textContent = `01 — ${String(items.length).padStart(2, '0')}`;
  }

  if (heroCard) {
    const featured = items[0];
    const thumbStyle = featured.thumbnail_filename
      ? `style="background-image:url('/uploads/${encodeURIComponent(featured.thumbnail_filename)}');background-size:cover;background-position:center"`
      : '';
    heroCard.style.cursor = 'pointer';
    heroCard.innerHTML = `
      <div class="hero-image ${esc(featured.style || 'image-a')}" ${thumbStyle}><span class="play-mark">▶</span></div>
      <div class="hero-card-meta"><span>Featured film</span><span>${esc(featured.length || 'Recent')}</span></div>
      <h2>${esc(featured.title)}</h2>
      <p>${esc(featured.excerpt)}</p>
    `;
  }
}

let lastPublishedRaw = '';
let isFetchingVlogs = false;

async function loadPublishedVlogs(){
  if (isFetchingVlogs) return;
  if (document.hidden) return;
  isFetchingVlogs = true;
  try {
    const response = await fetch('/api/vlogs');
    if (!response.ok) return;
    const published = await response.json();
    if (!Array.isArray(published)) return;

    const rawCheck = JSON.stringify(published);
    if (rawCheck === lastPublishedRaw) {
      return;
    }
    lastPublishedRaw = rawCheck;

    const styles = ['one', 'two', 'three', 'four', 'five', 'six'];
    const customList = published.map((v, i) => ({
      id: v.id,
      category: v.category || 'Journal',
      date: formatDate(v.created_at),
      title: v.title,
      excerpt: v.excerpt,
      author: v.author,
      length: `${v.word_count} words`,
      style: styles[i % styles.length],
      body_text: v.body_text || '',
      thumbnail_filename: v.thumbnail_filename || '',
      author_image_filename: v.author_image_filename || '',
      author_bio: v.author_bio || ''
    }));

    vlogs = customList;
    renderVlogs(vlogs);

    // If modal is currently open for an edited vlog, update its reader view live
    if (dialog && dialog.open && currentOpenVlog) {
      const updatedVlog = vlogs.find(item => item.id === currentOpenVlog.id || (item.title === currentOpenVlog.title && !currentOpenVlog.id));
      if (updatedVlog) {
        currentOpenVlog = updatedVlog;
        const readerCategory = document.querySelector('#readerCategory');
        const readerDate = document.querySelector('#readerDate');
        const readerTitle = document.querySelector('#readerTitle');
        const readerExcerpt = document.querySelector('#readerExcerpt');
        const readerLength = document.querySelector('#readerLength');
        const readerBody = document.querySelector('#readerBody');
        const readerAuthorName = document.querySelector('#readerAuthorName');
        const readerAuthorBio = document.querySelector('#readerAuthorBio');
        const readerAuthorAvatar = document.querySelector('#readerAuthorAvatar');

        if (readerCategory) readerCategory.textContent = updatedVlog.category;
        if (readerDate) readerDate.textContent = updatedVlog.date;
        if (readerTitle) readerTitle.textContent = updatedVlog.title;
        if (readerExcerpt) readerExcerpt.textContent = updatedVlog.excerpt;
        if (readerLength) readerLength.textContent = updatedVlog.length;
        if (readerBody && updatedVlog.body_text) {
          const paras = updatedVlog.body_text.split(/\n\s*\n/).filter(p => p.trim());
          readerBody.innerHTML = paras.map(p => `<p>${esc(p.trim())}</p>`).join('');
        }
        if (readerAuthorName) readerAuthorName.textContent = updatedVlog.author || 'Field Notes Author';
        if (readerAuthorBio) readerAuthorBio.textContent = updatedVlog.author_bio || 'Contributor to the Field Notes journal archive.';
        if (readerAuthorAvatar) {
          if (updatedVlog.author_image_filename) {
            readerAuthorAvatar.textContent = '';
            readerAuthorAvatar.style.backgroundImage = `url('/uploads/${encodeURIComponent(updatedVlog.author_image_filename)}')`;
          } else {
            readerAuthorAvatar.style.backgroundImage = '';
            readerAuthorAvatar.textContent = (updatedVlog.author || 'F').charAt(0).toUpperCase();
          }
        }
      }
    }
  } catch (error) {
    // Keep existing vlogs on transient connection failure
  } finally {
    isFetchingVlogs = false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    loadPublishedVlogs();
  }
});

let lastFeedbackRaw='';
let feedbackPollTimer=null;

function startFeedbackPolling(){
  stopFeedbackPolling();
  feedbackPollTimer=setInterval(()=>{
    if(dialog && dialog.open && currentOpenVlog){
      loadFeedback(currentOpenVlog, true);
    }
  },2000);
}

function stopFeedbackPolling(){
  if(feedbackPollTimer){
    clearInterval(feedbackPollTimer);
    feedbackPollTimer=null;
  }
}

async function loadFeedback(vlog, isPoll=false){
  const listEl = document.querySelector('#feedbackList');
  const countEl = document.querySelector('#feedbackCount');
  if (!listEl) return;
  if (!isPoll) {
    listEl.innerHTML = '<p class="muted" style="font-size:13px">Loading reflections…</p>';
    if (countEl) countEl.textContent = '…';
  }

  try {
    const params = new URLSearchParams();
    if (vlog.id) params.set('vlog_id', vlog.id);
    if (vlog.title) params.set('vlog_title', vlog.title);
    params.set('_t', Date.now());
    const resp = await fetch('/api/feedback?' + params.toString());
    if (!resp.ok) throw new Error();
    const items = await resp.json();
    const rawString = JSON.stringify(items);

    if (isPoll && rawString === lastFeedbackRaw) {
      return;
    }
    lastFeedbackRaw = rawString;

    if (countEl) countEl.textContent = `${items.length} ${items.length === 1 ? 'reflection' : 'reflections'}`;
    if (!items.length) {
      listEl.innerHTML = '<p class="feedback-empty">No reflections yet. Be the first to share your thoughts on this film.</p>';
      return;
    }

    listEl.innerHTML = items.map(fb => `
      <div class="feedback-item">
        <div class="feedback-item-header">
          <strong>${esc(fb.author_name)}</strong>
          <small>${esc(formatDate(fb.created_at))}</small>
        </div>
        <p>${esc(fb.comment)}</p>
      </div>
    `).join('');
  } catch (err) {
    if (!isPoll) {
      if (countEl) countEl.textContent = '0 reflections';
      listEl.innerHTML = '<p class="feedback-empty">Be the first to share your reflection on this film.</p>';
    }
  }
}

function trackEvent(eventType, extra = {}) {
  try {
    fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: eventType, ...extra })
    }).catch(() => {});
  } catch (e) {}
}

function openVlog(v){
  if (!v) return;
  currentOpenVlog = v;
  trackEvent('vlog_click', {
    vlog_id: typeof v.id === 'number' ? v.id : null,
    vlog_title: v.title || ''
  });
  document.querySelector('#readerCategory').textContent = (v.category || 'Journal') + ' · ' + (v.length || '');
  document.querySelector('#readerTitle').textContent = v.title || '';
  document.querySelector('#readerByline').textContent = 'By ' + (v.author || 'Field Notes') + ' · ' + (v.date || '');
  document.querySelector('#readerExcerpt').textContent = v.excerpt || '';
  const readerImg = document.querySelector('#readerImage');
  readerImg.className = 'reader-image vlog-thumb ' + (v.style || 'one');
  if (v.thumbnail_filename) {
    readerImg.style.backgroundImage = `url('/uploads/${encodeURIComponent(v.thumbnail_filename)}')`;
    readerImg.style.backgroundSize = 'cover';
    readerImg.style.backgroundPosition = 'center';
  } else {
    readerImg.style.backgroundImage = '';
    readerImg.style.backgroundSize = '';
    readerImg.style.backgroundPosition = '';
  }
  
  const bodyEl = document.querySelector('#readerBody');
  if (v.body_text && v.body_text.trim()){
    bodyEl.innerHTML = v.body_text.split('\n').map(p=>p.trim()).filter(Boolean).map(p=>`<p>${esc(p)}</p>`).join('');
  } else {
    bodyEl.innerHTML = '<p class="muted">Full text not available.</p>';
  }

  const authorCard = document.querySelector('#readerAuthorCard');
  const authorAvatar = document.querySelector('#readerAuthorAvatar');
  const authorName = document.querySelector('#readerAuthorName');
  const authorBio = document.querySelector('#readerAuthorBio');
  if (authorCard && authorName && authorBio && authorAvatar) {
    authorName.textContent = v.author || 'Field Notes Author';
    authorBio.textContent = v.author_bio || 'Contributor to the Field Notes journal archive.';
    if (v.author_image_filename) {
      authorAvatar.textContent = '';
      authorAvatar.style.backgroundImage = `url('/uploads/${encodeURIComponent(v.author_image_filename)}')`;
    } else {
      authorAvatar.style.backgroundImage = '';
      authorAvatar.textContent = (v.author || 'F').charAt(0).toUpperCase();
    }
  }

  const successEl = document.querySelector('#feedbackSuccess');
  const errorEl = document.querySelector('#feedbackError');
  const formEl = document.querySelector('#feedbackForm');
  if (successEl) successEl.style.display = 'none';
  if (errorEl) errorEl.style.display = 'none';
  if (formEl) formEl.reset();

  loadFeedback(v, false);
  startFeedbackPolling();
  dialog.showModal();
}

const feedbackForm = document.querySelector('#feedbackForm');
if (feedbackForm) {
  feedbackForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!currentOpenVlog) return;
    const btn = document.querySelector('#feedbackSubmitBtn');
    const successEl = document.querySelector('#feedbackSuccess');
    const errorEl = document.querySelector('#feedbackError');
    if (successEl) successEl.style.display = 'none';
    if (errorEl) errorEl.style.display = 'none';
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = '0.6';
      btn.querySelector('span').textContent = 'Submitting…';
    }

    try {
      const fd = new FormData(feedbackForm);
      const payload = {
        vlog_id: typeof currentOpenVlog.id === 'number' ? currentOpenVlog.id : null,
        vlog_title: currentOpenVlog.title,
        author_name: fd.get('author_name'),
        author_email: fd.get('author_email') || '',
        comment: fd.get('comment')
      };

      const resp = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to submit reflection.');

      feedbackForm.reset();
      if (successEl) {
        successEl.textContent = 'Thank you. Your reflection has been published.';
        successEl.style.display = 'block';
      }
      loadFeedback(currentOpenVlog);
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.querySelector('span').textContent = 'Submit reflection';
      }
    }
  });
}

grid.addEventListener('click', e => {
  const card = e.target.closest('.vlog-card');
  if (!card) return;
  const idx = parseInt(card.dataset.index, 10);
  const v = vlogs[idx];
  if (v) openVlog(v);
});

const heroCardEl = document.querySelector('#heroCard');
if (heroCardEl) {
  heroCardEl.addEventListener('click', () => {
    if (vlogs && vlogs.length > 0) {
      openVlog(vlogs[0]);
    }
  });
}

document.querySelector('#closeVlog').onclick = () => { stopFeedbackPolling(); dialog.close(); };
document.querySelector('#readerClose').onclick = () => { stopFeedbackPolling(); dialog.close(); };
dialog.addEventListener('close', () => stopFeedbackPolling());

// Search
const searchDialog = document.querySelector('#searchDialog');
const searchInput = document.querySelector('#searchInput');
const results = document.querySelector('#searchResults');

document.querySelector('#searchToggle').onclick = () => {
  searchDialog.showModal();
  searchInput.focus();
};

searchInput.addEventListener('input', () => {
  const q = searchInput.value.toLowerCase().trim();
  if (!q) {
    results.innerHTML = '<p style="color:var(--muted);font-size:13px;margin-top:28px">Search across the journal.</p>';
    return;
  }
  const found = vlogs.filter(v => [v.title, v.category, v.excerpt, v.author].join(' ').toLowerCase().includes(q));
  results.innerHTML = found.length ? found.map(v => `
    <div class="search-result" data-index="${vlogs.indexOf(v)}">
      <b>${esc(v.title)}</b>
      <small>${esc(v.category)} · ${esc(v.author)} · ${esc(v.date)}</small>
    </div>
  `).join('') : '<p style="color:var(--muted);font-size:13px;margin-top:28px">No films match your search.</p>';
});

results.addEventListener('click', e => {
  const item = e.target.closest('.search-result');
  if (!item) return;
  const idx = parseInt(item.dataset.index, 10);
  const v = vlogs[idx];
  if (v) {
    searchDialog.close();
    openVlog(v);
  }
});

renderVlogs();
loadPublishedVlogs();
trackEvent('page_view');

// Auto-sync public site with admin portal publications every 1 second
setInterval(loadPublishedVlogs, 1000);
