import io

path = 'admin/admin.js'
with io.open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Replace lines 10-15 (0-indexed 9-14) with fixed upload preview implementation
new_lines = [
    "const uploadForm=document.querySelector('#uploadForm');\n",
    "const fileInput=uploadForm.querySelector('input[name=\"document\"]');\n",
    "const previewEl=document.createElement('div');previewEl.className='upload-preview hidden';uploadForm.insertBefore(previewEl,uploadForm.querySelector('.file-drop').nextSibling);\n",
    "function showPreview(txt){if(!txt||!txt.trim()){previewEl.classList.add('hidden');previewEl.innerHTML='';return} const paras=txt.split('\\n').map(s=>s.trim()).filter(Boolean);const wrapped=paras.map(p=>'<p>'+esc(p)+'</p>').join('');previewEl.innerHTML='<div class=\"preview-section\"><span class=\"kicker\">Preview</span><div class=\"preview-body\">'+wrapped+'</div><small>'+txt.split(/\\s+/).length+' words · ready to publish</small></div>';previewEl.classList.remove('hidden')}\n",
    "fileInput.addEventListener('change',()=>{const f=fileInput.files[0];if(!f)return;previewEl.innerHTML='<div class=\"preview-section\"><span class=\"kicker\">Preview</span><div class=\"preview-body\"><p class=\"muted\">Document selected: <strong>'+esc(f.name)+'</strong> ('+(f.size/1024).toFixed(1)+' KB). Full preview will appear after publishing.</p></div>';previewEl.classList.remove('hidden')});\n",
    "uploadForm.addEventListener('submit',async e=>{e.preventDefault();document.querySelector('#uploadError').textContent='';document.querySelector('#uploadSuccess').textContent='';try{const result=await api('/api/admin/vlogs',{method:'POST',body:new FormData(uploadForm)});document.querySelector('#uploadSuccess').textContent='Published successfully — '+result.word_count+' words.';const all=await (await fetch('/api/vlogs')).json();const pub=all.find(v=>v.id===result.id);if(pub&&pub.body_text){showPreview(pub.body_text)}else{previewEl.innerHTML='';previewEl.classList.add('hidden')}uploadForm.reset();loadArchive()}catch(error){document.querySelector('#uploadError').textContent=error.message}});\n",
    "async function loadArchive(){try{const items=await api('/api/vlogs');document.querySelector('#vlogCount').textContent=items.length;const list=document.querySelector('#recentList');list.innerHTML=items.length?items.map(v=>`<div class=\"recent-item\"><strong>${esc(v.title)}</strong><small>${esc(v.category)} · ${esc(v.author)} · ${v.word_count} words</small><button class=\"delete-btn\" data-id=\"${v.id}\" title=\"Delete vlog\">×</button></div>`).join(''):'<p class=\"muted\">No uploaded films yet.</p>';document.querySelectorAll('.delete-btn').forEach(btn=>btn.addEventListener('click',async()=>{if(!confirm('Delete this vlog? This cannot be undone.'))return;try{await api(`/api/admin/vlogs/${btn.dataset.id}`,{method:'DELETE'});loadArchive()}catch(err){alert(err.message)}}))}catch(error){console.error(error)}}\n",
]

lines[9:15] = new_lines

with io.open(path, 'w', encoding='utf-8') as f:
    f.writelines(lines)

print('admin.js updated successfully')