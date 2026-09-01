'use strict';

const pluginState = {
  mode: localStorage.getItem('nitrate.pluginMode') || 'leader',
  token: localStorage.getItem('nitrate.pluginToken') || '',
  data: null
};

const $ = selector => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, 3000);
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function setMode(mode) {
  pluginState.mode = mode;
  pluginState.data = null;
  pluginState.token = '';
  localStorage.setItem('nitrate.pluginMode', mode);
  localStorage.removeItem('nitrate.pluginToken');
  $('#leader-view').hidden = mode !== 'leader';
  $('#member-view').hidden = mode !== 'team_member';
  $('#leader-mode').className = `button small ${mode === 'leader' ? 'primary' : 'ghost'}`;
  $('#member-mode').className = `button small ${mode === 'team_member' ? 'primary' : 'ghost'}`;
  $('#leader-mode').setAttribute('aria-pressed', String(mode === 'leader'));
  $('#member-mode').setAttribute('aria-pressed', String(mode === 'team_member'));
  $('#login-form').querySelector('[name="role"]').value = mode === 'leader' ? 'leader' : 'member';
  if (mode === 'leader') {
    $('#login-form').name.value = 'Maya Chen';
    $('#login-form').email.value = 'maya@studio.test';
    $('#login-form').agent.value = 'maya-agent';
  } else {
    $('#login-form').name.value = 'Jonas Reyes';
    $('#login-form').email.value = 'jonas@studio.test';
    $('#login-form').agent.value = 'jonas-agent';
  }
  render();
}

function assignmentStatus(status) {
  return String(status || 'delivered').replace(/_/g, ' ');
}

function leaderPacket(packet) {
  const project = packet.project;
  const assignments = project.assignments || [];
  return `
    <article class="packet-row">
      <div>
        <span class="plugin-status">Leader packet</span>
        <h3 style="font-size:1.35rem;margin-top:.6rem;">${escapeHtml(project.name)}</h3>
        <p>${escapeHtml(project.brief)}</p>
        <div class="packet-meta">${(project.outputStructure || []).map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>
        <div style="margin-top:1rem;">
          ${assignments.map(assignment => `
            <div class="assignment-card">
              <strong>${escapeHtml(assignment.agent)}</strong>
              <p style="margin:.25rem 0;">${escapeHtml(assignment.task)}</p>
              <small>${escapeHtml(assignmentStatus(assignment.status))} · ${escapeHtml(assignment.returnedAt ? 'returned' : 'not returned')}</small>
            </div>`).join('') || '<p>No AI coding agents assigned yet.</p>'}
        </div>
      </div>
      <form class="assignment-card push-form" data-project="${project.id}">
        <h3>Push to an AI coding agent</h3>
        <label class="field">Creator name<input name="name" required placeholder="Asha Kapoor"></label>
        <label class="field">Creator email<input name="email" type="email" required placeholder="asha@studio.com"></label>
        <label class="field">AI coding agent<input name="agent" required placeholder="asha-agent"></label>
        <label class="field">Task<textarea class="textarea" name="task" rows="3" required placeholder="Explore product macro stills and return /stills, /prompts, /notes."></textarea></label>
        <button class="button primary" style="width:100%;" type="submit">Push packet</button>
      </form>
    </article>`;
}

function memberPacket(packet) {
  const project = packet.project;
  const assignments = packet.assignments || [];
  return `
    <article class="packet-row">
      <div>
        <span class="plugin-status">Assigned packet</span>
        <h3 style="font-size:1.35rem;margin-top:.6rem;">${escapeHtml(project.name)}</h3>
        <p>${escapeHtml(project.brief)}</p>
        <h3>Input assets</h3>
        <div class="packet-meta">${(project.inputAssets || []).map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>
        <h3 style="margin-top:1rem;">Expected folders</h3>
        <div class="packet-meta">${(project.outputStructure || []).map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>
        <div style="margin-top:1rem;">
          ${assignments.map(assignment => `
            <div class="assignment-card">
              <strong>${escapeHtml(assignment.agent)}</strong>
              <p style="margin:.25rem 0;">${escapeHtml(assignment.task)}</p>
              <div class="review-actions">
                <button class="button small ghost" data-status="pulled" data-assignment="${assignment.id}" type="button">Pull packet</button>
                <button class="button small ghost" data-status="working" data-assignment="${assignment.id}" type="button">Mark working</button>
                <button class="button small ghost" data-status="blocked" data-assignment="${assignment.id}" type="button">Blocked</button>
              </div>
              <small>Status: ${escapeHtml(assignmentStatus(assignment.status))}</small>
            </div>`).join('')}
        </div>
      </div>
      <form class="assignment-card return-form" data-project="${project.id}" data-assignment="${assignments[0]?.id || ''}">
        <h3>Sync return</h3>
        <label class="field">Return name<input name="assetName" required placeholder="Jonas human beat v2"></label>
        <label class="field">Made with<input name="model" required value="Claude Code"></label>
        <label class="field">Prompt<textarea class="textarea" name="prompt" rows="3" required placeholder="Prompt and direction used in this AI coding agent"></textarea></label>
        <label class="field">Notes<textarea class="textarea" name="notes" rows="2" placeholder="What changed, where files live, what lead should inspect"></textarea></label>
        <label class="field">Media file<input name="file" type="file" accept="image/*,video/*,audio/*" required></label>
        <button class="button primary" style="width:100%;" type="submit">Sync return</button>
      </form>
    </article>`;
}

function render() {
  if (!pluginState.data) {
    $('#leader-packets').innerHTML = '<div class="empty"><h3>Log in to load leader packets</h3><p>The plugin will show packets you can push to AI coding agents.</p></div>';
    $('#member-packets').innerHTML = '<div class="empty"><h3>Log in to load assigned packets</h3><p>The plugin will show packets assigned to this AI coding agent.</p></div>';
    return;
  }
  const packets = pluginState.data.packets || [];
  $('#leader-packets').innerHTML = packets.length ? packets.map(leaderPacket).join('') : '<div class="empty"><h3>No packets yet</h3><p>Create one in the command center.</p></div>';
  $('#member-packets').innerHTML = packets.length ? packets.map(memberPacket).join('') : '<div class="empty"><h3>No assigned packets</h3><p>Ask your lead to push a packet to this AI coding agent.</p></div>';
  $('#session-status').textContent = `${pluginState.data.user.name} logged in as ${pluginState.data.mode}.`;
}

async function loadPackets() {
  if (!pluginState.token) return render();
  pluginState.data = await request(`/api/plugin/packets?token=${encodeURIComponent(pluginState.token)}`);
  render();
}

$('#leader-mode').addEventListener('click', () => setMode('leader'));
$('#member-mode').addEventListener('click', () => setMode('team_member'));

$('#login-form').insertAdjacentHTML('beforeend', '<input type="hidden" name="role" value="leader">');
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = Object.fromEntries(new FormData(event.currentTarget));
  input.role = pluginState.mode === 'leader' ? 'leader' : 'member';
  try {
    const result = await request('/api/plugin/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    pluginState.token = result.session.token;
    localStorage.setItem('nitrate.pluginToken', pluginState.token);
    toast('Plugin logged in.');
    await loadPackets();
  } catch (error) {
    toast(error.message);
  }
});

document.addEventListener('submit', async event => {
  if (event.target.matches('.push-form')) {
    event.preventDefault();
    const projectId = event.target.dataset.project;
    const input = Object.fromEntries(new FormData(event.target));
    try {
      await request('/api/plugin/push', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({projectId, assignments:[input]})
      });
      event.target.reset();
      toast('Packet pushed to AI coding agent.');
      await loadPackets();
    } catch (error) {
      toast(error.message);
    }
  }
  if (event.target.matches('.return-form')) {
    event.preventDefault();
    const form = event.target;
    const file = form.file.files[0];
    if (!file) return toast('Choose a media file.');
    const data = new FormData(form);
    data.set('projectId', form.dataset.project);
    data.set('assignmentId', form.dataset.assignment);
    data.set('filename', file.name);
    data.set('mime', file.type);
    data.append('file', file, file.name);
    try {
      await request('/api/uploads', {method:'POST', body:data});
      form.reset();
      toast('Return synced to leader review.');
      await loadPackets();
    } catch (error) {
      toast(error.message);
    }
  }
});

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-status][data-assignment]');
  if (!button) return;
  try {
    await request(`/api/plugin/assignments/${button.dataset.assignment}`, {
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({status:button.dataset.status})
    });
    toast(`Marked ${button.dataset.status}.`);
    await loadPackets();
  } catch (error) {
    toast(error.message);
  }
});

setMode(pluginState.mode === 'team_member' ? 'team_member' : 'leader');
loadPackets().catch(error => toast(error.message));
