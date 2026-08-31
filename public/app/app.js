'use strict';

const state = {
  data: null,
  projectId: localStorage.getItem('nitrate.project') || localStorage.getItem('reel.project') || '',
  userId: localStorage.getItem('nitrate.user') || localStorage.getItem('reel.user') || '',
  status: 'needs_attention',
  branch: 'all',
  query: '',
  selectedId: '',
  compareIds: [],
  lastFocused: null,
  pluginSession: JSON.parse(localStorage.getItem('nitrate.pluginSession') || 'null')
};

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
}

function formatDate(value) {
  return new Date(value).toLocaleString(undefined, {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
}

function relativeTime(value) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, 3200);
}

async function request(url, options = {}) {
  const user = currentUser();
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(user ? {'X-Reel-User': user.name} : {}),
      ...options.headers
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

async function loadState() {
  state.data = await request('/api/state');
  if (!state.data.projects.some(project => project.id === state.projectId)) {
    state.projectId = state.data.projects[0]?.id || '';
  }
  if (!state.data.users.some(user => user.id === state.userId)) {
    state.userId = state.data.users[0]?.id || '';
  }
  localStorage.setItem('nitrate.project', state.projectId);
  localStorage.setItem('nitrate.user', state.userId);
  render();
}

function currentUser() {
  return state.data?.users.find(user => user.id === state.userId);
}

function activeProject() {
  return state.data.projects.find(project => project.id === state.projectId);
}

function assetById(assetId) {
  return state.data.assets.find(item => item.id === assetId);
}

function versionById(versionId) {
  return state.data.versions.find(item => item.id === versionId);
}

function projectVersions() {
  return state.data.versions.filter(version => version.projectId === state.projectId);
}

function assignmentById(assignmentId) {
  return activeProject()?.assignments?.find(item => item.id === assignmentId);
}

function userById(userId) {
  return state.data.users.find(user => user.id === userId);
}

function statusLabel(status) {
  return ({
    queued:'New',
    review:'Needs review',
    approved:'Approved',
    rejected:'Rejected',
    changes_requested:'Changes requested'
  })[status] || status.replace(/_/g,' ');
}

function passLabel(value) {
  const labels = { main: 'Launch', 'extended-cut': 'Extended cut', 'look-dev': 'Look development' };
  return labels[value] || value;
}

function needsAttention(version) {
  return ['queued','review','changes_requested'].includes(version.status);
}

function activationModel() {
  const project = activeProject();
  const versions = projectVersions();
  const assignments = project?.assignments || [];
  const decisions = versions.flatMap(version => version.decisions || []);
  const shares = (state.data?.shares || []).filter(share => share.scope === 'project' ? share.targetId === state.projectId : versions.some(version => version.id === share.targetId));
  const steps = [
    {
      id: 'packet',
      label: 'Create a client packet',
      help: 'Brief, input assets, review criteria, and return folders live together.',
      done: Boolean(project),
      action: 'New packet',
      event: 'new-project'
    },
    {
      id: 'assign',
      label: 'Assign creators or agents',
      help: 'Push the packet to Claude, Claude Code, Higgsfield, Runway, or local clankers.',
      done: assignments.length > 0,
      action: 'Plugin login',
      event: 'plugin-login'
    },
    {
      id: 'return',
      label: 'Receive the first return',
      help: 'Outputs come back with prompt, model, creator, notes, and source packet.',
      done: versions.length > 0,
      action: 'Return work',
      event: 'import-button'
    },
    {
      id: 'decision',
      label: 'Make a review decision',
      help: 'Approve, reject, or request changes so the team knows what moves forward.',
      done: decisions.length > 0 || versions.some(version => ['approved','rejected','changes_requested'].includes(version.status)),
      action: 'Review queue',
      event: 'review-first'
    },
    {
      id: 'share',
      label: 'Share a clean client set',
      help: 'Send only the selected work, not the production mess.',
      done: shares.length > 0,
      action: 'Share',
      event: 'share-project'
    }
  ];
  return { steps, complete: steps.filter(step => step.done).length };
}

function filteredVersions() {
  const query = state.query.trim().toLowerCase();
  return projectVersions().filter(version => {
    if (!['all','needs_attention'].includes(state.status) && version.status !== state.status) return false;
    if (state.status === 'needs_attention' && !needsAttention(version)) return false;
    if (state.branch !== 'all' && version.branch !== state.branch) return false;
    if (!query) return true;
    const asset = assetById(version.assetId) || {};
    const assignment = assignmentById(version.metadata.assignmentId) || {};
    const assignee = userById(assignment.userId) || {};
    return [asset.name, version.filename, version.branch, version.metadata.prompt, version.metadata.model, version.metadata.seed, version.metadata.pipeline]
      .concat([assignment.task, assignment.clanker, assignee.name]).join(' ').toLowerCase().includes(query);
  }).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function previewMarkup(version, controls = false) {
  const src = `/api/media/${version.id}`;
  if (version.kind === 'video') {
    return `<video src="${src}" ${controls ? 'controls' : 'autoplay muted loop playsinline'} aria-label="${escapeHtml(version.filename)} video preview"></video>`;
  }
  if (version.kind === 'audio') {
    return `<div class="audio-preview" aria-hidden="true">Audio</div><audio src="${src}" controls style="position:absolute;bottom:.4rem;left:4%;width:92%" aria-label="${escapeHtml(version.filename)} audio"></audio>`;
  }
  return `<img src="${src}" alt="${escapeHtml(version.filename)} preview">`;
}

function takeCard(version, index) {
  const asset = assetById(version.assetId);
  const assignment = assignmentById(version.metadata.assignmentId);
  const assignee = userById(assignment?.userId);
  const compareIndex = state.compareIds.indexOf(version.id);
  return `
    <article class="take">
      <button type="button" data-open-version="${version.id}" aria-label="Open ${escapeHtml(asset.name)}, take ${escapeHtml(version.filename)}">
        <div class="take-preview">${previewMarkup(version)}
          <span class="take-status status-${version.status}">${statusLabel(version.status)}</span>
        </div>
        <div class="take-info">
          <span class="eyebrow">${String(index + 1).padStart(2,'0')} · ${escapeHtml(assignee?.name || 'Unassigned')}</span>
          <div class="take-title">${escapeHtml(asset.name)}</div>
          <div class="meta-row"><span>${escapeHtml(version.metadata.model)}</span><span>${relativeTime(version.createdAt)}</span></div>
          <div class="meta-row"><span>${escapeHtml(assignment?.clanker || 'local clanker')}</span><span>${escapeHtml(version.filename)}</span></div>
        </div>
      </button>
      <div class="review-actions" style="padding:0 .7rem .7rem;margin:0;">
        <button class="button small ghost" data-compare="${version.id}" aria-pressed="${compareIndex >= 0}">${compareIndex >= 0 ? 'Selected' : 'Compare'}</button>
        <button class="button small ghost" data-share-version="${version.id}">Share</button>
      </div>
    </article>`;
}

function renderSelects() {
  $('#project-select').innerHTML = state.data.projects.map(project =>
    `<option value="${project.id}" ${project.id === state.projectId?'selected':''}>${escapeHtml(project.name)}</option>`).join('');
  $('#user-select').innerHTML = state.data.users.map(user =>
    `<option value="${user.id}" ${user.id === state.userId?'selected':''}>${escapeHtml(user.name)}</option>`).join('');
  $('#project-template').innerHTML = '<option value="">Blank project</option>' + state.data.templates.map(template =>
    `<option value="${template.id}">${escapeHtml(template.name)}</option>`).join('');
}

function renderRail() {
  const versions = projectVersions();
  const project = activeProject();
  const statuses = [
    ['needs_attention','Needs decision', versions.filter(needsAttention).length],
    ['review','Ready to review', versions.filter(v=>v.status==='review').length],
    ['queued','New returns', versions.filter(v=>v.status==='queued').length],
    ['approved','Approved', versions.filter(v=>v.status==='approved').length],
    ['changes_requested','Changes requested', versions.filter(v=>v.status==='changes_requested').length],
    ['rejected','Rejected', versions.filter(v=>v.status==='rejected').length]
  ];
  $('#queue-count').textContent = versions.filter(needsAttention).length;
  const oldest = versions.filter(needsAttention).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt))[0];
  $('#oldest-take').textContent = oldest ? `Oldest wait: ${relativeTime(oldest.createdAt)}` : 'Queue is clear.';
  $('#streak').textContent = streakLabel();
  $('#brief-summary').textContent = project?.brief || 'No brief written yet.';
  $('#output-structure').innerHTML = (project?.outputStructure || []).map(item => `<span>${escapeHtml(item)}</span>`).join('') || '<span>/renders</span><span>/prompts</span><span>/handoff</span>';
  const assignments = project?.assignments || [];
  $('#clanker-count').textContent = assignments.length;
  $('#clanker-list').innerHTML = assignments.length ? assignments.map(assignment => {
    const assignee = userById(assignment.userId);
    const returned = versions.filter(version => version.metadata.assignmentId === assignment.id).length;
    return `<li class="queue-item"><button type="button" data-clanker-search="${escapeHtml(assignment.clanker)}">
      <strong>${escapeHtml(assignee?.name || assignment.clanker)}</strong><br><small>${escapeHtml(assignment.status)} · ${returned} returns</small>
    </button></li>`;
  }).join('') : '<li class="timeline">No clankers assigned yet.</li>';
  $('#status-list').innerHTML = statuses.map(([key,label,count]) => `
    <li class="queue-item"><button type="button" data-status="${key}" ${key===state.status?'aria-current="true"':''}>
      <strong>${label}</strong><br><small>${count} returns</small>
    </button></li>`).join('');
  const branches = [...new Set(versions.map(v=>v.branch))];
  $('#branch-count').textContent = branches.length;
  $('#branch-options').innerHTML = branches.map(branch=>`<option>${escapeHtml(branch)}</option>`).join('');
  $('#branch-list').innerHTML = [['all',versions.length],...branches.map(branch=>[branch,versions.filter(v=>v.branch===branch).length])]
    .map(([branch,count]) => `<li class="queue-item"><button type="button" data-branch="${branch}" ${branch===state.branch?'aria-current="true"':''}>${branch==='all'?'All passes':escapeHtml(passLabel(branch))} · ${count}</button></li>`).join('');
  $('#template-list').innerHTML = state.data.templates.map(template=>`
    <li><button class="queue-item-button" type="button" data-template="${template.id}" style="all:unset;cursor:pointer;display:block;width:100%;">
      <strong>${escapeHtml(template.name)}</strong><br><small>${escapeHtml(template.description)}</small>
    </button></li>`).join('');
  $('#activity-list').innerHTML = state.data.activity.slice(0,7).map(event=>`
    <li><time class="mono">${formatDate(event.at)}</time><br>${escapeHtml(event.message)}</li>`).join('');
}

function renderActivation() {
  const project = activeProject();
  const versions = projectVersions();
  const assignments = project?.assignments || [];
  const approved = versions.filter(version => version.status === 'approved');
  const review = versions.filter(needsAttention);
  const creators = new Set(assignments.map(assignment => assignment.userId || assignment.clanker).filter(Boolean));
  const activation = activationModel();
  const percent = Math.round((activation.complete / activation.steps.length) * 100);
  $('#activation-percent').textContent = `${percent}%`;
  $('#activation-summary').textContent = percent === 100
    ? 'This agency workspace has the complete loop: packet, creators, returns, decisions, and shareable output.'
    : 'Finish the first client campaign loop: packet, assigned creators, returned work, review decision, and shareable set.';
  $('#activation-steps').innerHTML = activation.steps.map(step => `
    <li class="activation-step ${step.done ? 'done' : ''}">
      <div>
        <strong>${step.done ? '✓ ' : ''}${escapeHtml(step.label)}</strong>
        <span>${escapeHtml(step.help)}</span>
      </div>
      <button class="button small ${step.done ? 'ghost' : 'primary'}" type="button" data-activation-action="${step.event}">
        ${step.done ? 'Open' : escapeHtml(step.action)}
      </button>
    </li>`).join('');
  $('#metric-packets').textContent = state.data.projects.length;
  $('#metric-creators').textContent = creators.size;
  $('#metric-review').textContent = review.length;
  $('#metric-memory').textContent = approved.length;
}

function streakLabel() {
  const today = new Date().toISOString().slice(0,10);
  let streak = JSON.parse(localStorage.getItem('reel.streak') || '{"date":"","count":0}');
  if (streak.date !== today) {
    const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
    streak = {date:today,count:streak.date===yesterday?streak.count+1:1};
    localStorage.setItem('reel.streak', JSON.stringify(streak));
  }
  return `${streak.count}-day review`;
}

function renderTakes() {
  const versions = filteredVersions();
  $('#result-summary').textContent = `${versions.length} returns · ${state.branch === 'all' ? 'all passes' : passLabel(state.branch)} · ${statusLabel(state.status)}`;
  $('#takes').innerHTML = versions.length ? versions.map(takeCard).join('') :
    `<div class="empty" style="grid-column:1/-1;"><h3>No returns match this view</h3><p>Clear the filter or submit the next clanker return.</p></div>`;
  $('#compare-open').disabled = state.compareIds.length !== 2;
}

function lineageChain(version) {
  const chain = [];
  let current = version;
  while (current && chain.length < 20) {
    chain.unshift(current);
    current = current.metadata.parentVersionId ? versionById(current.metadata.parentVersionId) : null;
  }
  return chain;
}

function detailMarkup(versionId) {
  const version = versionById(versionId);
  if (!version) return '';
  const asset = assetById(version.assetId);
  const parent = version.metadata.parentVersionId ? versionById(version.metadata.parentVersionId) : null;
  const children = state.data.versions.filter(item => item.metadata.parentVersionId === version.id);
  const assignment = assignmentById(version.metadata.assignmentId);
  const assignee = userById(assignment?.userId);
  return `
    <p class="eyebrow">${escapeHtml(activeProject().name)} · ${escapeHtml(passLabel(version.branch))} · ${statusLabel(version.status)}</p>
    <h3 id="detail-title" style="font-size:1.6rem;margin-top:.4rem;">${escapeHtml(asset.name)}</h3>
    <div class="preview-frame">${previewMarkup(version,true)}</div>
    <div class="review-actions">
      <button class="button primary small" data-action="approve">Approve</button>
      <button class="button small" data-action="request_changes">Request changes</button>
      <button class="button danger small" data-action="reject">Reject</button>
      ${version.status !== 'review' ? '<button class="button small ghost" data-action="reopen">Reopen review</button>':''}
      <button class="button small ghost" data-action="branch">Send next pass</button>
      <button class="button small ghost" data-action="share">Share</button>
    </div>
    <div class="detail-grid">
      <div class="detail-item"><strong>Prompt</strong>${escapeHtml(version.metadata.prompt)}</div>
      <div class="detail-item"><strong>Model</strong>${escapeHtml(version.metadata.model)}<br>Seed: <span class="mono">${escapeHtml(version.metadata.seed||'not recorded')}</span></div>
      <div class="detail-item"><strong>Creator</strong>${escapeHtml(assignee?.name || version.metadata.operator)}<br>${escapeHtml(assignment?.clanker || 'local clanker')}</div>
      <div class="detail-item"><strong>Saved</strong><span class="mono">${escapeHtml(version.filename)}</span><br>${new Date(version.createdAt).toLocaleString()}</div>
      <div class="detail-item"><strong>Assignment</strong>${escapeHtml(assignment?.task || 'Return against the selected packet')}</div>
      <div class="detail-item"><strong>Expected folders</strong>${(activeProject().outputStructure || []).map(escapeHtml).join('<br>')}</div>
      <div class="detail-item"><strong>Starting point</strong>${parent ? `${escapeHtml(parent.filename)}<br><span>${escapeHtml(parent.metadata.model)}</span>` : 'Original take'}</div>
      <div class="detail-item"><strong>Children</strong>${children.length ? children.map(child=>`${escapeHtml(child.filename)} · ${statusLabel(child.status)}`).join('<br>') : 'No derived takes yet'}</div>
    </div>
    <section aria-labelledby="comments-title"><h3 id="comments-title">Review thread</h3>
      <form id="comment-form" class="form" style="border-radius:12px;">
        <label class="field visually-labelled" for="comment-input" style="grid-column:1/-1;"><span class="visually-hidden">Comment</span><textarea id="comment-input" name="comment" rows="3" placeholder="Give a precise, actionable note..." required></textarea></label>
        <button class="button primary small" type="submit">Add note</button>
      </form>
      ${version.comments.length ? version.comments.map(comment=>`
        <blockquote class="comment"><div class="comment-meta">${escapeHtml(comment.author)} · ${formatDate(comment.createdAt)}</div>${escapeHtml(comment.body)}</blockquote>`).join('') : '<p>No notes yet.</p>'}
    </section>
    <section aria-labelledby="history-title"><h3 id="history-title">Decision history</h3>
      <ul class="timeline">${version.decisions.length?version.decisions.map(d=>`<li><time>${formatDate(d.at)}</time><br>${escapeHtml(d.actor)} - ${statusLabel(d.action==='approve'?'approved':d.action==='request_changes'?'changes_requested':d.action)}${d.note?`: ${escapeHtml(d.note)}`:''}</li>`).join(''):'<li>No decisions yet.</li>'}</ul>
    </section>
    <section aria-labelledby="lineage-title"><h3 id="lineage-title">Pass history</h3>
      <ul class="timeline">${lineageChain(version).map((item,index)=>`<li>${index+1}. ${escapeHtml(item.filename)} · ${item.id===version.id?'current':statusLabel(item.status)}</li>`).join('')}</ul>
    </section>`;
}

function openDrawer(versionId) {
  state.selectedId = versionId;
  state.lastFocused = document.activeElement;
  $('#detail-content').innerHTML = detailMarkup(versionId);
  $('#detail-drawer').classList.add('open');
  $('.drawer-close').focus();
}

function closeDrawer() {
  $('#detail-drawer').classList.remove('open');
  state.lastFocused?.focus();
}

function openModal(id) {
  state.lastFocused = document.activeElement;
  $(id).classList.add('open');
  $(id).querySelector('input,select,textarea,button:not([data-close])')?.focus();
}

function closeModal(node) {
  node.closest('.modal')?.classList.remove('open');
  state.lastFocused?.focus();
}

function fillUploadForm(options={}) {
  const form = $('#upload-form');
  form.reset();
  form.projectId.value = options.projectId || state.projectId;
  form.assetId.value = options.assetId || '';
  form.parentVersionId.value = options.parentVersionId || '';
  form.branch.value = options.branch || activeProject()?.branches?.[0] || 'Launch';
  const template = state.data.templates.find(item=>item.id===activeProject()?.templateId);
  form.pipeline.value = options.pipeline || template?.defaults.pipeline || '';
  form.model.value = options.model || template?.defaults.model || '';
  $('#upload-parent').textContent = options.parentVersionId ? `Starting from ${versionById(options.parentVersionId).filename}. The starting point is recorded automatically.` : '';
}

function render() {
  renderSelects(); renderRail(); renderActivation(); renderTakes();
  if ($('#detail-drawer').classList.contains('open')) {
    if (versionById(state.selectedId)) $('#detail-content').innerHTML = detailMarkup(state.selectedId);
    else closeDrawer();
  }
}

async function patchVersion(id, body, message) {
  await request(`/api/versions/${id}`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  await loadState();
  toast(message);
}

$('#project-select').addEventListener('change', event=>{
  state.projectId=event.target.value; state.selectedId=''; state.compareIds=[]; loadState();
});

$('#user-select').addEventListener('change', event=>{
  state.userId=event.target.value; loadState();
});

document.addEventListener('click', async event => {
  const button = event.target.closest('button,[data-close]');
  if (!button) return;
  if (button.matches('[data-close]')) { closeModal(button); return; }
  if (button.dataset.openVersion) return openDrawer(button.dataset.openVersion);
  if (button.dataset.status !== undefined && button.dataset.status) { state.status=button.dataset.status; renderTakes(); renderRail(); return; }
  if (button.dataset.branch !== undefined && button.dataset.branch) { state.branch=button.dataset.branch; renderTakes(); renderRail(); return; }
  if (button.dataset.clankerSearch) { state.query=button.dataset.clankerSearch; $('#search').value=state.query; renderTakes(); return; }
  if (button.id === 'all-filter') { state.status='needs_attention'; state.branch='all'; renderTakes(); renderRail(); return; }
  if (button.dataset.compare) {
    const id = button.dataset.compare;
    const index = state.compareIds.indexOf(id);
    if (index >= 0) state.compareIds.splice(index,1);
    else {
      if (state.compareIds.length===2) state.compareIds.shift();
      state.compareIds.push(id);
    }
    renderTakes(); return;
  }
  if (button.id === 'compare-open') {
    const [left,right]=state.compareIds.map(versionById);
    $('#compare-grid').innerHTML=[left,right].map(version=>`
      <article><h4>${escapeHtml(assetById(version.assetId).name)}</h4>
        <div class="preview-frame">${previewMarkup(version,true)}</div>
        <dl class="detail-grid"><div class="detail-item"><dt>Status</dt><dd>${statusLabel(version.status)}</dd></div><div class="detail-item"><dt>Settings</dt><dd>${escapeHtml(version.metadata.model)} · seed ${escapeHtml(version.metadata.seed)}</dd></div><div class="detail-item"><dt>File</dt><dd>${escapeHtml(version.filename)}</dd></div></dl>
      </article>`).join('');
    openModal('#compare-modal'); return;
  }
  if (button.id === 'import-button') { fillUploadForm(); openModal('#upload-modal'); return; }
  if (button.id === 'plugin-login') { openModal('#plugin-modal'); return; }
  if (button.id === 'new-project') { openModal('#project-modal'); return; }
  if (button.id === 'share-project') { openShare({scope:'project',targetId:state.projectId}); return; }
  if (button.dataset.activationAction) {
    const action = button.dataset.activationAction;
    if (action === 'new-project') return openModal('#project-modal');
    if (action === 'plugin-login') return openModal('#plugin-modal');
    if (action === 'import-button') { fillUploadForm(); openModal('#upload-modal'); return; }
    if (action === 'share-project') return openShare({scope:'project',targetId:state.projectId});
    if (action === 'review-first') {
      const candidate = filteredVersions().find(needsAttention) || projectVersions()[0];
      if (candidate) return openDrawer(candidate.id);
      state.status = 'needs_attention'; render();
      return;
    }
  }
  if (button.dataset.shareVersion) { openShare({scope:'version',targetId:button.dataset.shareVersion}); return; }
  if (button.dataset.template) {
    const template=state.data.templates.find(item=>item.id===button.dataset.template);
    fillUploadForm({pipeline:template.defaults.pipeline,branch:template.defaults.branch}); openModal('#upload-modal'); return;
  }
  const actionButton = button.closest('[data-action]');
  if (actionButton) {
    const action = actionButton.dataset.action;
    if (action==='share') return openShare({scope:'version',targetId:state.selectedId});
    if (action==='branch') {
      const version=versionById(state.selectedId);
      closeDrawer(); fillUploadForm({assetId:version.assetId,parentVersionId:version.id,branch:`${passLabel(version.branch)} - next pass`,model:version.metadata.model,pipeline:version.metadata.pipeline});
      $('#upload-form').prompt.value=`${version.metadata.prompt}\n\nLead direction for next pass: `;
      openModal('#upload-modal'); return;
    }
    const labels={approve:'Return approved.',request_changes:'Change request recorded.',reject:'Return rejected.',reopen:'Review reopened.'};
    try { await patchVersion(state.selectedId,{action},labels[action]); } catch(err){toast(err.message);} return;
  }
});

$('#search').addEventListener('input',event=>{state.query=event.target.value;renderTakes();});

$('#theme-toggle').addEventListener('click',()=>{
  const dark=document.documentElement.getAttribute('data-theme')!=='dark';
  document.documentElement.setAttribute('data-theme',dark?'dark':'light');
  localStorage.setItem('nitrate.theme',dark?'dark':'light');
  $('#theme-toggle').textContent=dark?'Light':'Dark';
  $('#theme-toggle').setAttribute('aria-pressed',String(dark));
});

if (localStorage.getItem('nitrate.theme')==='dark' || localStorage.getItem('reel.theme')==='dark') {
  document.documentElement.setAttribute('data-theme','dark'); $('#theme-toggle').textContent='Light'; $('#theme-toggle').setAttribute('aria-pressed','true');
}

const dropzone=$('#dropzone');
['dragenter','dragover'].forEach(type=>dropzone.addEventListener(type,event=>{event.preventDefault();dropzone.classList.add('dragging');}));
['dragleave','drop'].forEach(type=>dropzone.addEventListener(type,event=>{event.preventDefault();dropzone.classList.remove('dragging');}));
dropzone.addEventListener('drop',event=>{ if(event.dataTransfer.files[0]) $('#file-input').files=event.dataTransfer.files; });

$('#file-input').addEventListener('change',event=>{
  const file=event.target.files[0];
  if (file && !$('#upload-form').assetName.value) $('#upload-form').assetName.value=file.name.replace(/\.[^.]+$/,'').replace(/[-_]+/g,' ');
});

$('#upload-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget;
  const submit=new FormData(form);
  const file=$('#file-input').files[0];
  if(!file) return toast('Choose a media file.');
  Object.entries(Object.fromEntries(submit)).forEach(([key,value])=>submit.set(key,value));
  submit.set('filename',file.name); submit.set('mime',file.type);
  submit.append('file',file,file.name);
  try {
    const result=await request('/api/uploads',{method:'POST',body:submit});
    closeModal($('#upload-form button[type="submit"]'));
    await loadState();
    toast(result.deduplicated?'Same file stored once. Return saved.':'Return saved.');
    openDrawer(result.version.id);
  } catch(error){toast(error.message);}
});

$('#project-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const input=Object.fromEntries(new FormData(event.currentTarget));
  try{
    const project=await request('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    state.projectId=project.id; closeModal($('#project-form button[type="submit"]')); event.target.reset(); await loadState(); toast('Packet created.');
  }catch(error){toast(error.message);}
});

$('#plugin-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = Object.fromEntries(new FormData(event.currentTarget));
  state.pluginSession = {
    email: input.email,
    clanker: input.clanker,
    surface: input.surface,
    at: new Date().toISOString()
  };
  localStorage.setItem('nitrate.pluginSession', JSON.stringify(state.pluginSession));
  $('#plugin-status').textContent = `Logged in as ${input.email}. Assigned packets will appear in ${input.clanker}.`;
  toast('Plugin logged in. Packet sync is ready.');
});

document.addEventListener('submit',async event=>{
  if(event.target.id!=='comment-form')return;
  event.preventDefault();
  const body=new FormData(event.target).get('comment');
  try{await patchVersion(state.selectedId,{comment:body},'Note added.');event.target.reset();}catch(error){toast(error.message);}
});

let pendingShare={};
function openShare(options) {
  pendingShare=options;
  const target = options.scope==='version'?versionById(options.targetId):activeProject();
  $('#share-target').innerHTML=`Sharing <strong>${escapeHtml(target.name||target.filename)}</strong>. Anyone with this local demo link can view it.`;
  openModal('#share-modal');
}

$('#share-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const allowDownload=new FormData(event.currentTarget).get('allowDownload')==='true';
  try{
    const share=await request('/api/shares',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...pendingShare,allowDownload})});
    const absolute=new URL(share.url,location.href).href;
    await navigator.clipboard.writeText(absolute).catch(()=>{});
    closeModal($('#share-form button[type="submit"]')); toast(`Link copied: ${share.url}`);
  }catch(error){toast(error.message);}
});

document.addEventListener('keydown',event=>{
  if (event.target.matches('input,textarea,select')) return;
  const list=filteredVersions();
  const index=list.findIndex(item=>item.id===state.selectedId);
  if(event.key==='Escape'){closeDrawer();$$('.modal.open').forEach(modal=>modal.classList.remove('open'));return;}
  if(event.key==='j'&&list[index+1]) openDrawer(list[index+1].id);
  if(event.key==='k'&&list[Math.max(index-1,-1)]) openDrawer(list[index<=0?0:index-1].id);
  if(!state.selectedId)return;
  if(event.key==='a')patchVersion(state.selectedId,{action:'approve'},'Take approved.');
  if(event.key==='r')patchVersion(state.selectedId,{action:'reject'},'Take rejected.');
  if(event.key==='c')patchVersion(state.selectedId,{action:'request_changes'},'Change request recorded.');
  if(event.key==='i'){fillUploadForm();openModal('#upload-modal');}
});

loadState().catch(error=>{
  $('#takes').innerHTML=`<div class="empty" style="grid-column:1/-1;"><h3>Workspace unavailable</h3><p>${escapeHtml(error.message)}. Start the local server with <code>npm start</code>.</p></div>`;
});
