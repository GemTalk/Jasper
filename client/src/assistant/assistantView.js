// Webview side of the Jasper Assistant: renders Claude Code's stream-json events as a chat.
//
// Streamed text deltas go into a provisional "live" block; each complete `assistant` event
// replaces it with the final content, so a missed or reordered delta never corrupts the log.
(function () {
  const TOOL_PREFIX = 'mcp__jasper__';
  // Tools whose result is shown in a Jasper view rather than in the chat.
  const GUI_TOOLS = new Set([
    'show_regex_source_search',
    'show_methods_in_search',
    'show_classes_in_search',
  ]);

  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  }

  // Deliberately small: fenced code, inline code, bold, headings and bullet lists.
  // Everything is escaped first, so model output can never inject markup.
  function renderMarkdown(text) {
    const parts = String(text).split(/```[^\n]*\n?/);
    return parts
      .map((part, i) => {
        if (i % 2 === 1) {
          return '<pre><code>' + escapeHtml(part.replace(/\n$/, '')) + '</code></pre>';
        }
        return renderProse(part);
      })
      .join('');
  }

  function renderInline(s) {
    return escapeHtml(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }

  function renderProse(text) {
    const out = [];
    let list = null;
    for (const raw of text.split('\n')) {
      const line = raw.trimEnd();
      const item = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
      if (item) {
        if (!list) {
          list = [];
        }
        list.push('<li>' + renderInline(item[1]) + '</li>');
        continue;
      }
      if (list) {
        out.push('<ul>' + list.join('') + '</ul>');
        list = null;
      }
      const heading = /^#{1,6}\s+(.*)$/.exec(line);
      if (heading) {
        out.push('<p><strong>' + renderInline(heading[1]) + '</strong></p>');
      } else if (line) {
        out.push('<p>' + renderInline(line) + '</p>');
      }
    }
    if (list) {
      out.push('<ul>' + list.join('') + '</ul>');
    }
    return out.join('');
  }

  function toolResultText(content) {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content.map((c) => (c && c.type === 'text' ? c.text : JSON.stringify(c))).join('\n');
    }
    return JSON.stringify(content, null, 2);
  }

  function init(doc, vscode) {
    const log = doc.getElementById('log');
    const status = doc.getElementById('status');
    const form = doc.getElementById('composer');
    const input = doc.getElementById('input');
    const sendBtn = doc.getElementById('send');
    const stopBtn = doc.getElementById('stop');
    const newBtn = doc.getElementById('newConversation');
    const guiUpdates = doc.getElementById('guiUpdates');

    const working = doc.getElementById('working');
    const workingLabel = doc.getElementById('workingLabel');
    const workingTime = doc.getElementById('workingTime');

    const toolCards = new Map();
    const history = ((vscode.getState() || {}).history || []).slice();
    let historyIndex = history.length;
    let draft = '';
    let live = null;
    let busy = false;
    // Whether a Claude Code process is up: the first message of a conversation, or the first
    // after Stop, waits several seconds for it to start and connect to Jasper's tools.
    let started = false;
    let startedAt = 0;
    let timer = null;

    function setActivity(label) {
      workingLabel.textContent = label;
    }

    function setBusy(value) {
      busy = value;
      sendBtn.disabled = value;
      stopBtn.hidden = !value;
      working.hidden = !value;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (value) {
        startedAt = Date.now();
        workingTime.textContent = '0s';
        timer = setInterval(() => {
          workingTime.textContent = Math.round((Date.now() - startedAt) / 1000) + 's';
        }, 1000);
      }
    }

    function scrollToEnd() {
      log.scrollTop = log.scrollHeight;
    }

    function append(className, html) {
      const el = doc.createElement('div');
      el.className = 'msg ' + className;
      el.innerHTML = html;
      log.appendChild(el);
      scrollToEnd();
      return el;
    }

    function dropLive() {
      if (live) {
        live.el.remove();
        live = null;
      }
    }

    function addToolCard(block) {
      const name = String(block.name || '').replace(TOOL_PREFIX, '');
      setActivity('Running ' + name + '…');
      const args = JSON.stringify(block.input || {});
      const card = doc.createElement('details');
      card.className = 'tool';
      card.innerHTML =
        '<summary><span class="state"></span><span class="name">' +
        escapeHtml(name) +
        '</span><span class="args">' +
        escapeHtml(args) +
        '</span></summary>' +
        '<div class="body"><div class="label">Input</div><pre>' +
        escapeHtml(JSON.stringify(block.input || {}, null, 2)) +
        '</pre><div class="label">Result</div><pre class="result">Running…</pre></div>';
      card.dataset.tool = name;
      card.dataset.input = JSON.stringify(block.input || {});
      log.appendChild(card);
      toolCards.set(block.id, card);
      scrollToEnd();
    }

    function addGuiResult(card, text) {
      const input = JSON.parse(card.dataset.input || '{}');
      const banner = doc.createElement('div');
      banner.className = 'gui-result';
      banner.innerHTML =
        '<span>🔎</span><span class="headline">' +
        escapeHtml(text) +
        '</span><button type="button">Show GemStone Search</button>' +
        (input.pattern
          ? '<span class="pattern">Pattern: <code>' + escapeHtml(input.pattern) + '</code></span>'
          : '');
      banner
        .querySelector('button')
        .addEventListener('click', () => vscode.postMessage({ command: 'revealSearch' }));
      card.after(banner);
      scrollToEnd();
    }

    function onToolResult(block) {
      const card = toolCards.get(block.tool_use_id);
      if (!card) {
        return;
      }
      card.classList.add(block.is_error ? 'failed' : 'done');
      setActivity('Thinking…');
      const text = toolResultText(block.content);
      card.querySelector('.result').textContent = text;
      if (!block.is_error && GUI_TOOLS.has(card.dataset.tool)) {
        addGuiResult(card, text);
      }
    }

    function onStreamEvent(ev) {
      if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
        if (!live) {
          live = { el: append('assistant', ''), text: '' };
        }
        live.text += ev.delta.text;
        setActivity('Writing…');
        live.el.innerHTML = renderMarkdown(live.text);
        scrollToEnd();
      }
    }

    function onEvent(event) {
      switch (event.type) {
        case 'system':
          if (event.subtype === 'init') {
            started = true;
            setActivity('Thinking…');
            const jasper = (event.mcp_servers || []).find((m) => m.name === 'jasper');
            if (!jasper || jasper.status !== 'connected') {
              append(
                'error',
                escapeHtml(
                  "Jasper's tools did not connect (" +
                    (jasper ? jasper.status : 'not configured') +
                    '), so answers will not come from your GemStone session.',
                ),
              );
            }
          }
          return;
        case 'stream_event':
          onStreamEvent(event.event || {});
          return;
        case 'assistant': {
          dropLive();
          for (const block of (event.message && event.message.content) || []) {
            if (block.type === 'text' && block.text) {
              append('assistant', renderMarkdown(block.text));
            } else if (block.type === 'tool_use') {
              addToolCard(block);
            }
          }
          return;
        }
        case 'user': {
          const content = (event.message && event.message.content) || [];
          if (Array.isArray(content)) {
            content.filter((b) => b.type === 'tool_result').forEach(onToolResult);
          }
          return;
        }
        case 'result': {
          dropLive();
          setBusy(false);
          if (event.is_error || event.subtype !== 'success') {
            append('error', escapeHtml(event.result || event.subtype || 'The request failed.'));
          }
          const secs = event.duration_ms ? (event.duration_ms / 1000).toFixed(1) + 's' : '';
          const cost =
            typeof event.total_cost_usd === 'number'
              ? ' · $' + event.total_cost_usd.toFixed(4)
              : '';
          if (secs) {
            append('meta', escapeHtml(secs + cost));
          }
          return;
        }
      }
    }

    function onMcpStatus(msg) {
      status.hidden = false;
      if (msg.state === 'this') {
        status.className = 'status ok';
        status.textContent = 'Tools act on: ' + (msg.servedSession || 'no session logged in');
        return;
      }
      status.className = 'status';
      status.innerHTML =
        '<span>' +
        escapeHtml(msg.detail) +
        ' The assistant cannot reach GemStone until this window serves MCP.</span>';
      if (msg.state === 'none') {
        const claim = doc.createElement('button');
        claim.className = 'secondary';
        claim.textContent = 'Claim MCP Server';
        claim.addEventListener('click', () => vscode.postMessage({ command: 'claimMcp' }));
        status.appendChild(claim);
      }
    }

    function send() {
      const text = input.value.trim();
      if (!text || busy) {
        return;
      }
      // What a Claude Code user types to start over; in headless mode Claude Code ignores it.
      if (text === '/clear' || text === '/new') {
        input.value = '';
        vscode.postMessage({ command: 'newConversation' });
        return;
      }
      append('user', escapeHtml(text));
      if (history[history.length - 1] !== text) history.push(text);
      historyIndex = history.length;
      vscode.setState({ history: history.slice(-100) });
      input.value = '';
      setBusy(true);
      setActivity(started ? 'Thinking…' : 'Starting Claude Code…');
      vscode.postMessage({ command: 'send', text });
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      send();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
        return;
      }
      // Up on the first line and Down on the last recall earlier messages, as in a terminal;
      // elsewhere they move the caret through a multi-line message.
      const before = input.value.slice(0, input.selectionStart);
      const after = input.value.slice(input.selectionEnd);
      if (e.key === 'ArrowUp' && !before.includes('\n') && historyIndex > 0) {
        e.preventDefault();
        if (historyIndex === history.length) draft = input.value;
        historyIndex--;
        input.value = history[historyIndex];
      } else if (e.key === 'ArrowDown' && !after.includes('\n') && historyIndex < history.length) {
        e.preventDefault();
        historyIndex++;
        input.value = historyIndex === history.length ? draft : history[historyIndex];
      }
    });
    stopBtn.addEventListener('click', () => vscode.postMessage({ command: 'stop' }));
    newBtn.addEventListener('click', () => vscode.postMessage({ command: 'newConversation' }));
    guiUpdates.addEventListener('change', () =>
      vscode.postMessage({ command: 'setGuiUpdates', on: guiUpdates.checked }),
    );

    window.addEventListener('message', (e) => {
      const msg = e.data || {};
      switch (msg.command) {
        case 'event':
          onEvent(msg.event);
          return;
        case 'mcpStatus':
          onMcpStatus(msg);
          return;
        case 'guiUpdates':
          guiUpdates.checked = msg.on;
          return;
        case 'error':
          started = false;
          dropLive();
          setBusy(false);
          append('error', escapeHtml(msg.text));
          return;
        case 'stopped':
          started = false;
          dropLive();
          setBusy(false);
          append('meta', 'Stopped.');
          return;
        case 'cleared':
          started = false;
          dropLive();
          setBusy(false);
          toolCards.clear();
          log.innerHTML = '';
          return;
      }
    });
    input.focus();
  }

  window.JasperAssistantView = { init, renderMarkdown };
})();
