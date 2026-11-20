# How to use the viewer

Organised by what you want to do. Words: a **plot** is one chart (a **map** is a 2D one); plots docked together are a
**figure**; everything on screen, saved by name, is a **desktop**; a **dataset** is one simulation run; a **tool** is
something you add to a plot (lines, fits, …). Hover almost anything for a short help box.

Start: `python serve.py 8765` (add `--project projects/<name>` for your data manager project), then open
`http://localhost:8765/viewer/`.

## The screen

- **One plot large, the others small at the side.** Click a small one to make it the large one; Tab / Shift+Tab step
  through them. Hover a small one to see it bigger.
- **Header:** `+ map`, `+ 1D plot`, save / open desktops, templates, undo / redo (Ctrl+Z / Ctrl+Shift+Z), theme.
- **Sidebar tabs:** Variables · Functions · Expressions · Tools · Tables.
- **Footer:** the time slider, play, frames per second, plot size, what is downloaded ahead (precache).

## See a quantity

| I want to … | Do this |
|---|---|
| see a map at the slider's time | `+ map` → dataset and quantity |
| see a quantity over time, or a profile | `+ 1D plot` → x axis → `+ line` (dataset, quantity, the value of every other axis) |
| change axes, colours, ranges, log scale, smoothing | the plot's ⚙ (settings box); click a title, axis label or colour bar to edit it |
| edit or style one line | click its legend entry |
| compare datasets | `+ dataset` in a plot's header (its lines for another dataset), or a **dataset list** variable: one curve per dataset |
| see the same plot for another dataset | the plot's ⋯ → "copy with another dataset" |
| zoom / pan | wheel / drag inside the plot; double-click resets |

## Measure

| I want to … | Do this |
|---|---|
| mark a value, a band or a point | Tools tab → drag a draw tool (horizontal / vertical line, band, point) onto the plot |
| read a max, mean, crossing … off a curve | a line tool "from each curve", or a **reading** (Variables → reading): it becomes a variable you can use anywhere |
| cut a map along one axis | the **lineout** tool on a map: click the map to move it, shift-click to add one; its curves go to a linked 1D plot |
| contours on a map | the **contours** tool |
| a fit, period, steps, averaged curve | the analysis tools (Tools tab; from the `analysis` plugin) |
| collect numbers over many runs | a tool's card → `→ table`; the Tables tab lists them; `plot…` draws a table |
| a slope, rate or ratio of stored quantities | `+ line` → "slope of…" / "rate of…", or an **expression** (Expressions tab: a formula of stored quantities, computed when drawn) |
| an analytic curve to compare with | Functions tab → a formula with `{parameters}`; `+ line` → analytic |

Numbers anywhere can be **variables**: type `$name`. A number variable that is a list draws one curve per value.

## Arrange and keep

| I want to … | Do this |
|---|---|
| put plots side by side as one figure | drag a plot by ⠿ onto a dock tab (◀ ▶ ▲ ▼) of another; they then share pan & zoom (same axes only) |
| share or separate a setting inside a figure | the 🔗 at the end of each row in ⚙ |
| reorder | drag a plot by ⠿ into the side strip |
| save the screen | `💾 save` (desktops… to open, save as, delete); desktops live on the server (`views/`) |
| reuse a plot in any desktop | ⋯ → "save as template…"; `templates…` inserts it |
| an image or a movie | ⋯ → PNG / 🎬 movie (movies need ffmpeg on the server) |

## Get more data

The **data manager** page (`viewer/datamgr.html`; the header's 🗂 data button): datasets are columns, quantities are rows; click a cell
to compute it. A quantity the viewer can't find says "compute it in the data manager". Adding your own data:
`BRING_YOUR_DATA.md`.

## Plugins

Physics- or data-specific tools come from plugins listed in `viewer/plugins/index.json` (`?plugins=a,b` in the address
picks others for one visit; `?plugins=` none). The `aperture4` plugin is an example for one kind of simulation;
`viewer/plugins/README.md` explains writing one.
