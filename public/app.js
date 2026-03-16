// ── Brain Link Desktop ──
const GATEWAY_URL = location.origin;
let GATEWAY_KEY = '';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

// Auto-fetch config + synced settings from gateway
fetch(GATEWAY_URL + '/api/config').then(function(r) { return r.json(); }).then(function(c) {
  GATEWAY_KEY = c.gatewayKey || '';
}).catch(function() { console.log('Config fetch failed'); });

fetch(GATEWAY_URL + '/api/sync').then(function(r) { return r.json(); }).then(function(s) {
  if (s.logins && s.logins.length > 0) logins = s.logins;
  if (s.rules && s.rules.length > 0) rules = s.rules;
  if (s.settings) {
    if (s.settings.rate !== undefined) speechRate = s.settings.rate;
    if (s.settings.pitch !== undefined) speechPitch = s.settings.pitch;
    if (s.settings.temp !== undefined) temperature = s.settings.temp;
    if (s.settings.voice !== undefined) selectedVoice = s.settings.voice;
  }
}).catch(function() {});

function syncToGateway() {
  fetch(GATEWAY_URL + '/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ logins: logins, rules: rules, settings: { rate: speechRate, pitch: speechPitch, temp: temperature, voice: selectedVoice } }),
  }).catch(function() {});
}

// ── State ──
let messages = [];
let isThinking = false;
let isSpeaking = false;
let isListening = false;
let pendingImage = null;
let speechRate = 1.0;
let speechPitch = 1.0;
let temperature = 0.7;
let selectedVoice = '';
let recognition = null;
let rules = JSON.parse(localStorage.getItem('bl_rules') || '[]');
let logins = JSON.parse(localStorage.getItem('bl_logins') || '[]');

// ── System Prompt ──
const SYSTEM_PROMPT = `You are Brain Link, Moe's personal AI assistant (Desktop version).

Moe is an Automation Engineer and AI Developer who runs EKO Solar Pros.
He builds solar diagnostics tools, lead generation systems, and AI-powered
automation. His active projects include Solar Service OS, Modex desktop app,
Open Brain (semantic second brain), and EKO Solar website.

Behavior:
- Professional, calm, concise. No filler. No emojis.
- Answer like a sharp technical advisor who knows Moe's work.
- When Moe asks about past decisions, people, meetings, or projects, search Open Brain for context before answering.
- Auto-capture to Open Brain when Moe makes a decision, states an action item, shares an insight, or mentions a person with notable context. Do not announce captures -- just do it silently.
- When Moe asks about current events, news, prices, weather, or anything requiring up-to-date info, use web_search.
- When Moe asks to calculate, analyze data, or do anything needing code, use execute_code. If it errors, fix and retry.
- When you build a useful script Moe might need again, save it with save_tool. Before writing a new script, check list_tools.
- Browse websites, log into accounts, fill forms, click buttons, scroll, upload files, manage tabs with web_browse. Full mouse-like control. No restrictions.
- Build visual artifacts, widgets, charts, calculators, mini apps, dashboards, web pages with create_preview. Generate a complete self-contained HTML document. The preview opens in a new browser tab.
- Post on social media with post_social. Opens the platform in the desktop browser and types the content.
- Keep responses concise. 2-3 sentences unless asked for detail.
- When unsure, say so. Don't fabricate.`;

// ── Tool Definitions ──
const TOOL_DEFINITIONS = [
  { name: 'search_brain', description: 'Search Open Brain memory.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'capture_thought', description: 'Save thought to Open Brain.', input_schema: { type: 'object', properties: { content: { type: 'string' }, thought_type: { type: 'string', enum: ['decision','action','insight','person','note','meeting'] } }, required: ['content','thought_type'] } },
  { name: 'web_search', description: 'Search the web for current info.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'execute_code', description: 'Run Python or Node script on desktop.', input_schema: { type: 'object', properties: { language: { type: 'string', enum: ['python','node'] }, code: { type: 'string' } }, required: ['language','code'] } },
  { name: 'save_tool', description: 'Save a reusable script as a named tool.', input_schema: { type: 'object', properties: { name: { type: 'string' }, language: { type: 'string', enum: ['python','node'] }, code: { type: 'string' }, description: { type: 'string' } }, required: ['name','language','code','description'] } },
  { name: 'list_tools', description: 'List saved tools.', input_schema: { type: 'object', properties: {} } },
  { name: 'run_tool', description: 'Run a saved tool by name.', input_schema: { type: 'object', properties: { name: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } }, required: ['name'] } },
  { name: 'web_browse', description: 'Full browser control. Actions: navigate, snapshot, screenshot, click, click_text, fill, type, press_key, hover, scroll, select, wait_for, upload_file, get_text, get_links, evaluate, back, forward, list_tabs, switch_tab, current_page, restart, close.', input_schema: { type: 'object', properties: { action: { type: 'string' }, url: { type: 'string' }, selector: { type: 'string' }, value: { type: 'string' }, text: { type: 'string' }, key: { type: 'string' }, code: { type: 'string' }, direction: { type: 'string' }, amount: { type: 'number' }, index: { type: 'number' }, filePath: { type: 'string' } }, required: ['action'] } },
  { name: 'get_login', description: 'Get saved login for a site.', input_schema: { type: 'object', properties: { site: { type: 'string' } }, required: ['site'] } },
  { name: 'create_preview', description: 'Create an interactive HTML/CSS/JS artifact and open it in a new browser tab. Use when Moe asks to build something visual, create a widget, chart, calculator, mini app, dashboard, landing page, or any interactive code output. Generate a complete self-contained HTML document with premium design quality.', input_schema: { type: 'object', properties: { title: { type: 'string', description: 'Title of the artifact' }, html: { type: 'string', description: 'Complete self-contained HTML document with inline CSS and JS' }, description: { type: 'string', description: 'Brief description' } }, required: ['title', 'html'] } },
  { name: 'post_social', description: 'Post content to social media. Opens the platform in the desktop browser, clicks the composer, and types the content. Moe reviews and clicks Post.', input_schema: { type: 'object', properties: { platform: { type: 'string', enum: ['facebook','instagram','twitter','linkedin'] }, content: { type: 'string' }, image_url: { type: 'string' } }, required: ['platform','content'] } },
  { name: 'manage_instructions', description: 'Manage standing instructions. Use when Moe says "always...", "from now on...", "add a rule...", "list instructions", "remove instruction".', input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['add','list','remove'] }, instruction: { type: 'string' }, index: { type: 'number' } }, required: ['action'] } },
  { name: 'code_task', description: 'Send a code task to the local agent gateway for diagnosis, fixing, or review. Available repos: solar-service-os, modex.', input_schema: { type: 'object', properties: { type: { type: 'string', enum: ['diagnose','fix','investigate','test','review'] }, repo: { type: 'string' }, description: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['type','repo','description'] } },
  { name: 'github', description: 'Interact with GitHub repos. Moe\'s GitHub: mrmoe28.', input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['list_repos','get_repo','list_issues','create_issue','list_prs','get_file','search_code'] }, repo: { type: 'string' }, path: { type: 'string' }, query: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } }, required: ['action'] } },
];

// ── Gateway helpers ──
async function gw(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', 'X-Gateway-Key': GATEWAY_KEY } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(GATEWAY_URL + path, opts);
  return res.json();
}

// ── Truncate helper ──
function truncate(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n[Truncated — ' + text.length + ' chars total]';
}

// ── Trim messages to stay under token limits ──
function trimMessages(msgs) {
  // Rough estimate: 4 chars per token, keep under 150k tokens = 600k chars
  var total = 0;
  for (var i = 0; i < msgs.length; i++) {
    var c = msgs[i].content;
    total += typeof c === 'string' ? c.length : JSON.stringify(c).length;
  }
  while (total > 500000 && msgs.length > 2) {
    var removed = msgs.shift();
    var len = typeof removed.content === 'string' ? removed.content.length : JSON.stringify(removed.content).length;
    total -= len;
  }
  return msgs;
}

// ── Tool execution ──
async function executeTool(tool) {
  try {
    if (tool.name === 'execute_code') {
      const r = await gw('POST', '/api/execute', { language: tool.input.language, code: tool.input.code });
      let out = '';
      if (r.stdout) out += r.stdout;
      if (r.stderr) out += (out ? '\n' : '') + 'STDERR: ' + r.stderr;
      if (r.timedOut) out += '\n[Timed out]';
      if (r.exitCode && r.exitCode !== 0) out += '\n[Exit: ' + r.exitCode + ']';
      return truncate(out, 4000) || 'No output.';
    }
    if (tool.name === 'save_tool') return JSON.stringify(await gw('POST', '/api/execute/tools', tool.input));
    if (tool.name === 'list_tools') return JSON.stringify(await gw('GET', '/api/execute/tools'));
    if (tool.name === 'run_tool') return JSON.stringify(await gw('POST', '/api/execute/tools/' + tool.input.name + '/run', { args: tool.input.args || [] }));
    if (tool.name === 'web_browse') return truncate(JSON.stringify(await gw('POST', '/api/browse', tool.input)), 4000);
    if (tool.name === 'create_preview') {
      lastPreviewHtml = tool.input.html;
      showPreview(tool.input.title, tool.input.html);
      return 'Preview created: ' + tool.input.title + '. ' + (tool.input.description || '');
    }
    if (tool.name === 'post_social') {
      var urls = { facebook: 'https://www.facebook.com', instagram: 'https://www.instagram.com', twitter: 'https://twitter.com/compose/tweet', linkedin: 'https://www.linkedin.com/feed/' };
      var platform = tool.input.platform || 'facebook';
      var navR = await gw('POST', '/api/browse', { action: 'navigate', url: urls[platform] || urls.facebook });
      if (navR.error) return 'Failed to open ' + platform + ': ' + navR.error + '. Content:\n\n' + tool.input.content;
      await new Promise(function(r) { setTimeout(r, 2000); });
      // Try to click composer and type
      if (platform === 'facebook') {
        await gw('POST', '/api/browse', { action: 'click', selector: 'div[role="textbox"][contenteditable="true"], [aria-label*="on your mind"]' });
        await new Promise(function(r) { setTimeout(r, 1500); });
        await gw('POST', '/api/browse', { action: 'evaluate', code: 'var e=document.querySelector(\'div[role="textbox"][contenteditable="true"]\');if(e){e.focus();document.execCommand("insertText",false,' + JSON.stringify(tool.input.content) + ')}' });
      } else if (platform === 'twitter') {
        await gw('POST', '/api/browse', { action: 'click', selector: 'div[role="textbox"]' });
        await new Promise(function(r) { setTimeout(r, 500); });
        await gw('POST', '/api/browse', { action: 'evaluate', code: 'var e=document.querySelector(\'div[role="textbox"]\');if(e){e.focus();document.execCommand("insertText",false,' + JSON.stringify(tool.input.content) + ')}' });
      } else if (platform === 'linkedin') {
        await gw('POST', '/api/browse', { action: 'click', selector: 'button.share-box-feed-entry__trigger, div.share-box-feed-entry__closed-share-box' });
        await new Promise(function(r) { setTimeout(r, 1500); });
        await gw('POST', '/api/browse', { action: 'evaluate', code: 'var e=document.querySelector(\'div[role="textbox"], div.ql-editor\');if(e){e.focus();document.execCommand("insertText",false,' + JSON.stringify(tool.input.content) + ')}' });
      }
      return 'Typed post into ' + platform + ' composer. Moe needs to review and click Post.\n\n' + tool.input.content;
    }
    if (tool.name === 'web_search') return 'Web search requires Perplexity API. Not available in desktop mode.';
    if (tool.name === 'search_brain') {
      var sr = await gw('POST', '/api/brain/search', { query: tool.input.query });
      return sr.results || 'No results.';
    }
    if (tool.name === 'capture_thought') {
      var cr = await gw('POST', '/api/brain/capture', { content: tool.input.content, thought_type: tool.input.thought_type });
      return cr.ok ? 'Captured.' : 'Capture failed.';
    }
    if (tool.name === 'get_login') {
      const site = (tool.input.site || '').toLowerCase();
      const match = logins.find(function(l) { return site.includes(l.site.toLowerCase()) || l.site.toLowerCase().includes(site); });
      if (!match) return 'No saved login for "' + tool.input.site + '".';
      return JSON.stringify({ username: match.username, password: match.password });
    }
    if (tool.name === 'manage_instructions') {
      if (tool.input.action === 'add' && tool.input.instruction) {
        rules.push(tool.input.instruction); syncToGateway();
        return 'Standing instruction added: "' + tool.input.instruction + '"';
      }
      if (tool.input.action === 'list') return rules.length === 0 ? 'No standing instructions.' : rules.map(function(r,i) { return (i+1) + '. ' + r; }).join('\n');
      if (tool.input.action === 'remove') {
        var idx = (tool.input.index || 1) - 1;
        if (idx < 0 || idx >= rules.length) return 'Invalid index.';
        var removed = rules.splice(idx, 1)[0]; syncToGateway();
        return 'Removed: "' + removed + '"';
      }
      return 'Unknown action.';
    }
    if (tool.name === 'code_task') {
      return truncate(JSON.stringify(await gw('POST', '/api/tasks', { type: tool.input.type, repo: tool.input.repo, description: tool.input.description, files: tool.input.files })), 4000);
    }
    if (tool.name === 'github') {
      // Proxy github operations through execute_code
      var ghCode = 'import subprocess, json, sys\nr = subprocess.run(["gh"';
      if (tool.input.action === 'list_repos') ghCode += ',"repo","list","mrmoe28","--json","name,description","--limit","20"';
      else if (tool.input.action === 'get_repo') ghCode += ',"repo","view","mrmoe28/' + (tool.input.repo||'') + '","--json","name,description,url,defaultBranchRef"';
      else if (tool.input.action === 'list_issues') ghCode += ',"issue","list","-R","mrmoe28/' + (tool.input.repo||'') + '","--json","number,title,state","--limit","10"';
      else if (tool.input.action === 'list_prs') ghCode += ',"pr","list","-R","mrmoe28/' + (tool.input.repo||'') + '","--json","number,title,state","--limit","10"';
      else if (tool.input.action === 'search_code') ghCode += ',"search","code","' + (tool.input.query||'') + '","--owner","mrmoe28","--json","path,repository","--limit","10"';
      else return 'Unknown github action.';
      ghCode += '], capture_output=True, text=True)\nprint(r.stdout or r.stderr)';
      var ghR = await gw('POST', '/api/execute', { language: 'python', code: ghCode });
      return truncate(ghR.stdout || ghR.stderr || 'No output.', 4000);
    }
    return 'Unknown tool: ' + tool.name;
  } catch (err) {
    return 'Tool error: ' + err.message;
  }
}

// ── Claude API ──
var useSonnet = false;
async function callClaude(msgs) {
  let sys = SYSTEM_PROMPT;
  if (rules.length > 0) sys += '\n\nStanding instructions:\n' + rules.map(function(r) { return '- ' + r; }).join('\n');
  if (logins.length > 0) sys += '\n\nSaved logins:\n' + logins.map(function(l) { return '- ' + l.site + ': user="' + l.username + '"'; }).join('\n');
  if (msgs.length <= 1) {
    try {
      const tl = await gw('GET', '/api/execute/tools');
      if (tl.tools && tl.tools.length > 0) sys += '\n\nSaved tools:\n' + tl.tools.map(function(t) { return '- ' + t.name + ' (' + t.language + '): ' + t.description; }).join('\n');
    } catch(e) {}
  }
  msgs = trimMessages(msgs);
  const res = await fetch(GATEWAY_URL + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: useSonnet ? 'claude-sonnet-4-20250514' : CLAUDE_MODEL, max_tokens: useSonnet ? 16000 : 4096, temperature: temperature, system: sys, tools: TOOL_DEFINITIONS, messages: msgs }),
  });
  if (!res.ok) throw new Error('Claude ' + res.status + ': ' + (await res.text()));
  return res.json();
}

// ── Send message ──
async function sendMsg() {
  var inputEl = document.getElementById('input');
  var text = inputEl.value.trim();
  if (!text && !pendingImage) return;
  if (isThinking) return;
  inputEl.value = '';

  var userContent, displayText = text || 'Image uploaded', imgDataUrl = null;
  if (pendingImage) {
    userContent = [
      { type: 'image', source: { type: 'base64', media_type: pendingImage.mime, data: pendingImage.base64 } },
      { type: 'text', text: (text || 'What do you see in this image?') + (pendingImage.savedPath ? '\n[Image saved at: ' + pendingImage.savedPath + ']' : '') },
    ];
    imgDataUrl = pendingImage.dataUrl;
    clearPendingImage();
  } else {
    userContent = text;
  }

  // Use Sonnet for code/design tasks
  var lower = (typeof userContent === 'string' ? userContent : displayText).toLowerCase();
  useSonnet = /build|create|make|generate|design|calculator|dashboard|chart|widget|app|preview|artifact|code|page|website|landing/.test(lower);

  addMessage('user', displayText, imgDataUrl);
  messages.push({ role: 'user', content: userContent });

  isThinking = true;
  updateMicBtn();
  showThinking('Thinking...');

  try {
    var response = await callClaude(messages);
    var loops = 12;
    while (response.stop_reason === 'tool_use' && loops > 0) {
      loops--;
      var toolBlocks = response.content.filter(function(b) { return b.type === 'tool_use'; });
      showThinking('Running ' + toolBlocks.map(function(t) { return t.name; }).join(', ') + '...');
      var toolResults = [];
      for (var i = 0; i < toolBlocks.length; i++) {
        var result = await executeTool(toolBlocks[i]);
        toolResults.push({ type: 'tool_result', tool_use_id: toolBlocks[i].id, content: result });
      }
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });
      response = await callClaude(messages);
    }
    var textBlocks = response.content.filter(function(b) { return b.type === 'text'; });
    var reply = textBlocks.map(function(b) { return b.text; }).join('') || 'No response.';
    // Only store text blocks — orphaned tool_use blocks break the next API call
    var cleanContent = response.content.filter(function(b) { return b.type === 'text'; });
    messages.push({ role: 'assistant', content: cleanContent.length > 0 ? cleanContent : reply });
    hideThinking();
    addMessage('assistant', reply);
    speak(reply);
  } catch (err) {
    hideThinking();
    addMessage('assistant', 'Error: ' + err.message);
  } finally {
    isThinking = false;
    updateMicBtn();
  }
}

// ── UI helpers ──
function addMessage(role, text, imgDataUrl) {
  var chat = document.getElementById('chat');
  var div = document.createElement('div');
  div.className = 'msg msg-' + role;
  var roleLabel = document.createElement('div');
  roleLabel.className = 'msg-role msg-role-' + role;
  roleLabel.textContent = role === 'user' ? 'YOU' : 'BRAIN LINK';
  div.appendChild(roleLabel);
  if (imgDataUrl) {
    var img = document.createElement('img');
    img.className = 'msg-img';
    img.src = imgDataUrl;
    div.appendChild(img);
  }
  var textEl = document.createElement('div');
  textEl.className = 'msg-text';
  textEl.textContent = text;
  div.appendChild(textEl);
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function showThinking(text) {
  var el = document.getElementById('thinkingEl');
  if (!el) { el = document.createElement('div'); el.id = 'thinkingEl'; el.className = 'thinking'; document.getElementById('chat').appendChild(el); }
  el.textContent = text;
  document.getElementById('chat').scrollTop = document.getElementById('chat').scrollHeight;
}
function hideThinking() { var el = document.getElementById('thinkingEl'); if (el) el.remove(); }
function newSession() { messages = []; document.getElementById('chat').textContent = ''; }

// ── Voice ──
function toggleMic() {
  if (isListening) { if (recognition) recognition.stop(); return; }
  if (isSpeaking) { speechSynthesis.cancel(); isSpeaking = false; updateMicBtn(); return; }
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) { alert('Use Chrome for speech.'); return; }
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = 'en-US'; recognition.interimResults = true; recognition.continuous = false;
  recognition.onresult = function(e) {
    var t = Array.from(e.results).map(function(r) { return r[0].transcript; }).join('');
    document.getElementById('input').value = t;
    if (e.results[e.results.length - 1].isFinal) { isListening = false; updateMicBtn(); sendMsg(); }
  };
  recognition.onend = function() { isListening = false; updateMicBtn(); };
  recognition.onerror = function() { isListening = false; updateMicBtn(); };
  recognition.start();
  isListening = true;
  updateMicBtn();
}

function speak(text) {
  if (!window.speechSynthesis) return;
  var clean = text.replace(/```[\s\S]*?```/g, '').replace(/\[.*?\]/g, '').replace(/#{1,6}\s*/g, '').replace(/\*{1,3}(.*?)\*{1,3}/g, '$1').replace(/_{1,2}(.*?)_{1,2}/g, '$1').replace(/`([^`]*)`/g, '$1').replace(/^[-*]\s+/gm, '').replace(/[*#_~`>|]/g, '').replace(/\n{2,}/g, '. ').replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 500);
  var u = new SpeechSynthesisUtterance(clean);
  u.rate = speechRate;
  u.pitch = speechPitch;
  if (selectedVoice) {
    var voices = speechSynthesis.getVoices();
    var match = voices.find(function(v) { return v.name === selectedVoice; });
    if (match) u.voice = match;
  }
  isSpeaking = true; updateMicBtn();
  u.onend = function() { isSpeaking = false; updateMicBtn(); };
  u.onerror = function() { isSpeaking = false; updateMicBtn(); };
  speechSynthesis.speak(u);
}

function updateMicBtn() {
  var btn = document.getElementById('micBtn');
  btn.className = 'mic-btn' + (isListening ? ' listening' : isThinking ? ' thinking' : isSpeaking ? ' speaking' : '');
  btn.textContent = isListening ? 'MIC' : isThinking ? '...' : isSpeaking ? 'STOP' : 'MIC';
}

// ── Image ──
function pickImage() {
  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = async function(ev) {
      var dataUrl = ev.target.result;
      var base64 = dataUrl.split(',')[1];
      var mime = file.type || 'image/jpeg';
      pendingImage = { base64: base64, mime: mime, dataUrl: dataUrl };
      document.getElementById('pendingImg').style.display = 'flex';
      document.getElementById('pendingImgPreview').src = dataUrl;
      document.getElementById('pendingImgLabel').textContent = 'Uploading...';
      try {
        var ext = mime.split('/')[1] || 'jpg';
        var r = await gw('POST', '/api/execute/upload', { base64: base64, filename: 'upload-' + Date.now() + '.' + ext });
        if (r.path) { pendingImage.savedPath = r.path; document.getElementById('pendingImgLabel').textContent = 'Image ready. Type what to do with it.'; }
      } catch(err) { document.getElementById('pendingImgLabel').textContent = 'Image ready (local only).'; }
    };
    reader.readAsDataURL(file);
  };
  inp.click();
}
function clearPendingImage() { pendingImage = null; document.getElementById('pendingImg').style.display = 'none'; }

// ── Sidebar ──
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('overlay').classList.add('open');
  // Pull latest sync data
  fetch(GATEWAY_URL + '/api/sync').then(function(r) { return r.json(); }).then(function(s) {
    if (s.logins) logins = s.logins;
    if (s.rules) rules = s.rules;
    if (s.settings) {
      if (s.settings.rate !== undefined) speechRate = s.settings.rate;
      if (s.settings.pitch !== undefined) speechPitch = s.settings.pitch;
      if (s.settings.temp !== undefined) temperature = s.settings.temp;
      if (s.settings.voice !== undefined) selectedVoice = s.settings.voice;
    }
  }).catch(function() {});
  showTabContent('tools');
  var tabs = document.getElementById('sidebarTabs');
  tabs.textContent = '';
  ['Tools','Rules','Logins','GitHub','Settings'].forEach(function(name) {
    var b = document.createElement('button');
    b.className = 'tab-btn' + (name === 'Tools' ? ' active' : '');
    b.textContent = name;
    b.onclick = function() {
      tabs.querySelectorAll('.tab-btn').forEach(function(t) { t.classList.remove('active'); });
      b.classList.add('active');
      showTabContent(name.toLowerCase());
    };
    tabs.appendChild(b);
  });
}
function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('overlay').classList.remove('open'); }

async function showTabContent(tab) {
  var panel = document.getElementById('sidebarPanel');
  panel.textContent = '';
  if (tab === 'tools') {
    panel.textContent = 'Loading...';
    try {
      var data = await gw('GET', '/api/execute/tools');
      panel.textContent = '';
      var toolsList = data.tools || [];
      if (toolsList.length === 0) { panel.textContent = 'No tools yet. Ask Brain Link to build one.'; return; }
      toolsList.forEach(function(t) {
        var card = document.createElement('div'); card.className = 'card';
        var hdr = document.createElement('div'); hdr.className = 'card-header';
        var nm = document.createElement('span'); nm.className = 'card-name'; nm.textContent = t.name; hdr.appendChild(nm);
        var bdg = document.createElement('span'); bdg.className = 'card-badge'; bdg.textContent = t.language; hdr.appendChild(bdg);
        card.appendChild(hdr);
        var desc = document.createElement('div'); desc.className = 'card-desc'; desc.textContent = t.description; card.appendChild(desc);
        var acts = document.createElement('div'); acts.className = 'card-actions';
        var runB = document.createElement('button'); runB.className = 'card-btn card-btn-run'; runB.textContent = 'Run';
        runB.onclick = async function() { var r = await gw('POST', '/api/execute/tools/' + t.name + '/run', { args: [] }); alert(t.name + ':\n' + (r.stdout || r.stderr || 'No output').slice(0, 500)); };
        acts.appendChild(runB);
        var delB = document.createElement('button'); delB.className = 'card-btn card-btn-del'; delB.textContent = 'Delete';
        delB.onclick = async function() { if (!confirm('Delete "' + t.name + '"?')) return; await gw('DELETE', '/api/execute/tools/' + t.name); showTabContent('tools'); };
        acts.appendChild(delB);
        card.appendChild(acts);
        panel.appendChild(card);
      });
    } catch(e) { panel.textContent = 'Gateway unreachable.'; }
  } else if (tab === 'rules') {
    var desc = document.createElement('p'); desc.style.cssText = 'color:#999;font-size:13px;margin-bottom:16px'; desc.textContent = "Rules that shape Brain Link's behavior."; panel.appendChild(desc);
    var row = document.createElement('div'); row.className = 'add-row';
    var inp = document.createElement('input'); inp.className = 'add-input'; inp.placeholder = 'Add a rule...'; row.appendChild(inp);
    var addB = document.createElement('button'); addB.className = 'add-btn'; addB.textContent = 'Add';
    addB.onclick = function() { var v = inp.value.trim(); if (!v) return; rules.push(v); syncToGateway(); showTabContent('rules'); };
    row.appendChild(addB); panel.appendChild(row);
    if (rules.length === 0) { var em = document.createElement('div'); em.style.cssText = 'text-align:center;padding:30px;color:#555'; em.textContent = 'No rules yet.'; panel.appendChild(em); }
    else rules.forEach(function(r, i) {
      var card = document.createElement('div'); card.className = 'card'; card.style.display = 'flex'; card.style.flexDirection = 'row'; card.style.alignItems = 'flex-start'; card.style.gap = '10px';
      var num = document.createElement('span'); num.style.cssText = 'color:#4FC3F7;font-size:13px;font-weight:700'; num.textContent = (i+1); card.appendChild(num);
      var txt = document.createElement('span'); txt.style.cssText = 'color:#ccc;font-size:13px;flex:1'; txt.textContent = r; card.appendChild(txt);
      var del = document.createElement('button'); del.style.cssText = 'background:none;border:none;color:#666;font-size:14px;cursor:pointer;padding:4px'; del.textContent = 'X';
      del.onclick = function() { rules.splice(i, 1); syncToGateway(); showTabContent('rules'); };
      card.appendChild(del); panel.appendChild(card);
    });
  } else if (tab === 'logins') {
    var desc = document.createElement('p'); desc.style.cssText = 'color:#999;font-size:13px;margin-bottom:16px'; desc.textContent = 'Saved credentials for sites Brain Link logs into.'; panel.appendChild(desc);
    var form = document.createElement('div'); form.className = 'login-form';
    var siteI = document.createElement('input'); siteI.placeholder = 'Site (e.g. facebook)'; form.appendChild(siteI);
    var userI = document.createElement('input'); userI.placeholder = 'Username or email'; form.appendChild(userI);
    var passI = document.createElement('input'); passI.placeholder = 'Password'; passI.type = 'password'; form.appendChild(passI);
    var saveB = document.createElement('button'); saveB.className = 'add-btn'; saveB.textContent = 'Save Login';
    saveB.onclick = function() { var s=siteI.value.trim(),u=userI.value.trim(),p=passI.value.trim(); if(!s||!u||!p) return; logins.push({site:s,username:u,password:p}); syncToGateway(); showTabContent('logins'); };
    form.appendChild(saveB); panel.appendChild(form);
    if (logins.length === 0) { var em = document.createElement('div'); em.style.cssText = 'text-align:center;padding:30px;color:#555'; em.textContent = 'No logins saved.'; panel.appendChild(em); }
    else logins.forEach(function(l, i) {
      var card = document.createElement('div'); card.className = 'card'; card.style.display = 'flex'; card.style.flexDirection = 'row'; card.style.alignItems = 'center';
      var info = document.createElement('div'); info.style.flex = '1';
      var site = document.createElement('div'); site.style.cssText = 'color:#4FC3F7;font-size:14px;font-weight:700'; site.textContent = l.site; info.appendChild(site);
      var user = document.createElement('div'); user.style.cssText = 'color:#999;font-size:12px'; user.textContent = l.username; info.appendChild(user);
      card.appendChild(info);
      var del = document.createElement('button'); del.style.cssText = 'background:none;border:none;color:#666;font-size:14px;cursor:pointer;padding:8px'; del.textContent = 'X';
      del.onclick = function() { logins.splice(i, 1); syncToGateway(); showTabContent('logins'); };
      card.appendChild(del); panel.appendChild(card);
    });
  } else if (tab === 'github') {
    panel.textContent = 'Loading repos...';
    try {
      var raw = await listGithubRepos();
      panel.textContent = '';
      var repos = JSON.parse(raw);
      // Create new repo button
      var newBtn = document.createElement('button'); newBtn.className = 'add-btn';
      newBtn.style.cssText = 'width:100%;margin-bottom:16px';
      newBtn.textContent = 'Create New Repo';
      newBtn.onclick = function() {
        var name = prompt('New repo name:');
        if (!name) return;
        var desc = prompt('Description (optional):') || '';
        panel.textContent = 'Creating...';
        gw('POST', '/api/execute', { language: 'python', code: 'import subprocess\nr = subprocess.run(["gh", "repo", "create", "mrmoe28/' + name.replace(/"/g, '') + '", "--public", "--description", "' + desc.replace(/"/g, '') + '", "--clone=false"], capture_output=True, text=True)\nprint(r.stdout or r.stderr)' }).then(function(r) {
          alert(r.stdout || r.stderr || 'Done');
          showTabContent('github');
        });
      };
      panel.appendChild(newBtn);
      if (!repos.length) { var em = document.createElement('div'); em.style.cssText = 'text-align:center;padding:30px;color:#555'; em.textContent = 'No repos found.'; panel.appendChild(em); }
      else repos.forEach(function(repo) {
        var card = document.createElement('div'); card.className = 'card';
        var hdr = document.createElement('div'); hdr.className = 'card-header';
        var nm = document.createElement('span'); nm.className = 'card-name'; nm.textContent = repo.name; hdr.appendChild(nm);
        var vis = document.createElement('span'); vis.className = 'card-badge'; vis.textContent = repo.visibility || 'public'; hdr.appendChild(vis);
        card.appendChild(hdr);
        if (repo.description) { var d = document.createElement('div'); d.className = 'card-desc'; d.textContent = repo.description; card.appendChild(d); }
        var acts = document.createElement('div'); acts.className = 'card-actions';
        var openB = document.createElement('button'); openB.className = 'card-btn card-btn-run'; openB.textContent = 'Open';
        openB.onclick = function() { window.open(repo.url || 'https://github.com/mrmoe28/' + repo.name, '_blank'); };
        acts.appendChild(openB);
        card.appendChild(acts); panel.appendChild(card);
      });
    } catch(e) { panel.textContent = 'Failed to load repos: ' + e.message; }
  } else if (tab === 'settings') {
    // Temperature
    var tempCard = document.createElement('div'); tempCard.className = 'card';
    var tempLabel = document.createElement('div'); tempLabel.className = 'card-name'; tempLabel.textContent = 'Agent Temperature: ' + temperature.toFixed(1); tempCard.appendChild(tempLabel);
    var tempDesc = document.createElement('div'); tempDesc.className = 'card-desc'; tempDesc.textContent = 'Lower = precise, Higher = creative'; tempCard.appendChild(tempDesc);
    var tempRow = document.createElement('div'); tempRow.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap';
    [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].forEach(function(v) {
      var b = document.createElement('button');
      b.style.cssText = 'width:28px;height:28px;border-radius:14px;border:1px solid #333;background:' + (Math.abs(temperature - v) < 0.05 ? '#4FC3F7' : '#111') + ';color:' + (Math.abs(temperature - v) < 0.05 ? '#000' : '#666') + ';font-size:10px;cursor:pointer';
      b.textContent = v.toFixed(1);
      b.onclick = function() { temperature = v; syncToGateway(); showTabContent('settings'); };
      tempRow.appendChild(b);
    });
    tempCard.appendChild(tempRow); panel.appendChild(tempCard);

    // Speech Rate
    var rateCard = document.createElement('div'); rateCard.className = 'card';
    var rateLabel = document.createElement('div'); rateLabel.className = 'card-name'; rateLabel.textContent = 'Speech Rate: ' + speechRate.toFixed(1) + 'x'; rateCard.appendChild(rateLabel);
    var rateRow = document.createElement('div'); rateRow.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap';
    [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0].forEach(function(v) {
      var b = document.createElement('button');
      b.style.cssText = 'padding:4px 10px;border-radius:6px;border:1px solid #333;background:' + (Math.abs(speechRate - v) < 0.05 ? '#4FC3F7' : '#111') + ';color:' + (Math.abs(speechRate - v) < 0.05 ? '#000' : '#666') + ';font-size:11px;cursor:pointer';
      b.textContent = v + 'x';
      b.onclick = function() { speechRate = v; syncToGateway(); showTabContent('settings'); };
      rateRow.appendChild(b);
    });
    rateCard.appendChild(rateRow); panel.appendChild(rateCard);

    // Pitch
    var pitchCard = document.createElement('div'); pitchCard.className = 'card';
    var pitchLabel = document.createElement('div'); pitchLabel.className = 'card-name'; pitchLabel.textContent = 'Pitch: ' + speechPitch.toFixed(1); pitchCard.appendChild(pitchLabel);
    var pitchRow = document.createElement('div'); pitchRow.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap';
    [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0].forEach(function(v) {
      var b = document.createElement('button');
      b.style.cssText = 'padding:4px 10px;border-radius:6px;border:1px solid #333;background:' + (Math.abs(speechPitch - v) < 0.05 ? '#4FC3F7' : '#111') + ';color:' + (Math.abs(speechPitch - v) < 0.05 ? '#000' : '#666') + ';font-size:11px;cursor:pointer';
      b.textContent = v.toFixed(1);
      b.onclick = function() { speechPitch = v; syncToGateway(); showTabContent('settings'); };
      pitchRow.appendChild(b);
    });
    pitchCard.appendChild(pitchRow); panel.appendChild(pitchCard);

    // Voice Selection
    var voiceCard = document.createElement('div'); voiceCard.className = 'card';
    var voiceLabel = document.createElement('div'); voiceLabel.className = 'card-name'; voiceLabel.textContent = 'Voice'; voiceCard.appendChild(voiceLabel);
    var voices = speechSynthesis.getVoices().filter(function(v) { return v.lang.startsWith('en'); });
    // Default option
    var defBtn = document.createElement('button');
    defBtn.style.cssText = 'display:block;width:100%;text-align:left;padding:8px;margin-top:6px;border-radius:6px;border:1px solid ' + (!selectedVoice ? '#4FC3F7' : '#1e1e1e') + ';background:' + (!selectedVoice ? '#1a3a4a' : '#0a0a0a') + ';color:' + (!selectedVoice ? '#4FC3F7' : '#999') + ';font-size:12px;cursor:pointer';
    defBtn.textContent = 'System Default';
    defBtn.onclick = function() { selectedVoice = ''; syncToGateway(); showTabContent('settings'); };
    voiceCard.appendChild(defBtn);
    voices.forEach(function(v) {
      var vb = document.createElement('button');
      var isActive = selectedVoice === v.name;
      vb.style.cssText = 'display:flex;justify-content:space-between;width:100%;text-align:left;padding:8px;margin-top:4px;border-radius:6px;border:1px solid ' + (isActive ? '#4FC3F7' : '#1e1e1e') + ';background:' + (isActive ? '#1a3a4a' : '#0a0a0a') + ';color:' + (isActive ? '#4FC3F7' : '#999') + ';font-size:12px;cursor:pointer';
      vb.textContent = v.name;
      vb.onclick = function() { selectedVoice = v.name; syncToGateway(); showTabContent('settings'); };
      voiceCard.appendChild(vb);
    });
    panel.appendChild(voiceCard);

    // Test Voice
    var testBtn = document.createElement('button');
    testBtn.className = 'add-btn';
    testBtn.style.cssText += ';width:100%;margin-top:8px;margin-bottom:12px';
    testBtn.textContent = 'Test Voice';
    testBtn.onclick = function() { speak('This is how I sound with the current settings.'); };
    panel.appendChild(testBtn);

    // Google Account (info only)
    var googleCard = document.createElement('div'); googleCard.className = 'card';
    var gLabel = document.createElement('div'); gLabel.className = 'card-name'; gLabel.textContent = 'Google Account'; googleCard.appendChild(gLabel);
    var gDesc = document.createElement('div'); gDesc.className = 'card-desc'; gDesc.textContent = 'Google sign-in is available on the mobile app. Gmail and Calendar work through your phone.'; googleCard.appendChild(gDesc);
    panel.appendChild(googleCard);

    // System info
    var infoCard = document.createElement('div'); infoCard.className = 'card';
    var i1 = document.createElement('div'); i1.className = 'card-desc'; i1.textContent = 'Gateway: ' + GATEWAY_URL; infoCard.appendChild(i1);
    var i2 = document.createElement('div'); i2.className = 'card-desc'; i2.textContent = 'Model: ' + CLAUDE_MODEL; infoCard.appendChild(i2);
    var acts = document.createElement('div'); acts.className = 'card-actions';
    var resetB = document.createElement('button'); resetB.className = 'card-btn card-btn-del'; resetB.textContent = 'Reset All Settings';
    resetB.onclick = function() { if (!confirm('Reset all settings?')) return; localStorage.clear(); location.reload(); };
    acts.appendChild(resetB); infoCard.appendChild(acts); panel.appendChild(infoCard);
  }
}

// ── Event listeners ──
document.getElementById('menuBtn').onclick = openSidebar;
document.getElementById('sidebarClose').onclick = closeSidebar;
document.getElementById('overlay').onclick = closeSidebar;
document.getElementById('newBtn').onclick = newSession;
document.getElementById('micBtn').onclick = toggleMic;
document.getElementById('sendBtn').onclick = sendMsg;
document.getElementById('attachBtn').onclick = pickImage;
document.getElementById('pendingImgClear').onclick = clearPendingImage;
document.getElementById('input').onkeydown = function(e) { if (e.key === 'Enter') { e.preventDefault(); sendMsg(); } };

// ── Health check ──
async function checkHealth() {
  try { var r = await fetch(GATEWAY_URL + '/api/health'); document.getElementById('statusDot').className = 'status-dot' + (r.ok ? ' connected' : ''); }
  catch(e) { document.getElementById('statusDot').className = 'status-dot'; }
}
checkHealth();
setInterval(checkHealth, 30000);
// ── Artifact Preview ──
var lastPreviewHtml = '';

function showPreview(title, html) {
  lastPreviewHtml = html;
  document.getElementById('previewTitle').textContent = title || 'Preview';
  var iframe = document.getElementById('previewIframe');
  iframe.srcdoc = html;
  document.getElementById('previewOverlay').classList.add('open');
}

function closePreview() {
  document.getElementById('previewOverlay').classList.remove('open');
  document.getElementById('previewIframe').srcdoc = '';
}

document.getElementById('previewCloseBtn').onclick = closePreview;
document.getElementById('previewTabBtn').onclick = function() {
  if (lastPreviewHtml) {
    var blob = new Blob([lastPreviewHtml], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  }
};
document.getElementById('previewExportBtn').onclick = function() {
  if (!lastPreviewHtml) return;
  var title = document.getElementById('previewTitle').textContent || 'artifact';
  var filename = title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.html';
  var blob = new Blob([lastPreviewHtml], { type: 'text/html' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
};
document.getElementById('previewGithubBtn').onclick = function() {
  if (!lastPreviewHtml) return;
  var title = document.getElementById('previewTitle').textContent || 'artifact';
  var repoName = prompt('Repository name:', title.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  if (!repoName) return;
  pushToGithub(repoName, lastPreviewHtml, title);
};

// ── GitHub ──
async function pushToGithub(repoName, html, title) {
  addMessage('assistant', 'Creating repo "' + repoName + '" and pushing...');
  try {
    var code = [
      'import subprocess, os, tempfile, shutil',
      'repo = "' + repoName.replace(/"/g, '') + '"',
      'html_content = ' + JSON.stringify(html),
      'tmpdir = tempfile.mkdtemp()',
      'os.chdir(tmpdir)',
      'subprocess.run(["git", "init"], capture_output=True)',
      'with open("index.html", "w", encoding="utf-8") as f: f.write(html_content)',
      'with open("README.md", "w") as f: f.write("# " + repo + "\\n\\nGenerated by Brain Link")',
      'subprocess.run(["git", "add", "-A"], capture_output=True)',
      'subprocess.run(["git", "commit", "-m", "Initial commit from Brain Link"], capture_output=True)',
      '# Create repo on GitHub',
      'r = subprocess.run(["gh", "repo", "create", "mrmoe28/" + repo, "--public", "--source=.", "--push"], capture_output=True, text=True)',
      'print(r.stdout)',
      'if r.stderr: print(r.stderr)',
      'shutil.rmtree(tmpdir, ignore_errors=True)',
    ].join('\n');
    var r = await gw('POST', '/api/execute', { language: 'python', code: code });
    var output = (r.stdout || '') + (r.stderr || '');
    if (output.includes('github.com')) {
      addMessage('assistant', 'Repo created: https://github.com/mrmoe28/' + repoName);
    } else {
      addMessage('assistant', 'GitHub push result: ' + output.slice(0, 500));
    }
  } catch (err) {
    addMessage('assistant', 'GitHub push failed: ' + err.message);
  }
}

async function listGithubRepos() {
  var r = await gw('POST', '/api/execute', { language: 'python', code: 'import subprocess\nr = subprocess.run(["gh", "repo", "list", "mrmoe28", "--json", "name,description,url,visibility", "--limit", "20"], capture_output=True, text=True)\nprint(r.stdout or r.stderr)' });
  return r.stdout || r.stderr || '[]';
}

document.getElementById('input').focus();
