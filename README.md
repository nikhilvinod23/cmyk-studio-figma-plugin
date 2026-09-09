# CMYK Studio — Figma plugin MVP

CMYK Studio adds a CMYK-first color workflow to Figma. It includes:

- A visual hue/chroma color wheel with lightness control.
- A generic print-simulation preview that reduces chroma and applies approximate dot gain.
- Exact C, M, Y, and K sliders and numeric fields.
- Fill and stroke application to the current selection.
- Batch conversion of selected layers and descendants, including solid and gradient paints.
- Clipboard bridge for Figma's native eyedropper, accepting copied Hex or RGB values.
- CMYK recipe metadata stored on edited layers.
- A live selection summary that reads saved CMYK metadata when available.

## Install for development

1. In Figma, open **Plugins → Development → Import plugin from manifest…**.
2. Choose `manifest.json` in this folder.
3. Run **Plugins → Development → CMYK Studio**.

The manifest includes a development ID so private CMYK metadata can be stored. Before publishing, replace it with the plugin ID assigned by Figma; changing the ID later makes previously stored private metadata inaccessible to the new plugin ID.

## Important production note

The print-simulation mode intentionally does more than a reversible CMYK/RGB conversion: it applies approximate dot gain, paper tint, midtone darkening, and chroma compression so vibrant colors visibly soften on screen. This is still not a press proof. CMYK is device/profile dependent, so a production version should replace the conversion with an ICC transform using the printer’s supplied profile. Figma still receives an RGB paint; the original CMYK recipe is preserved in plugin metadata.

The batch converter preserves recipes previously created by this plugin. For untagged RGB layers, it derives the closest approximate CMYK recipe from each solid or gradient-stop color. Images and effect paints are reported but not raster-converted.

For image pixels or complex strokes, use Figma’s native eyedropper to copy a sampled color, paste the Hex/RGB value into **Sampled color from Figma**, choose **Use color**, and then apply it as a fill or stroke. A hash is optional. In Figma, press `Esc` to deselect, press `I` to activate the native eyedropper, click the source pixel or stroke, then paste the copied value into the plugin. Re-select the target layer before applying the converted color.
