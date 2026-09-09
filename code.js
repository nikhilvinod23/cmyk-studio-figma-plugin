figma.showUI(__html__, {
  width: 420,
  height: 700,
  themeColors: true,
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function rgbToCmyk(rgb) {
  const r = clamp(rgb.r, 0, 1);
  const g = clamp(rgb.g, 0, 1);
  const b = clamp(rgb.b, 0, 1);
  const k = 1 - Math.max(r, g, b);

  if (k >= 0.999999) {
    return { c: 0, m: 0, y: 0, k: 1 };
  }

  return {
    c: (1 - r - k) / (1 - k),
    m: (1 - g - k) / (1 - k),
    y: (1 - b - k) / (1 - k),
    k,
  };
}

function printPreviewRgb(cmyk) {
  const c = clamp(cmyk.c, 0, 1);
  const m = clamp(cmyk.m, 0, 1);
  const y = clamp(cmyk.y, 0, 1);
  const k = clamp(cmyk.k, 0, 1);

  // Approximate dot gain and paper/ink behavior for an on-screen soft proof.
  // Replace this with an ICC transform for a press-accurate production build.
  const dotGain = (ink) => clamp(ink + 0.14 * ink * (1 - ink), 0, 1);
  const dc = dotGain(c);
  const dm = dotGain(m);
  const dy = dotGain(y);
  const dk = dotGain(k);
  const raw = {
    r: (1 - dc) * (1 - dk) * 0.965,
    g: (1 - dm) * (1 - dk) * 0.96,
    b: (1 - dy) * (1 - dk) * 0.935,
  };

  // Compress chroma and darken midtones to mimic the loss of saturation
  // visible when an RGB color is converted through a print profile.
  const luminance = 0.2126 * raw.r + 0.7152 * raw.g + 0.0722 * raw.b;
  const soften = 0.12;
  return {
    r: clamp(Math.pow(luminance + (raw.r - luminance) * (1 - soften), 1.04), 0, 1),
    g: clamp(Math.pow(luminance + (raw.g - luminance) * (1 - soften), 1.04), 0, 1),
    b: clamp(Math.pow(luminance + (raw.b - luminance) * (1 - soften), 1.04), 0, 1),
  };
}

function cmykToRgb(cmyk, previewMode) {
  const c = clamp(cmyk.c, 0, 1);
  const m = clamp(cmyk.m, 0, 1);
  const y = clamp(cmyk.y, 0, 1);
  const k = clamp(cmyk.k, 0, 1);

  const rgb = {
    r: (1 - c) * (1 - k),
    g: (1 - m) * (1 - k),
    b: (1 - y) * (1 - k),
  };

  return previewMode === "screen" ? rgb : printPreviewRgb(cmyk);
}

function cmykLabel(cmyk) {
  return `C${Math.round(cmyk.c * 100)} M${Math.round(cmyk.m * 100)} Y${Math.round(cmyk.y * 100)} K${Math.round(cmyk.k * 100)}`;
}

function getSolidPaint(node, property) {
  if (!(property in node)) return null;
  const paints = node[property];
  if (!Array.isArray(paints)) return null;
  return paints.find((paint) => paint.type === "SOLID") || null;
}

function selectionSnapshot() {
  return figma.currentPage.selection.map((node) => {
    const fill = getSolidPaint(node, "fills");
    const saved = node.getPluginData("cmyk");
    let cmyk = null;

    if (saved) {
      try {
        cmyk = JSON.parse(saved);
      } catch (_error) {
        cmyk = null;
      }
    }

    if (!cmyk && fill) {
      const estimate = rgbToCmyk(fill.color);
      cmyk = {
        c: estimate.c * 100,
        m: estimate.m * 100,
        y: estimate.y * 100,
        k: estimate.k * 100,
      };
    }

    return {
      id: node.id,
      name: node.name,
      cmyk,
      hasFill: "fills" in node,
      hasStroke: "strokes" in node,
    };
  });
}

function sendSelection() {
  figma.ui.postMessage({
    type: "selection",
    selection: selectionSnapshot(),
  });
}

function readSavedCmyk(node) {
  const raw = node.getPluginData("cmyk");
  if (!raw) return null;

  try {
    const saved = JSON.parse(raw);
    if (!["c", "m", "y", "k"].every((key) => typeof saved[key] === "number")) return null;
    const isPercent = [saved.c, saved.m, saved.y, saved.k].some((value) => value > 1);
    const scale = isPercent ? 0.01 : 1;
    return {
      c: clamp(saved.c * scale, 0, 1),
      m: clamp(saved.m * scale, 0, 1),
      y: clamp(saved.y * scale, 0, 1),
      k: clamp(saved.k * scale, 0, 1),
      alpha: typeof saved.alpha === "number" ? clamp(saved.alpha, 0, 1) : 1,
      preview: saved.preview === "screen" ? "screen" : "print",
    };
  } catch (_error) {
    return null;
  }
}

function savedCmykMatchesPaint(savedCmyk, paint) {
  if (!savedCmyk || !paint || paint.type !== "SOLID") return false;
  const expected = cmykToRgb(savedCmyk, savedCmyk.preview);
  const difference = Math.abs(expected.r - paint.color.r) + Math.abs(expected.g - paint.color.g) + Math.abs(expected.b - paint.color.b);
  return difference < 0.06;
}

function metadataFor(cmyk, alpha, previewMode, source) {
  return JSON.stringify({
    c: Math.round(cmyk.c * 1000) / 10,
    m: Math.round(cmyk.m * 1000) / 10,
    y: Math.round(cmyk.y * 1000) / 10,
    k: Math.round(cmyk.k * 1000) / 10,
    alpha: Math.round(alpha * 1000) / 1000,
    preview: previewMode,
    source,
    profile: "Generic print simulation",
  });
}

function selectedNodesIncludingChildren() {
  const nodes = [];
  const seen = new Set();

  function visit(node) {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    nodes.push(node);
    if ("children" in node) {
      for (const child of node.children) visit(child);
    }
  }

  for (const node of figma.currentPage.selection) visit(node);
  return nodes;
}

function convertPaintArray(paints, previewMode, savedCmyk, useSavedCmyk) {
  if (!Array.isArray(paints)) return { paints, changed: false, cmyk: null, unsupported: 0 };

  let savedAvailable = Boolean(savedCmyk && useSavedCmyk);
  let firstCmyk = null;
  let unsupported = 0;
  const converted = paints.map((paint) => {
    if (paint.type === "SOLID") {
      const cmyk = savedAvailable ? savedCmyk : rgbToCmyk(paint.color);
      savedAvailable = false;
      if (!firstCmyk) firstCmyk = cmyk;
      return { ...paint, color: cmykToRgb(cmyk, previewMode) };
    }

    if (paint.type.startsWith("GRADIENT_") && Array.isArray(paint.gradientStops)) {
      return {
        ...paint,
        gradientStops: paint.gradientStops.map((stop) => {
          const cmyk = rgbToCmyk(stop.color);
          if (!firstCmyk) firstCmyk = cmyk;
          const rgb = cmykToRgb(cmyk, previewMode);
          return { ...stop, color: { ...rgb, a: stop.color.a } };
        }),
      };
    }

    unsupported += 1;
    return paint;
  });

  return { paints: converted, changed: converted.some((paint, index) => paint !== paints[index]), cmyk: firstCmyk, unsupported };
}

function convertSelection(previewMode, source) {
  let converted = 0;
  let preserved = 0;
  let unsupported = 0;
  let errors = 0;

  for (const node of selectedNodesIncludingChildren()) {
    try {
      const savedCmyk = readSavedCmyk(node);
      const savedFill = getSolidPaint(node, "fills");
      const usableSavedCmyk = savedCmykMatchesPaint(savedCmyk, savedFill) ? savedCmyk : null;
      let primaryCmyk = usableSavedCmyk;
      let changed = false;

      if ("fills" in node) {
        const result = convertPaintArray(node.fills, previewMode, usableSavedCmyk, true);
        if (result.changed) {
          node.fills = result.paints;
          changed = true;
        }
        primaryCmyk = primaryCmyk || result.cmyk;
        unsupported += result.unsupported;
      }

      if ("strokes" in node) {
        const result = convertPaintArray(node.strokes, previewMode, null, false);
        if (result.changed) {
          node.strokes = result.paints;
          changed = true;
        }
        primaryCmyk = primaryCmyk || result.cmyk;
        unsupported += result.unsupported;
      }

      if (changed && primaryCmyk) {
        node.setPluginData("cmyk", metadataFor(primaryCmyk, usableSavedCmyk ? usableSavedCmyk.alpha : 1, previewMode, source));
        converted += 1;
        if (usableSavedCmyk) preserved += 1;
      }
    } catch (_error) {
      errors += 1;
    }
  }

  const parts = [`Converted ${converted} layer${converted === 1 ? "" : "s"}`];
  if (preserved) parts.push(`${preserved} existing CMYK recipe${preserved === 1 ? "" : "s"} preserved`);
  if (unsupported) parts.push(`${unsupported} image/effect paint${unsupported === 1 ? "" : "s"} skipped`);
  if (errors) parts.push(`${errors} locked or unsupported layer${errors === 1 ? "" : "s"} skipped`);
  figma.notify(parts.join(" · "));
  figma.ui.postMessage({ type: "conversion-result", converted, preserved, unsupported, errors, source });
  sendSelection();
}

function applyColor(cmyk, alpha, target, previewMode) {
  const rgb = cmykToRgb(cmyk, previewMode);
  const paint = { type: "SOLID", color: rgb, opacity: clamp(alpha, 0, 1) };
  const metadata = metadataFor(cmyk, alpha, previewMode, "manual");

  let changed = 0;
  for (const node of figma.currentPage.selection) {
    if (target === "fill" && "fills" in node) {
      node.fills = [paint];
      node.setPluginData("cmyk", metadata);
      changed += 1;
    }
    if (target === "stroke" && "strokes" in node) {
      node.strokes = [paint];
      node.setPluginData("cmyk", metadata);
      changed += 1;
    }
  }

  if (!changed) {
    figma.notify(`Select a layer that supports a ${target}.`);
  } else {
    figma.notify(`${target === "fill" ? "Fill" : "Stroke"} applied to ${changed} layer${changed === 1 ? "" : "s"}.`);
  }
  sendSelection();
}

figma.on("selectionchange", sendSelection);
sendSelection();

figma.ui.onmessage = async (message) => {
  if (message.type === "apply") {
    applyColor(message.cmyk, message.alpha, message.target, message.previewMode);
  }
  if (message.type === "convert-selection") {
    convertSelection(message.previewMode, "selection");
  }
};
