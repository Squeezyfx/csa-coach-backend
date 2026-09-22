/* CSA chart-first view: overlay renderer + batch board. No build step; plain script. */
(function () {
  var COLORS = {
    frame: "#000000",
    high: "#111111",
    low: "#d32f2f",
    fib: "#1565c0",
    entry: "#f5a000",
    entryText: "#1a1a1a",
    boundary: "rgba(60,60,60,0.55)",
    unverified: "#8a8a8a",
  };
  var FONT = "bold 11px Tahoma, Verdana, Arial, sans-serif";
  var SMALL = "10px Tahoma, Verdana, Arial, sans-serif";

  function line(ctx, x1, y, x2, color, width, dash) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    ctx.moveTo(Math.round(x1) + 0.5, Math.round(y) + 0.5);
    ctx.lineTo(Math.round(x2) + 0.5, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.restore();
  }

  function box(ctx, x, y, text, bg, fg, font, boldPrefix) {
    ctx.save();
    ctx.font = font || FONT;
    var prefixWidth = 0;
    if (boldPrefix) prefixWidth = ctx.measureText(boldPrefix + "  ").width;
    var w = Math.ceil(prefixWidth + ctx.measureText(text).width + 8);
    var h = 14;
    ctx.fillStyle = bg;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
    ctx.fillStyle = fg;
    ctx.textBaseline = "middle";
    if (boldPrefix) ctx.fillText(boldPrefix, Math.round(x) + 4, Math.round(y) + h / 2 + 0.5);
    ctx.fillText(text, Math.round(x) + 4 + prefixWidth, Math.round(y) + h / 2 + 0.5);
    ctx.restore();
    return w;
  }

  function text(ctx, x, y, value, color, font) {
    ctx.save();
    ctx.font = font || SMALL;
    ctx.fillStyle = color;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(value, Math.round(x), Math.round(y));
    ctx.restore();
  }

  function draw(ctx, overlay) {
    if (!overlay || !Array.isArray(overlay.elements)) return;
    var right = overlay.plotRight || ctx.canvas.width;
    var bottom = overlay.plotBottom || ctx.canvas.height;
    var els = overlay.elements;
    var by = function (type) { return els.filter(function (e) { return e.type === type; }); };
    var tone = function (e, color) { return e.verified ? color : COLORS.unverified; };
    var suffix = function (e) { return e.verified ? "" : " (unverified)"; };

    // Period boundaries.
    by("period_boundary").forEach(function (e) {
      ctx.save();
      ctx.strokeStyle = COLORS.boundary;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(e.x) + 0.5, 0);
      ctx.lineTo(Math.round(e.x) + 0.5, bottom);
      ctx.stroke();
      ctx.restore();
    });

    // Fib guide lines (thin, behind everything else).
    by("fib_level").forEach(function (e) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      line(ctx, e.x1, e.y, e.x2, tone(e, COLORS.fib), 1, [6, 4]);
      ctx.restore();
    });

    // Period highs / lows.
    by("period_level").forEach(function (e) {
      var color = tone(e, e.kind === "high" ? COLORS.high : COLORS.low);
      line(ctx, e.x1, e.y, e.x2, color, 1, [4, 3]);
      var labelX = Math.max(2, e.x1 + 4);
      if (e.kind === "high") text(ctx, labelX, e.y - 3, e.label + suffix(e), color);
      else text(ctx, labelX, e.y + 11, e.label + suffix(e), color);
    });

    // Frame (week / month) high and low.
    by("frame_line").forEach(function (e) {
      var color = tone(e, COLORS.frame);
      line(ctx, e.x1, e.y, e.x2 + 10, color, 2, [10, 5]);
      box(ctx, 2, e.y - 15, e.label + suffix(e), color, "#ffffff");
    });

    // Entries.
    by("entry").forEach(function (e, i) {
      var color = tone(e, COLORS.entry);
      var top = Math.min(e.yTop, e.yBottom), height = Math.abs(e.yBottom - e.yTop);
      if (height >= 2) {
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = color;
        ctx.fillRect(e.x1, top, e.x2 - e.x1, height);
        ctx.restore();
      }
      line(ctx, e.x1, e.y, e.x2 + 10, color, 3);
      box(ctx, Math.round(right * 0.32), e.y - 16, e.label + suffix(e), color, COLORS.entryText, FONT, e.id);
    });

    // Fib tags on the right edge (drawn last so they stay readable).
    by("fib_level").forEach(function (e) {
      ctx.save();
      ctx.font = FONT;
      var w = ctx.measureText(e.tag).width + 8;
      ctx.restore();
      var x = Math.min(right - w - 1, e.x2 - w + 14);
      box(ctx, x, e.y - 7, e.tag + suffix(e), tone(e, COLORS.fib), "#ffffff");
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }

  // imageSrc: data URL, object URL (URL.createObjectURL(file)) or image URL.
  async function render(imageSrc, overlay) {
    var img = typeof imageSrc === "string" ? await loadImage(imageSrc) : imageSrc;
    var canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    // Coordinates are in the original screenshot's pixels. If the image the
    // browser holds was resized, scale the overlay to match.
    if (overlay && overlay.imageWidth && overlay.imageWidth !== canvas.width) {
      var s = canvas.width / overlay.imageWidth;
      ctx.scale(s, s);
    }
    draw(ctx, overlay);
    return canvas;
  }

  window.CSAOverlay = { render: render, draw: draw };
})();

/*
 * CSA chart-first batch view (add-on).
 *
 * Loaded by index.html BEFORE app.js. It does not modify app.js: it watches
 * the page's own POST to /api/run, keeps the chart files that were sent, and
 * when the results arrive it shows one large annotated chart per result
 * above the existing report. The text table and old thumbnails are hidden
 * behind a "Show text report" toggle, and Export JSON is untouched.
 */
(function () {
  var state = { files: [], run: null };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function phaseText(phase) {
    return String(phase || "").replace(/_/g, " ");
  }

  var originalFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var isRun = /\/api\/run(\?|$)/.test(url) && init && String(init.method || "").toUpperCase() === "POST";
    if (isRun && init.body instanceof FormData) {
      state.files = init.body.getAll("charts").filter(function (f) { return f instanceof Blob; });
      clearBoard();
    }
    var response = await originalFetch(input, init);
    if (isRun) {
      response.clone().json().then(function (run) {
        state.run = run;
        // Let app.js render its own report first, then place the board.
        setTimeout(function () { renderBoard(run); }, 0);
      }).catch(function () { /* app.js shows its own error */ });
    }
    return response;
  };

  function clearBoard() {
    var old = document.getElementById("chartBoard");
    if (old) old.remove();
    document.body.classList.remove("chart-first");
  }

  function statusBadge(overlay) {
    var status = overlay && overlay.status;
    if (status === "verified") return '<span class="cb-badge cb-verified">Verified</span>';
    if (status === "partial") return '<span class="cb-badge cb-partial">Partial — grey lines unverified</span>';
    return '<span class="cb-badge cb-none">No overlay</span>';
  }

  function cardHtml(item, index) {
    var a = item.analysis || {};
    var facts = a.analysisFacts || {};
    var bias = a.csaDirectionalBias || {};
    var overlay = a.chartOverlay || null;
    var entries = (overlay && overlay.elements || []).filter(function (e) { return e.type === "entry"; });
    var name = [facts.instrument || a.detectedPair || "Unknown", facts.timeframe || a.selectedTimeframe || ""].join(" ");
    var biasCode = String(bias.biasCode || "").toLowerCase();
    var phase = bias.cutoffPhase && bias.cutoffPhase.phase ? phaseText(bias.cutoffPhase.phase) : "";
    var cutoff = a.finalDateUsed || a.detectedLatestVisibleDate || "";
    var anyEntryUnverified = entries.some(function (e) { return e.verified !== true; });
    var entryText = entries.length
      ? entries.length + " entr" + (entries.length === 1 ? "y" : "ies") + (anyEntryUnverified ? " (needs review)" : "")
      : "No entry";
    var reasons = (overlay && overlay.reasons) || [];
    if (item.status === "error") reasons = [item.error || "Analysis failed"].concat(reasons);
    var entryList = entries.map(function (e) {
      return "<li><b>" + esc(e.id) + "</b> " + esc(e.label) + (e.verified ? "" : " <i>(unverified — needs manual review)</i>") + "</li>";
    }).join("");
    return '' +
      '<article class="cb-card" data-index="' + index + '">' +
        '<header class="cb-head">' +
          '<span class="cb-label">' + esc(item.label || item.fileName || "Chart " + (index + 1)) + '</span>' +
          '<strong class="cb-name">' + esc(name) + '</strong>' +
          '<span class="cb-bias cb-' + esc(biasCode || "none") + '">' + esc(bias.bias || "Bias n/a") + (bias.provisional ? " (provisional)" : "") + '</span>' +
          (phase ? '<span class="cb-phase">' + esc(phase) + '</span>' : '') +
          statusBadge(overlay) +
          '<span class="cb-entries' + (entries.length ? " cb-has" : "") + (anyEntryUnverified ? " cb-needs-review" : "") + '">' + esc(entryText) + '</span>' +
          '<button type="button" class="cb-download">Download</button>' +
        '</header>' +
        '<div class="cb-canvas"><p class="cb-loading">Drawing chart…</p></div>' +
        '<details class="cb-details"><summary>Details</summary>' +
          (cutoff ? "<p>Cutoff: " + esc(cutoff) + "</p>" : "") +
          (entryList ? "<ul>" + entryList + "</ul>" : "") +
          (reasons.length ? "<ul class='cb-reasons'>" + reasons.map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("") + "</ul>" : "<p>All drawn items verified.</p>") +
        '</details>' +
      '</article>';
  }

  async function renderBoard(run) {
    clearBoard();
    var panel = document.getElementById("resultsPanel");
    if (!panel || !run || !Array.isArray(run.results)) return;
    var board = document.createElement("section");
    board.id = "chartBoard";
    board.className = "cb-board";
    board.innerHTML =
      '<div class="cb-toolbar"><span>Chart view · black = week/month high-low · black/red = period high/low · blue = Fib · orange = entries · grey = unverified</span>' +
      '<label><input type="checkbox" id="cbShowText"> Show text report</label></div>' +
      run.results.map(cardHtml).join("");
    var anchor = document.getElementById("summaryCards");
    if (anchor && anchor.parentNode === panel) anchor.after(board); else panel.appendChild(board);
    document.body.classList.add("chart-first");
    board.querySelector("#cbShowText").addEventListener("change", function (event) {
      document.body.classList.toggle("chart-first", !event.target.checked);
    });

    for (var i = 0; i < run.results.length; i += 1) {
      await drawCard(board, run.results[i], i);
    }
  }

  async function drawCard(board, item, index) {
    var card = board.querySelector('.cb-card[data-index="' + index + '"]');
    if (!card) return;
    var holder = card.querySelector(".cb-canvas");
    var fileIndex = Number.isInteger(item.fileIndex) ? item.fileIndex : index;
    var file = state.files[fileIndex];
    if (!file) { holder.innerHTML = '<p class="cb-loading">Chart image not available.</p>'; return; }
    var url = URL.createObjectURL(file);
    try {
      var canvas = await window.CSAOverlay.render(url, (item.analysis || {}).chartOverlay || null);
      holder.innerHTML = "";
      holder.appendChild(canvas);
      canvas.title = "Click to open full size";
      canvas.addEventListener("click", function () { openFull(canvas); });
      card.querySelector(".cb-download").addEventListener("click", function () {
        var link = document.createElement("a");
        link.href = canvas.toDataURL("image/png");
        link.download = (item.label || "chart") + "-audit.png";
        link.click();
      });
    } catch (error) {
      holder.innerHTML = '<p class="cb-loading">Could not draw this chart.</p>';
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function openFull(canvas) {
    var shade = document.createElement("div");
    shade.className = "cb-lightbox";
    var img = document.createElement("img");
    img.src = canvas.toDataURL("image/png");
    shade.appendChild(img);
    shade.addEventListener("click", function () { shade.remove(); });
    document.addEventListener("keydown", function onKey(e) {
      if (e.key === "Escape") { shade.remove(); document.removeEventListener("keydown", onKey); }
    });
    document.body.appendChild(shade);
  }
})();
