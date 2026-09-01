/**
 * svgkit.js — SVG load / display / export for p5.js 2.x
 *
 * Usage:
 *   const rec = svgkit.record(p);          // attach (or svgkit.record() in global mode)
 *   const img = await rec.load('a.svg');   // display-ready, vector-registered
 *   ... draw normally ...
 *   rec.export('output');                  // writes output.svg + output.png
 *
 * How it hooks in: at load time svgkit registers itself as a p5 addon and
 * wraps the drawing primitives on p5.prototype. p5 2.x binds window.* to
 * prototype members when the instance initializes — after addon registration
 * — so both global and instance mode route every call through the active
 * recorder before reaching the real renderer. The last recorder created is
 * active.
 *
 * Records: push/pop, translate/rotate/scale, fill/stroke/strokeWeight,
 * line, rect, square, ellipse, circle, triangle, quad, bezier,
 * beginShape/vertex/bezierVertex/endShape, image (vector-preserving),
 * background, text/textFont/textSize/textAlign/textStyle (as SVG <text>).
 * Unsupported calls (curveVertex, arc, ...) warn once and are omitted.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.svgkit = mod;
}(typeof self !== 'undefined' ? self : this, function () {

  var active = null;
  var patched = {};

  function fmt(n) { return (Math.round(n * 10000) / 10000).toString(); }

  function ident() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }

  function mul(m1, m2) {
    return {
      a: m1.a * m2.a + m1.c * m2.b, b: m1.b * m2.a + m1.d * m2.b,
      c: m1.a * m2.c + m1.c * m2.d, d: m1.b * m2.c + m1.d * m2.d,
      e: m1.a * m2.e + m1.c * m2.f + m1.e, f: m1.b * m2.e + m1.d * m2.f + m1.f
    };
  }

  function apply(m, x, y) { return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }; }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // `this` is the active recorder in every hook.
  var HOOKS = {
    push: function () {
      var m = this.stack[this.stack.length - 1];
      this.stack.push({ a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f });
    },
    pop: function () {
      if (this.stack.length > 1) this.stack.pop();
    },
    translate: function (x, y) {
      var m = this.stack[this.stack.length - 1];
      this.stack[this.stack.length - 1] = mul(m, { a: 1, b: 0, c: 0, d: 1, e: x, f: y });
    },
    rotate: function (r) {
      var m = this.stack[this.stack.length - 1], c = Math.cos(r), s = Math.sin(r);
      this.stack[this.stack.length - 1] = mul(m, { a: c, b: s, c: -s, d: c, e: 0, f: 0 });
    },
    scale: function (sx, sy) {
      if (sy === undefined) sy = sx;
      var m = this.stack[this.stack.length - 1];
      this.stack[this.stack.length - 1] = mul(m, { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
    },
    fill: function (v) { this.fill = this._color(arguments); },
    noFill: function () { this.fill = 'none'; },
    stroke: function (v) { this.stroke = this._color(arguments); },
    noStroke: function () { this.stroke = 'none'; },
    strokeWeight: function (w) { this.weight = w; },
    background: function (v) {
      this.parts.push('<rect x="0" y="0" width="' + fmt(this.p.width) + '" height="' + fmt(this.p.height) + '" style="fill:' + this._color(arguments) + '"/>');
    },
    line: function (x1, y1, x2, y2) {
      var a = this._t(x1, y1), b = this._t(x2, y2);
      this._add('<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"/>');
    },
    rect: function (x, y, w, h) {
      var a = this._t(x, y), b = this._t(x + w, y), c = this._t(x + w, y + h), d = this._t(x, y + h);
      this._add('<polygon points="' + [a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y].join(' ') + '"/>');
    },
    ellipse: function (x, y, w, h) {
      var c = this._t(x, y);
      if (h === undefined) h = w;
      this._add('<ellipse cx="' + c.x + '" cy="' + c.y + '" rx="' + fmt(w / 2) + '" ry="' + fmt(h / 2) + '"/>');
    },
    circle: function (x, y, d) {
      var c = this._t(x, y);
      this._add('<circle cx="' + c.x + '" cy="' + c.y + '" r="' + fmt(d / 2) + '"/>');
    },
    square: function (x, y, s) {
      var a = this._t(x, y), b = this._t(x + s, y), c = this._t(x + s, y + s), d = this._t(x, y + s);
      this._add('<polygon points="' + [a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y].join(' ') + '"/>');
    },
    triangle: function (x1, y1, x2, y2, x3, y3) {
      var a = this._t(x1, y1), b = this._t(x2, y2), c = this._t(x3, y3);
      this._add('<polygon points="' + [a.x, a.y, b.x, b.y, c.x, c.y].join(' ') + '"/>');
    },
    quad: function (x1, y1, x2, y2, x3, y3, x4, y4) {
      var a = this._t(x1, y1), b = this._t(x2, y2), c = this._t(x3, y3), d = this._t(x4, y4);
      this._add('<polygon points="' + [a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y].join(' ') + '"/>');
    },
    bezier: function (x1, y1, x2, y2, x3, y3, x4, y4) {
      var a = this._t(x1, y1), b = this._t(x2, y2), c = this._t(x3, y3), d = this._t(x4, y4);
      this._add('<path d="M' + a.x + ',' + a.y + ' C' + b.x + ',' + b.y + ' ' + c.x + ',' + c.y + ' ' + d.x + ',' + d.y + '"/>');
    },
    image: function (img, x, y, w, h) {
      if (!img) return;
      var a = this._t(x, y);
      var dw = w || img.width, dh = h || img.height;
      var canvas = img.canvas || null;
      var src = canvas ? this._svgSources[canvas] : null;
      if (src) {
        this.parts.push('<g transform="translate(' + a.x + ' ' + a.y + ') scale(' + fmt(dw / src.viewBox[2]) + ' ' + fmt(dh / src.viewBox[3]) + ')">' + src.markup + '</g>');
        return;
      }
      var dataUrl = canvas ? canvas.toDataURL('image/png') : null;
      if (dataUrl) this.parts.push('<image x="' + a.x + '" y="' + a.y + '" width="' + dw + '" height="' + dh + '" href="' + dataUrl + '"/>');
    },
    beginShape: function () { this.shape = { parts: [] }; },
    vertex: function (x, y) {
      if (!this.shape || typeof x !== 'number' || typeof y !== 'number' || isNaN(x) || isNaN(y)) return;
      var a = this._t(x, y);
      this.shape.parts.push(this.shape.parts.length === 0 ? 'M' + a.x + ',' + a.y : 'L' + a.x + ',' + a.y);
    },
    bezierVertex: function (x2, y2, x3, y3, x4, y4) {
      if (!this.shape || [x2, y2, x3, y3, x4, y4].some(function (v) { return typeof v !== 'number' || isNaN(v); })) return;
      var b = this._t(x2, y2), c = this._t(x3, y3), d = this._t(x4, y4);
      this.shape.parts.push('C' + b.x + ',' + b.y + ' ' + c.x + ',' + c.y + ' ' + d.x + ',' + d.y);
    },
    endShape: function (mode) {
      if (!this.shape) return;
      var parts = this.shape.parts;
      this.shape = null;
      if (parts.length === 0) return;
      var d = parts.join(' ');
      if (mode === this.p.CLOSE || mode === 2) d += ' Z';
      this._add('<path d="' + d + '"/>');
    },
    textFont: function (f) {
      this.font = typeof f === 'string' ? f : (f && (f.name || f.family)) || 'sans-serif';
    },
    textSize: function (s) { this.fontSize = fmt(s); },
    textStyle: function (s) {
      var p = this.p;
      this.fontWeight = (s === p.BOLD || s === p.BOLD_ITALIC) ? '700' : null;
      this.fontStyle = (s === p.ITALIC || s === p.BOLD_ITALIC) ? 'italic' : null;
    },
    textAlign: function (h, v) {
      var p = this.p;
      this.hAnchor = h === p.CENTER ? 'middle' : h === p.RIGHT ? 'end' : 'start';
      this.base = v === p.CENTER ? 'central' : v === p.BOTTOM ? 'text-after-edge' : v === p.TOP ? 'hanging' : null;
    },
    text: function (str, x, y) {
      if ((this.fill === 'none' || this.fill === 'undefined') && this.stroke === 'none') return;
      var attrs = 'font-family="' + esc(this.font) + '" font-size="' + this.fontSize + '"';
      if (this.hAnchor !== 'start') attrs += ' text-anchor="' + this.hAnchor + '"';
      if (this.base) attrs += ' dominant-baseline="' + this.base + '"';
      if (this.fontWeight) attrs += ' font-weight="' + this.fontWeight + '"';
      if (this.fontStyle) attrs += ' font-style="' + this.fontStyle + '"';
      var m = this.stack[this.stack.length - 1];
      if (m.a !== 1 || m.b !== 0 || m.c !== 0 || m.d !== 1 || m.e !== 0 || m.f !== 0) {
        attrs += ' transform="matrix(' + [fmt(m.a), fmt(m.b), fmt(m.c), fmt(m.d), fmt(m.e), fmt(m.f)].join(' ') + ')"';
      }
      attrs += ' style="fill:' + this.fill + ';stroke:' + this.stroke + ';stroke-width:' + fmt(this.weight) + '"';
      this.parts.push('<text x="' + fmt(x) + '" y="' + fmt(y) + '" ' + attrs + '>' + esc(str) + '</text>');
    }
  };

  var WARNERS = ['curveVertex', 'curve', 'arc', 'textWidth', 'textLeading', 'vertexNormal', 'plane', 'box', 'sphere'];
  WARNERS.forEach(function (name) {
    HOOKS[name] = function () { this._warnOnce(name); };
  });

  function patchPrototype(proto) {
    if (!proto) return false;
    var names = Object.keys(HOOKS);
    for (var i = 0; i < names.length; i++) {
      (function (name) {
        if (patched[name]) return;
        var orig = proto[name];
        if (typeof orig !== 'function') return;
        patched[name] = true;
        proto[name] = function () {
          var r = active;
          if (r && r._fns[name]) r._fns[name].apply(r, arguments);
          return orig.apply(this, arguments);
        };
      })(names[i]);
    }
    return true;
  }

  // Register as an addon when p5 is available — this must happen before the
  // instance initializes so window bindings pick up the wrapped prototype.
  var g = typeof self !== 'undefined' ? self : root;
  if (g.p5 && typeof g.p5.registerAddon === 'function') {
    g.p5.registerAddon(function (p5cls, fn) { patchPrototype(fn); });
  }

  function Recorder(p) {
    this.p = p;
    this.reset();
    this._fns = {};
    var names = Object.keys(HOOKS);
    for (var i = 0; i < names.length; i++) (function (n) { this._fns[n] = HOOKS[n]; }).call(this, names[i]);
  }

  Recorder.prototype.reset = function () {
    this.parts = [];
    this.stack = [ident()];
    this.fill = 'none';
    this.stroke = '#111111';
    this.weight = 1;
    this.shape = null;
    this.font = 'sans-serif';
    this.fontSize = 12;
    this.hAnchor = 'start';
    this.base = null;
    this.fontWeight = null;
    this.fontStyle = null;
    this._svgSources = {};
    this._warned = {};
  };

  Recorder.prototype._warnOnce = function (name, msg) {
    if (this._warned[name]) return;
    this._warned[name] = true;
    console.warn('[svgkit] "' + name + '" is not recorded for SVG export' + (msg ? ' — ' + msg : ''));
  };

  Recorder.prototype.load = function (path, opts) {
    var self = this;
    var whiteAbove = opts && typeof opts.ignoreWhite === 'number' ? opts.ignoreWhite : null;
    return fetch(path)
      .then(function (r) {
        if (!r.ok) throw new Error('svgkit.load: ' + r.status + ' ' + path);
        return r.text();
      })
      .then(function (text) {
        var m = text.match(/viewBox="[\d.eE+-]+\s+[\d.eE+-]+\s+([\d.eE+-]+)\s+([\d.eE+-]+)"/);
        if (!m) throw new Error('svgkit.load: no viewBox in ' + path);
        text = text
          .replace(/width="[^"]*"/, 'width="' + m[1] + '"')
          .replace(/height="[^"]*"/, 'height="' + m[2] + '"');
        if (opts && opts.ignoreWhite) {
          var t = opts.ignoreWhite;
          // near-white opacity and fill styles vanish; the marks stay
          text = text.replace(/(fill(?:-opacity)?:\s*)rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g,
            function (all, pre, r, g, b) {
              return (+r >= t && +g >= t && +b >= t) ? (pre === 'fill:' ? 'fill:none' : pre + '0') : all;
            });
        }
        var url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
        return self.p.loadImage(url).then(function (img) {
          self.registerSvgImage(img, text);
          return img;
        });
      });
  };

  Recorder.prototype.registerSvgImage = function (img, svgText) {
    if (!img || !svgText) return;
    var doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    var svgEl = doc.querySelector('svg');
    if (!svgEl) return;
    var vb = (svgEl.getAttribute('viewBox') || '0 0 100 100').split(/\s+/).map(Number);
    var markup = svgEl.outerHTML;
    markup = markup.replace(/\s(width|height)="[^"]*"/g, '');
    if (img.canvas) this._svgSources[img.canvas] = { viewBox: vb, markup: markup };
  };

  Recorder.prototype._t = function (x, y) {
    return apply(this.stack[this.stack.length - 1], x, y);
  };

  Recorder.prototype._color = function (args) {
    var v = args[0];
    if (v === undefined) return '#000000';
    if (typeof v === 'object' && v.setRed && v.levels) {
      return 'rgb(' + v.levels.slice(0, 3).map(function (n) { return n.toFixed(0); }).join(',') + ')';
    }
    if (typeof v === 'number') {
      if (v <= 255 && args.length >= 3) {
        return 'rgb(' + [v, args[1], args[2]].map(function (n) { return Math.round(n); }).join(',') + ')';
      }
      return 'rgb(' + v + ',' + v + ',' + v + ')';
    }
    if (Array.isArray(v)) return 'rgb(' + v.slice(0, 3).map(function (n) { return Math.round(n); }).join(',') + ')';
    return String(v);
  };

  Recorder.prototype._add = function (s) {
    var style = 'fill:' + this.fill + ';stroke:' + this.stroke + ';stroke-width:' + fmt(this.weight);
    this.parts.push(s.slice(0, s.length - 2) + ' style="' + style + '"/>');
  };

  Recorder.prototype.svgString = function () {
    var w = this.p.width, h = this.p.height;
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">\n' +
      this.parts.join('\n') + '\n</svg>';
  };

  // Start a new artwork on the same canvas: drops recorded calls but keeps
  // vector registrations, so exports carry only what is drawn now.
  Recorder.prototype.clear = function () {
    this.parts = [];
    this.shape = null;
  };

  Recorder.prototype.export = function (filename) {
    var base = String(filename || 'export').replace(/\.(svg|png)$/i, '');
    this.exportSVG(base + '.svg');
    this.exportPNG(base + '.png');
  };

  Recorder.prototype.exportSVG = function (filename) {
    var blob = new Blob([this.svgString()], { type: 'image/svg+xml' });
    this._download(blob, filename || 'export.svg');
  };

  Recorder.prototype.exportPNG = function (filename) {
    var canvas = this.p.canvas;
    if (!canvas) return;
    var a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = filename || 'export.png';
    document.body.appendChild(a); a.click(); a.remove();
  };

  Recorder.prototype._download = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  function record(p) {
    var r = new Recorder(p || (typeof self !== 'undefined' && self.p5 ? self.p5.instance : null));
    if (!patched.background) {
      patchPrototype(Object.getPrototypeOf(r.p));
    }
    active = r;
    return r;
  }

  return { Recorder: Recorder, record: record, loadSvg: function (path, p) { return record(p).load(path); } };
}));
