// 轻量正文渲染器:支持换行、引用(> )、代码块(```)、代码内联(`code`)、图片外链、长文折叠
// 不引入第三方库,避免被 XSS 注入:输入先转义再处理
(function () {
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 单独一行的 http(s) 链接或图片链接 -> 渲染为图片或可点击链接
  function renderLine(line) {
    const trimmed = line.trim();
    // 图片外链:以图片扩展名结尾,或包含图片标记
    if (/^https?:\/\/\S+\.(png|jpg|jpeg|gif|webp|svg)(\?\S*)?$/i.test(trimmed)) {
      return `<div class="md-image"><img src="${escapeHtml(trimmed)}" alt="" loading="lazy"></div>`;
    }
    // 普通外链
    if (/^https?:\/\/\S+$/.test(trimmed)) {
      return `<p><a href="${escapeHtml(trimmed)}" target="_blank" rel="noopener noreferrer">${escapeHtml(trimmed)}</a></p>`;
    }
    // 引用
    if (line.startsWith('&gt; ') || line.startsWith('> ')) {
      // 因为已经转义过,> 变成 &gt;
      const text = line.replace(/^&gt;\s?/, '').replace(/^>\s?/, '');
      return `<blockquote>${text}</blockquote>`;
    }
    // 空行
    if (trimmed === '') return '';
    // 普通段落,内联代码、加粗
    let html = escapeHtml(line);
    // 内联代码 `code`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // **加粗**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return `<p>${html}</p>`;
  }

  function render(text, opts) {
    opts = opts || {};
    const fold = opts.fold !== false && text.length >= (window.DiaryConfig.foldLength || 600);

    // 先按代码块分隔
    const segments = [];
    const codeBlockRe = /```(\w*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let m;
    while ((m = codeBlockRe.exec(text)) !== null) {
      if (m.index > lastIndex) segments.push({ type: 'text', value: text.slice(lastIndex, m.index) });
      segments.push({ type: 'code', lang: m[1] || '', value: m[2] });
      lastIndex = m.index + m[0].length;
    }
    if (lastIndex < text.length) segments.push({ type: 'text', value: text.slice(lastIndex) });

    let html = '';
    segments.forEach(seg => {
      if (seg.type === 'code') {
        const langAttr = seg.lang ? ` data-lang="${escapeHtml(seg.lang)}"` : '';
        html += `<pre class="md-code"${langAttr}><code>${escapeHtml(seg.value.replace(/\n$/, ''))}</code></pre>`;
      } else {
        const lines = seg.value.split(/\r?\n/);
        let buf = [];
        lines.forEach(line => {
          // 引用连续行合并为一个 blockquote 段
          const isQuote = line.startsWith('&gt; ') || line.startsWith('> ') || line.startsWith('&gt;\t') || line.startsWith('>\t');
          if (isQuote) {
            buf.push(line);
          } else {
            if (buf.length) {
              html += `<blockquote>${buf.map(b => escapeHtml(b.replace(/^&gt;\s?/, '').replace(/^>\s?/, ''))).join('<br>')}</blockquote>`;
              buf = [];
            }
            html += renderLine(line);
          }
        });
        if (buf.length) {
          html += `<blockquote>${buf.map(b => escapeHtml(b.replace(/^&gt;\s?/, '').replace(/^>\s?/, ''))).join('<br>')}</blockquote>`;
        }
      }
    });

    if (fold) {
      // 把全文放进折叠容器,默认只显示前面一段
      // 简化做法:整段折叠,按钮展开/收起
      return `<div class="md-fold" data-collapsed="1">
        <div class="md-fold-inner">${html}</div>
        <button class="md-fold-toggle">展开全文</button>
      </div>`;
    }
    return html;
  }

  // 绑定折叠按钮事件(委托,避免每次重渲染都绑定)
  function bindFoldToggle() {
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('.md-fold-toggle');
      if (!btn) return;
      const wrap = btn.closest('.md-fold');
      const collapsed = wrap.getAttribute('data-collapsed') === '1';
      wrap.setAttribute('data-collapsed', collapsed ? '0' : '1');
      btn.textContent = collapsed ? '收起' : '展开全文';
    });
  }

  window.DiaryMD = { render, escapeHtml, bindFoldToggle };
})();
