// Simple single-workspace UI. No login, tokens, or user accounts.
const $ = id => document.getElementById(id);

// Safe RFC4122 UUID generator that works on both HTTPS and plain HTTP over IP (EC2)
function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Single-workspace conversation identifier, not an authentication token.
let conversationId = sessionStorage.getItem('atlas_conversation_id') || generateUUID();
sessionStorage.setItem('atlas_conversation_id', conversationId);

function startNewChat() {
  conversationId = generateUUID();
  sessionStorage.setItem('atlas_conversation_id', conversationId);
  $('messages').replaceChildren();
  const hero = document.querySelector('.hero');
  if (hero) hero.style.display = 'block';
  document.querySelectorAll('.chat-history-item').forEach(el => el.classList.remove('active'));
  toast('Started a new conversation');
}

$('newChat').onclick = startNewChat;
const sidebarNewBtn = $('sidebarNewChat');
if (sidebarNewBtn) sidebarNewBtn.onclick = () => { view('chat'); startNewChat() };

async function resumeConversation(id) {
  conversationId = id;
  sessionStorage.setItem('atlas_conversation_id', id);
  $('messages').replaceChildren();

  document.querySelectorAll('.chat-history-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });

  try {
    const r = await api(`/api/conversations/${encodeURIComponent(id)}/messages`);
    const hero = document.querySelector('.hero');
    if (r.messages && r.messages.length > 0) {
      if (hero) hero.style.display = 'none';
      r.messages.forEach(m => {
        let sources = [];
        if (m.sources) {
          try {
            sources = typeof m.sources === 'string' ? JSON.parse(m.sources) : m.sources;
          } catch (_) { sources = [] }
        }
        addMessage(m.content, m.role, sources);
      });
    } else {
      if (hero) hero.style.display = 'block';
    }
  } catch (err) {
    console.error('Failed to resume conversation:', err);
    toast('Could not resume conversation: ' + err.message);
  }
}

async function loadRecentChats() {
  const container = $('recentChatsList');
  if (!container) return;
  try {
    const res = await api('/api/conversations');
    const conversations = res.conversations || [];
    if (!conversations.length) {
      container.innerHTML = '<div class="chat-history-empty">No past conversations</div>';
      return;
    }
    container.replaceChildren(...conversations.map(c => {
      const item = document.createElement('div');
      item.className = 'chat-history-item' + (c.conversation_id === conversationId ? ' active' : '');
      item.dataset.id = c.conversation_id;

      const title = document.createElement('span');
      title.className = 'chat-history-title';
      title.textContent = c.title || 'Untitled conversation';
      title.title = c.title || 'Conversation';
      item.append(title);

      const del = document.createElement('button');
      del.className = 'chat-history-delete';
      del.innerHTML = '&times;';
      del.title = 'Delete conversation';
      del.onclick = async ev => {
        ev.stopPropagation();
        if (!confirm('Delete this conversation?')) return;
        try {
          await api(`/api/conversations/${encodeURIComponent(c.conversation_id)}`, { method: 'DELETE' });
          toast('Conversation deleted');
          if (conversationId === c.conversation_id) {
            startNewChat();
          }
          loadRecentChats();
        } catch (err) {
          toast(err.message);
        }
      };
      item.append(del);

      item.onclick = () => {
        view('chat');
        resumeConversation(c.conversation_id);
      };
      return item;
    }));
  } catch (err) {
    console.error('Error loading recent chats:', err);
  }
}

const toast = msg => { const el = $('toast'); el.textContent = msg; el.style.display = 'block'; setTimeout(() => el.style.display = 'none', 4000) };
const api = async (path, options = {}) => {
  const res = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  let data;
  try {
    data = await res.json();
  } catch (_) {
    throw Error(res.statusText || `Request failed with status ${res.status}`);
  }
  if (!res.ok) throw Error(data.detail || data.message || 'Request failed');
  return data;
};
function view(name) { ['chat', 'docs', 'approval', 'admin'].forEach(x => { $(x + 'View').classList.toggle('hidden', x !== name); $(x + 'Tab').classList.toggle('active', x === name) }); $('heading').textContent = { chat: 'Ask your organization\'s knowledge', docs: 'Document management', approval: 'Approval requests', admin: 'Operational overview' }[name]; if (name === 'docs') loadDocs(); if (name === 'admin') loadMetrics(); if (name === 'approval') loadApprovals() }
$('chatTab').onclick = () => view('chat'); $('docsTab').onclick = () => view('docs'); $('adminTab').onclick = () => view('admin'); $('approvalTab').onclick = () => view('approval'); $('refreshApprovals').onclick = loadApprovals;
function addMessage(content, kind, sources = []) { const el = document.createElement('div'); el.className = 'message ' + kind; el.textContent = content; if (sources.length) { const wrap = document.createElement('div'); wrap.className = 'sources'; sources.forEach(s => { const d = document.createElement('details'); const title = document.createElement('summary'); title.textContent = `[${s.index}] ${s.title} — page ${s.page}`; const excerpt = document.createElement('p'); excerpt.textContent = s.excerpt; d.append(title, excerpt); wrap.append(d) }); el.append(wrap); const feedback = document.createElement('button'); feedback.textContent = '👍 Helpful'; feedback.onclick = async () => { try { await api('/api/feedback', { method: 'POST', body: JSON.stringify({ rating: 1 }) }); toast('Feedback saved') } catch (e) { toast(e.message) } }; el.append(feedback) } $('messages').append(el); $('messages').scrollTo({ top: $('messages').scrollHeight, behavior: 'smooth' }) }
$('chatForm').onsubmit = async e => { e.preventDefault(); const q = $('question').value.trim(); if (!q) return; const hero = document.querySelector('.hero'); if (hero) hero.style.display = 'none'; addMessage(q, 'user'); $('question').value = ''; addMessage('Searching approved documents...', 'assistant'); const loading = $('messages').lastElementChild; try { const r = await api('/api/chat', { method: 'POST', body: JSON.stringify({ question: q, conversation_id: conversationId }) }); loading.remove(); addMessage(r.answer, 'assistant', r.sources); if (r.status === 'pending_approval') { const btn = document.createElement('button'); btn.textContent = 'Review approval request →'; btn.onclick = () => view('approval'); $('messages').lastElementChild.append(btn) } loadRecentChats() } catch (err) { loading.textContent = err.message } };
document.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { $('question').value = b.dataset.q; $('question').focus() });
async function loadDocs() { try { const r = await api('/api/documents'); $('docs').replaceChildren(...r.documents.map(d => { const row = document.createElement('div'); row.textContent = `${d.title} — ${d.status} (v${d.current_version})`; return row })) } catch (e) { $('docs').textContent = e.message } }
async function loadMetrics() { try { $('metrics').textContent = JSON.stringify(await api('/api/admin/metrics'), null, 2); $('guardrailMetrics').textContent = JSON.stringify(await api('/api/admin/guardrails'), null, 2) } catch (e) { $('metrics').textContent = e.message } }
$('uploadForm').onsubmit = async e => { e.preventDefault(); const f = $('file').files[0]; if (!f) return; if (f.size > 10485760) { toast('Maximum file size is 10 MB'); return } try { const r = await api('/api/documents/uploads', { method: 'POST', body: JSON.stringify({ filename: f.name }) }); const up = await fetch(r.upload_url, { method: 'PUT', headers: r.headers, body: f }); if (!up.ok) throw Error('S3 upload failed'); toast('Uploaded to S3. Processing document now...'); await api('/api/documents/complete', { method: 'POST', body: JSON.stringify({ document_id: r.document_id }) }); toast('Document indexed in Pinecone!'); loadDocs() } catch (err) { toast(err.message) } };

// Admin approval workflow. DOM nodes use textContent (never untrusted innerHTML).
async function loadApprovals() {
  const root = $('approvalList'); root.textContent = 'Loading approvals...';
  try {
    const response = await api('/api/approvals');
    if (!Array.isArray(response.approvals)) throw Error('Unexpected API response: approvals list missing');
    const approvals = response.approvals;
    const pending = approvals.filter(a => String(a.status).trim().toLowerCase() === 'pending').length;
    $('approvalSummary').textContent = `${pending} pending · ${approvals.length} total (most recent 100)`;
    root.replaceChildren();
    if (!approvals.length) { root.textContent = 'No approval requests yet. Try asking the chatbot to delete a document.'; return }
    for (const a of approvals) {
      const card = document.createElement('article'); card.className = 'approval-card';
      const header = document.createElement('div'); header.className = 'approval-header';
      const title = document.createElement('strong'); title.textContent = a.question;
      const badge = document.createElement('span'); badge.className = 'approval-status ' + a.status; badge.textContent = a.status;
      header.append(title, badge); card.append(header);
      const meta = document.createElement('p'); meta.textContent = `Requested by ${a.requester} · ${new Date(a.created_at).toLocaleString()}`; card.append(meta);
      if (String(a.status).trim().toLowerCase() === 'pending') {
        const actions = document.createElement('div'); actions.className = 'approval-actions';
        for (const [label, approve] of [['Approve', true], ['Reject', false]]) {
          const button = document.createElement('button'); button.textContent = label; button.className = approve ? 'approve-button' : 'reject-button';
          button.onclick = async () => {
            const decision = approve ? 'approve' : 'reject';
            if (!confirm(`Are you sure you want to ${decision} this request? This records a decision only and does not execute the requested action.`)) return;
            button.disabled = true;
            try { const r = await api(`/api/approvals/${encodeURIComponent(a.id)}/decision`, { method: 'POST', body: JSON.stringify({ approve }) }); toast(`Request ${r.status}. No action executed.`); await loadApprovals() }
            catch (e) { toast(e.message); button.disabled = false }
          };
          actions.append(button);
        }
        card.append(actions);
      } else {
        const info = document.createElement('p'); info.textContent = `Reviewed by ${a.reviewer || 'unknown'} · ${a.reviewed_at ? new Date(a.reviewed_at).toLocaleString() : ''} · No action executed`; card.append(info);
      }
      root.append(card);
    }
  } catch (e) { root.textContent = `Unable to load approvals: ${e.message}. Check /api/approvals and your Uvicorn terminal.`; console.error('Approvals loading failed:', e) }
}

// Initial bootstrap: load recent chats and resume current session
loadRecentChats();
if (conversationId) {
  resumeConversation(conversationId);
}
