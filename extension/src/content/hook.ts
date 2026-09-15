(function() {
  if (window.__nivara_canvas_hook_installed) return;
  window.__nivara_canvas_hook_installed = true;

  const originalFillText = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
    if (!this.canvas.hasAttribute('data-nivara-text')) {
      this.canvas.setAttribute('data-nivara-text', '[]');
    }
    try {
      const nodes = JSON.parse(this.canvas.getAttribute('data-nivara-text'));
      nodes.push({ text: String(text), x, y, font: this.font || '' });
      this.canvas.setAttribute('data-nivara-text', JSON.stringify(nodes));
    } catch (e) {
      console.error('[Nivara-X] Canvas hook error', e);
    }
    return originalFillText.apply(this, arguments);
  };
  console.log('[Nivara-X] Canvas DOM interceptor installed');
})();
