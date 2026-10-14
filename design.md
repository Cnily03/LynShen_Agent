---
name: aogiri-desktop-design
description: Presentation rules for the Aogiri desktop app window (Tauri + Svelte; called LynShen Desktop up to 0.5) — the window frame and title bar, the navigator and its collapsed rail, the workbench canvas with the conversation and tool panels, pages that cover the canvas, full-panel pages, the first-run page, popovers and dialogs. For a dense developer tool used for hours at a time, in Chinese and English, in light and dark themes.
version: 2026-10-14
---

# Aogiri desktop design.md

## 1. Scope and Priority

Applies to every surface inside the desktop window: the title bar, the navigator (expanded, or collapsed to its icon rail), the canvas and its tiles, pages that cover the canvas, full-panel pages, the first-run page, popovers, menus, modals and toasts. Light and dark themes.

Does not apply to: the phone remote page (`src/routes/remote`), the web chat (`src/routes/(web)`), the marketing site, the CLI TUI, or the `/workbench` dev demo.

Conflict order: user facts and requirements → accessibility and keyboard use → the reader's current task (the conversation) → the conventions below → brand expression → decoration.

- The brand direction is open: the owner rejected two proposed directions. Until one is chosen, pages follow the current system in this file. Do not introduce a new type pairing, palette, surface style or composition. [MUST]

## 2. Brand and Readers

- Readers are developers who keep the window open all day beside an editor. They scan long transcripts, diffs and terminal output. Desktop pointer and keyboard; minimum window 1040 × 680.
- "Quiet": near-black, off-white and neutral grays carry the interface (slightly warm in the light theme). Color appears only for meaning (state, error, focus, links). [SHOULD]
- "Dense but calm": list and menu rows are 38px, body text 15–16px, and separation comes from fills and spacing, not from outlines. [SHOULD]
- Copy tone: short, plain, second person. Labels name the object ("终端", "Git"), buttons name the action ("在浏览器中授权"). No exclamation marks, no marketing words. [SHOULD]

## 3. Page Structure and Composition

### Window frame (all page types)
- The window is two bands. On top, a 48px title bar across the full width. Below it, the navigator and the canvas side by side, flush with the window's left, right and bottom edges. Nothing sits left of the navigator. [SHOULD]
- The frame fill is `--rail` (the window chrome). The title bar has no fill, border or shadow of its own, so it shows `--rail`. On macOS the frame rounds its corners to the window (12px); on Windows and Linux it is square. [SHOULD]
- The canvas uses `--bg` with no corner radius, border or shadow. The navigator and the canvas are divided by their fills only. [SHOULD]

### Title bar
- Left: a lead area as wide as the navigator (it follows the navigator's width and its collapse animation), or as wide as its own contents when they are wider: on macOS the traffic lights take an 84px inset, so with the navigator collapsed the lead is wider than the rail and the title starts right of the canvas edge. The lead holds the navigator toggle (`SidebarSimpleIcon`). [SHOULD]
- Middle, starting at the canvas's left edge: the title of the object in front (`--fs-sm`/500, `--text`, ellipsized), then its context (`--fs-xs`, `--dim2`), for example the conversation title and then the project name. Full-panel pages show their page name with no context. [SHOULD]
- Right: the front object's actions and the "+" menu that opens a panel beside the focused tile. Title bar buttons are 34px squares, `--r-sm`, 18px icons, `--dim`, with a `--surface2` fill and `--text` on hover. [SHOULD]
- On Windows and Linux three drawn window controls end the bar: 46px wide, full bar height, `--dim`; the close control turns `--err` with `--on-accent` on hover. macOS keeps its native traffic lights. [SHOULD]
- The first-run page hides the navigator toggle. [SHOULD]

### Navigator
- Expanded: 240–460px wide (the user drags its right edge; default 292px), `--sidebar` fill, no border. From top to bottom: the logo mark (a 30px `--text` tile with the mark in `--bg`) with the wordmark (`--fs-lg`/700), the primary navigation rows, a toolbar of quiet 30px icon buttons, the list, and the account row at the bottom. [SHOULD]
- Collapsed (⌘B or the title bar toggle): the same panel narrows to the icon rail, `SIDEBAR_RAIL_WIDTH` (62px). This is the window's only vertical rail. It shows the logo (which expands the navigator and shows the panel icon on hover), the primary navigation as 18px icons with tooltips to their right, a dot on an icon for a pending count, and the account avatar. Labels and lists fade out; the icons keep their position, centred on the rail. [SHOULD]
- Peek: hovering or focusing the collapsed rail opens the full navigator over the canvas; the canvas does not move. The open panel has the `--sidebar` fill, a 1px `--border` right edge and a soft shadow. It folds back when the pointer leaves. [SHOULD]
- Full-panel pages lay out their own navigation at the expanded width, whether the navigator is collapsed or not. [SHOULD]
- The account row (28px avatar, name, balance) opens the account card: a `.pop` surface above the row, or to the right of the avatar on the rail. It holds an identity block, at most two summary lines that link to the account page (a quota shows as a slim meter), then `.pop-row` actions with the destructive action last in `--err`. Preferences such as theme and currency are not in the card. [SHOULD]

### Workbench canvas (conversation + tools)
- First viewport: the conversation fills the canvas. The transcript column is centred, and its width `--chat-w` follows the chat pane. The default setting ("自适应") is 75% of the pane width, at least 844px where the pane has room and at most 1120px. The setting also offers "标准" (844px) and "铺满" (the pane minus its side padding). The pane keeps 32px beside the column on each side, 56px while the turn rail shows. On a narrow pane the column keeps 640px while the pane can hold it with 32px each side; below that it shrinks with the pane and keeps the 32px. The composer, the approval card and the trays above the composer share the column's width. [SHOULD] — Decision 2026-10-13: user feedback that a widened window left large blank margins beside a fixed 844px column; the cap keeps lines readable, and the setting covers both tastes.
- Turn rail: with two or more user messages, `TurnRail` shows one tick per user message in the left gutter of the chat pane, 4px from the pane's edge, centred vertically. A tick is an 18 × 2px bar in `--dim2` at 55% opacity, drawn at 56% of its length; the tick in view is longer and `--text`; at most 30 ticks show and the edge ticks fade where more lie beyond. Hovering a tick previews that message in one line on a `--panel` popover with `--shadow-pop`; clicking it scrolls there. [SHOULD]
- The turn rail sits in the gutter outside the text column and never overlaps text, at any pane width. Its ticks end 26px from the pane's edge, and the text column starts at least 32px from it. [MUST]
- Strips at the top of the transcript (the session's owner line, the background-task strip, the find bar) sit above the scrolling transcript, never over it. Each has an opaque fill, `--bg` (the find bar `--panel`), and a `--hairline` bottom edge; over a custom background it shows the canvas veil like the rest of the canvas. Scrolled content never shows through a strip. A strip that stays visible while the transcript scrolls is placed outside the scroll area; if it is sticky inside one, it takes an opaque `--bg` fill, with no transparency, blur or gradient. [MUST]
- Composer: a box (`--panel`, `--r-2xl`, `--shadow-float`, `--shadow-float-strong` while focused) holding the text (`--fs-md`) and, at its right end, the voice and send buttons (round; send uses `--accent`). Under the box, one slim footer row, edges aligned with it: add, mode and branch at the left; model, effort and context at the right. Footer controls are plain text buttons (30px, `--fs-sm`, `--dim`, `--surface2` fill on hover), no borders; the branch is mono `--fs-2xs` `--dim2`. Suggestion, slash and question trays open inside the box above the text. [SHOULD]
- Composer modes: the footer's mode label opens the mode menu upward. It is a `.pop` with a head line (title, and the cycle key, ⇧Tab on macOS, in mono `--dim2`), then one two-line `.pop-row.two` per mode: label with an optional "推荐" tag (`--fs-2xs`, `--dim` on `--surface2`, `--r-full`), a `.pop-desc` line that wraps inside the row, a check column for the current mode, and the mode's digit in mono `--dim2`. A risky mode's label is `--warn` in the menu and in the footer. The menu stays inside the window and scrolls its rows when the space above the label is short. [SHOULD]
- Tool panels (git, terminal, files, plan, changes, browser, …) open beside the conversation, in a leaf to its right with 42% of the area. Later tools stack as tabs in that leaf. A tool must not replace the conversation in its leaf while the chat would keep at least 560px after the split. Below that width the tool stacks as a tab in the chat leaf. The exception is the user's preference to open tool windows as tabs next to the conversation. [MUST]
- A canvas with one leaf and one tab hides the tab bar. With two or more tabs the bar shows: tabs `--fs-sm`, at least 30px high, at most 240px wide, `--r-md`; the active tab has a `--surface2` fill and `--text`; the bar has a `--hairline` bottom edge. Leaves split with a 2px `--hairline` gutter. [SHOULD]
- A file opened from a message opens as a tab in the side leaf, one tab per file, labelled with the file name and no glyph. The tab shows a header row and then the viewer: read-only code, a fitted image, folded records, or a facts card for a file it cannot show. Prose files read in a 760px column. [SHOULD]
- An approval request is a card in the column above the composer: `--panel`, 1px `--border`, `--r-lg`, `--shadow-float`. Its head line is `--fs-sm`/500. Facts sit on key–value lines (`--fs-xs`; key `--dim`; a value is one ellipsized line, paths and commands in mono), and a long command opens to its full text. Actions are `size="sm"` buttons in one wrapping row: one primary, secondary choices after it, then the danger action; ghost utilities, if any, at the far right. [SHOULD]

### Pages that cover the canvas (home, project)
- With no conversation in front, the home page covers the canvas; the navigator stays. Content is one centred column, 760px (1120px for wide boards), starting 72px from the top with a centred `h1` (`--fs-xl`/600), then the start box (`--panel`, 1px `--border`, `--r-lg`), then sections. A project page uses the same column. [SHOULD]
- The canvas never shows an empty state of its own when there is no conversation. The empty state of the tile area (no open tab) is one `--fs-md` line, one `--fs-xs` `--dim2` hint, one primary action and a grid of panel buttons, centred. [SHOULD]

### Full-panel page (settings, workbench overview)
- The page covers the navigator and the canvas. Its navigation column, at the navigator's expanded width, starts with a back arrow and an `h2` (`--fs-lg`/600), then a search field and a flat list of items (34px; the selected item has a `--surface2` fill and a filled icon). Groups of items are divided by a hairline gap, not by headings. [SHOULD]
- Settings content: a left-aligned column, max-width 680px plus 48px padding each side, starting with an `h1` (`--fs-lg`/600). Sections have an `h3` (`--fs-sm`/600) with an optional `--fs-xs` `--dim` description, then plain rows (at least 56px) divided by `--hairline`. There is no card around a section. [SHOULD]
- Workbench overview content: a centred column, 760px for reading lists, 1120px for wide boards, with an `h1` (`--fs-xl`/600). [SHOULD]
- A quota or usage figure shows as text with a 4px meter under it. [SHOULD]

### First-run page
- It covers the window below the title bar (all of it on macOS) on `--bg`. One copy column at the left (at most 440px): the wordmark, an `h1` (`--fs-2xl`), a lede (`--fs-md`, `--dim`), then the action column (at most 320px): one primary action, at most one secondary action, then a text link to skip or go back. The `SignalRaster` field fills the right part of the window behind the copy, with masked fades. The legal line sits at the bottom left in `--fs-xs`. [SHOULD]

## 4. Visual Rules

### Type
- Sans: `--font-sans` (Inter Variable, then PingFang SC / Noto Sans SC). Mono: `--font-mono` (Geist Mono Variable) for code, paths, branches, token counts and keyboard keys. [SHOULD]
- Every font size uses a `--fs-*` step. No literal px sizes in component styles. Markdown inside a message sizes its headings and code in `em` of the body size. [MUST]
- Roles: canvas-page and overview titles `--fs-xl`/600 · first-run title `--fs-2xl` · settings page title and navigation heads `--fs-lg`/600 · settings section heads `--fs-sm`/600 · chat body and inputs `--fs-md`/400, line-height 1.55–1.6 · lists, tabs, controls, title bar title `--fs-sm` · metadata, descriptions, title bar context `--fs-xs` · badges, mono labels `--fs-2xs`. [SHOULD]
- Numbers in stats and badges use the mono font with tabular figures. [SHOULD]

### Color
- Only the tokens in `src/lib/app.css` (`:root` dark, `[data-theme='light']` light). No color literals in component styles, except `color-mix()` over tokens and the fixed dark overlay of the full-window image viewer. [MUST]
- `--accent` is the neutral emphasis: primary buttons, selected state, counts. `--brand` / `--brand-bright` are for links and the focus ring only. [SHOULD]
- Status: `--ok` success, `--info` information, `--warn` caution, `--err` error. An error surface uses `color-mix(in oklab, var(--err) 10–11%, transparent)` with `--err` text. [SHOULD]
- Text: `--text` primary, `--dim` secondary, `--dim2` tertiary (section heads, hints). Primary information never uses `--dim2`. [MUST]
- Light theme: no surface larger than a card, a menu or an input is pure white. `--bg` is an off-white with CIE L* between 95.5 and 97 and a slightly warm, low-chroma hue. `--sidebar` and `--rail` are each one visible step darker than the layer in front of them. `--panel` may be lighter than `--bg`, up to L* 99. The dark theme is unchanged. [MUST] — Decision 2026-10-13: user feedback that the white light theme is glaring while the dark theme is comfortable; the warm hue matches the Aogiri brand.
- Contrast, both themes, measured on `--bg`, `--sidebar` and `--rail`: `--text` at least 12:1, `--dim` at least 7:1, `--dim2` at least 4.5:1. A status color used as text is at least 4.5:1 on the surface it sits on. [MUST]
- Launch: the native window background and the first painted frame use the active theme's `--bg`. A white frame must not show before the interface in either theme. [MUST]

### Surfaces and depth
- Layers back to front: `--rail` (window chrome) → `--sidebar` (navigator) → `--bg` (canvas) → `--panel` with `--shadow-float` (composer, cards) → `--panel` with `--shadow-pop` (menus, popovers) → `--shadow-modal` (dialogs). [SHOULD]
- Strokes are `--hairline`. `--border` outlines only inputs, buttons and a few floating controls (the approval card, the home start box, the peeking navigator's edge). [SHOULD]
- Radii use `--r-*`: rows and tabs `--r-md`, cards and menus `--r-lg`, chat bubbles `--r-xl`, composer `--r-2xl`, pills `--r-full`. Exceptions: marks under 4px (ticks, key glyphs, 1–3px) and the macOS window frame (12px, the system corner). [MUST]
- Window frost ("窗口磨砂": macOS vibrancy, Windows Mica) is off by default. When it is off, no native effect is applied, and on Windows the window is opaque, not transparent. [MUST] — Decision 2026-10-13: user feedback that the frost does not match the interface; on Windows a transparent window with Acrylic lags behind the pointer while it is dragged.
- When window frost is on, only the window chrome (`--vibrancy-chrome` over `--rail`) and the navigators (`--vibrancy-tint` over `--sidebar`) let it show. Their fills stay opaque enough that the contrast rule above holds over a white and over a black backdrop. The canvas, panels and the title bar text stay opaque. On Windows the effect is Mica (Windows 11); there is no Acrylic fallback. [SHOULD]
- Glass (Settings → 通用 → 玻璃透明度) thins floating surfaces to `--float-tint` with `--glass-filter` and a light rim (`--glass-rim`): the composer, the approval card and toasts. Menus and popovers (`.pop`) stay solid `--panel` at every level, so text behind them never shows between their rows. They keep the rim. [MUST] — Decision 2026-10-14: review of the mode menu, where the transcript's hints showed through it (in WebKit even a 98% fill let them through).
- A custom background image (Settings → 通用 → 背景) covers the whole window. The chrome lets it through at `--chrome-tint`; the canvas lays a veil of `--bg` over it (`--canvas-veil`); the conversation column sits on a blurred, feathered plate. Floating surfaces keep their fills. [SHOULD]

### Controls and states
- Hover: a `--surface2` fill. Selected: `--surface2` fill and `--text` color. Unselected tabs and nav items: `--dim` until hover. [SHOULD]
- Focus: keyboard focus shows the global `:focus-visible` ring (2px `--brand-bright`, offset 2px). Text inputs show focus through their border. Do not remove the ring. [MUST]
- Disabled: opacity 0.4–0.45 and the default cursor. [SHOULD]
- Row actions in lists appear on hover and on `:focus-within`, not only on hover. [MUST]
- Loading: the `.spin` class on a Phosphor `CircleNotchIcon`. Live state: the `.pulse` class. [SHOULD]
- Empty states: one line of `--dim` text in the place where the list would be. No illustrations in tool panels. [SHOULD]
- Errors in a conversation: an inline card with title, one line of cause, then the fixing action as a button and raw details behind a disclosure. [SHOULD]

### Menus and popovers
- Every menu and picker uses the `.pop` surface: `--panel`, `--r-lg`, `--shadow-pop`, 6px padding. Rows are `.pop-row`: at least 38px, `--r-md`, `--fs-sm`, an 18px `--dim` icon column, a `--surface2` fill on hover and on the keyboard selection. A two-line row (`.two`) adds a `.pop-desc` line (`--fs-xs`, `--dim2`). A risky row (`.warn`) colors its icon, label and check `--warn`. [SHOULD]
- A menu opens from its anchor (`drop-in` downward, `pop-in` upward, `--t-pop`) and stays inside the window: it flips to the side with room and scrolls its own rows when neither side holds it. A click outside, Escape or a selection closes it. [SHOULD]

### Status, attention and emphasis
Decision 2026-10-14 for this section. The owner's feedback was that a prototype with glowing groups, glyph bullets, pills and shortcut chips everywhere "looks machine-made". To be implemented in: the session list's waiting mark, the approval card's head icon, tag and inner block fills, the plan card's status tag, the progress tray.
- An item that waits for the reader (an approval, a question) shows a 6px `--warn` dot before its title. The reason is `--dim` text on the line below. A list of such items has a plain `--fs-xs` 600 `--dim2` heading with its count. The heading has no fill, border, glow or colored text. [SHOULD]
- Status, risk and scope inside a card are plain `--dim` text, joined with " · ". A status color appears only as one 6px dot, or as the text color of an error. [SHOULD]
- A multi-step task shows its progress as one line of text in the conversation column, on the composer's top edge: the plan label, the count and the current step, for example "计划 3/7 · 跑单元测试". The line has no ring, segmented bar or colored beads. Opening it shows the checklist as the plan tool panel (`plan`, tab 计划) in the right leaf, beside the changes panel (`changes`, tab 改动), placed by the tool panel rule in §3. The checklist does not expand in place as a card or tray. A bar shows only byte or time progress. [SHOULD] — Decision 2026-10-14 (owner): the conversation keeps one quiet line; the checklist is a tool beside it. Today `ProgressTray` still opens upward as a tray.
- In the transcript, only the item that needs the reader's action is raised (`--panel` + `--shadow-float`). Earlier turns, summaries and finished cards sit flat on `--bg`. Blocks inside a raised item use a `--surface` fill, never a second shadow or border. [SHOULD]
- A view region has one primary button. Secondary actions are `secondary` or `ghost` buttons, or a menu. [SHOULD]

### Icons
- Phosphor (`phosphor-svelte`), regular weight; `fill` marks the selected nav item. Navigation and title bar icons 18px, row actions 16px, tab and inline icons 11–13px. Icons beside a label are `aria-hidden`. [SHOULD]

### Motion
- Use the keyframes in `app.css` (`scrim-in`, `sheet-in`, `pop-in`, `drop-in`, `pane-in`, `msg-in`, `rise`, `fade`, `spin`, `pulse`) with the `--t-*` durations (`fast`, `med`, `base`, `slow`, `pop`, `exit`, `enter`) and the `--ease-*` curves. Switching conversations and pages crossfades only the canvas. Exits use the Svelte transitions in `src/lib/ui/motion.ts`. A window being resized runs no transitions. Reduced motion collapses all animation (global media query). [MUST]

## 5. Available Primitives

| Role | Name | Source | Use | Status |
|---|---|---|---|---|
| Tokens | `--bg` `--sidebar` `--rail` `--panel` `--surface` `--surface2` `--hairline` `--border` `--border-strong` `--text` `--dim` `--dim2` `--accent*` `--on-accent` `--brand*` `--ok` `--info` `--warn` `--err` `--font-sans` `--font-mono` `--fs-*` `--r-*` `--t-*` `--ease-*` `--shadow-*` `--scrim` | `src/lib/app.css` | All styling | Implemented |
| Glass, frost, background | `--float-tint` `--chrome-tint` `--glass-filter` `--glass-rim` `--glass-strong` `--vibrancy-chrome` `--vibrancy-tint` `--canvas-veil`; root attributes `data-glass` `data-vibrancy` `data-canvas-bg` | `src/lib/app.css`, `src/lib/prefs.svelte.ts` | Set by preferences; components read them, never set them | Implemented |
| Window frame | `.app` (`--rail`), `.body`, `.panel`, `.canvas` (`--bg`), `.stage` | `src/routes/+page.svelte` | The one frame | Implemented |
| Title bar | `TitleBar` `leftWidth` `sidebarOpen` `onToggleSidebar` `showToggle` `title` `subtitle` `addOptions` `actions` | `src/lib/shell/TitleBar.svelte` | The window's only title bar | Implemented |
| Navigator | `Sidebar` `width` `collapsed`; `SIDEBAR_RAIL_WIDTH` (62) | `src/lib/Sidebar.svelte`, `src/lib/shell/sidebarState.ts` | Expanded panel or the icon rail | Implemented |
| Account row and card | `SidebarFooter` (`collapsed`), `AccountCard` (`side: top｜right`) | `src/lib/workbench/` | Bottom of the navigator | Implemented |
| Button | `Button` `variant: primary｜secondary｜ghost｜danger｜success`, `size: sm｜md｜icon`, `full` | `src/lib/ui/Button.svelte` | One `primary` per view region | Implemented |
| Icon button | `IconButton` `size: xs｜sm｜md`, `label` | `src/lib/ui/IconButton.svelte` | Icon-only actions; pass a `label` | Implemented |
| Segmented | `Segmented` `value` `options` `onChange` | `src/lib/ui/Segmented.svelte` | 2–4 exclusive options in a settings row | Implemented |
| Switch, Checkbox, Select, TextField | same names | `src/lib/ui/` | Settings rows and forms | Implemented |
| Chip, Collapse | `Chip` (`selected`), `Collapse` (`open`) | `src/lib/ui/` | Toggle chips in pickers; animated disclosure | Implemented |
| Notice | `Notice` `tone: error｜warn｜info`, `mono` | `src/lib/ui/Notice.svelte` | Inline messages inside panels and forms | Implemented |
| Modal | `Modal` `placement: center｜top`, `width`, `footer` | `src/lib/ui/Modal.svelte` | Dialogs (frosted sheet on `--glass-strong`) | Implemented |
| Menus | `PopMenu` (`items`, `placement: up-left｜up-right｜down-left｜down-right`, `fit`); global classes `.pop` `.pop-head` `.pop-row` `.two` `.warn` `.pop-ico` `.pop-txt` `.pop-label` `.pop-desc` `.pop-hint` `.pop-check`; `fitMenu` | `src/lib/ui/PopMenu.svelte`, `app.css`, `src/lib/ui/menuFit.ts` | Every menu and picker | Implemented |
| Tooltip | `title` or `data-tip` (+ `data-tip-side="right"`) | `src/lib/ui/TooltipHost.svelte` | Every tooltip; no native tooltips | Implemented |
| Shortcut text | `shortcutLabel(id)`, `withShortcut(label, id)` | `src/lib/shortcuts.ts` | Keys in menus and tooltips | Implemented |
| Toast, confirm | `toast.info｜success｜warn｜error`, `confirm()` | `src/lib/ui/toast.svelte.ts`, `confirm.svelte.ts` | Transient feedback, destructive confirmation | Implemented |
| Settings layout | `SettingsSection` (`title` `description` `action`), `SettingsRow` (`stacked`) | `src/lib/settings/` | Every settings page | Implemented |
| Canvas | `Mosaic` (`hideSoloBar`); `openElsewhere`, `openChatTab`, `TOOL_SIDE_RATIO` (0.42), `TOOL_SPLIT_MIN_CHAT` (560); `splitLeaf` | `src/lib/workbench/Mosaic.svelte`, `canvas.ts`, `tiles.ts` | All tile placement | Implemented |
| Chat column | `--chat-w`, `--chat-pad`; `chatColumnWidth`, `chatColumnPad`, `CHAT_PAD` (32), `CHAT_PAD_RAIL` (56) | `src/lib/chatWidth.ts`, `src/lib/ChatPane.svelte` | Transcript, composer, approval card and trays | Implemented |
| Turn rail | `TurnRail` `marks` `current` `onJump` | `src/lib/TurnRail.svelte` | Left gutter of the chat pane | Implemented |
| Top strips | owner line `.owner`, `TaskStrip`, `FindBar` | `src/lib/ChatPane.svelte`, `src/lib/TaskStrip.svelte`, `src/lib/shell/FindBar.svelte` | Above the transcript | Implemented |
| Composer | `Composer`, `ModeMenu` (`items` `current` `onSelect` `onCycle`; `ModeItem.tone: 'warn'`), `ComposerTray` | `src/lib/Composer.svelte`, `src/lib/composer/` | The chat input | Implemented |
| Approval card | `ApprovalCard` | `src/lib/ApprovalCard.svelte` | A request that waits for the reader | Implemented |
| Plan progress | one progress line; `PlanPanel` (`plan`) in the side leaf | `src/lib/agents/ProgressTray.svelte` (today), `src/lib/PlanPanel.svelte` | Multi-step task progress | Line: to be implemented |
| File preview | `FilePreview` (`path` `root`); panel `preview:<path>` (`previewPanel`) | `src/lib/preview/` | A file opened from a message | Implemented |
| Session title | `shownTitle(title)` | `src/lib/chat.svelte.ts` | Show any session title (translates the placeholder) | Implemented |

Menu row, as `PopMenu` renders it (hand-built menus use the same nesting):

```svelte
<div class="pop" role="menu">
  <button class="pop-row" role="menuitem">
    <span class="pop-ico"><GearIcon size={18} /></span>
    <span class="pop-txt"><span class="pop-label">设置</span></span>
    <span class="pop-hint">⌘,</span>
  </button>
  <!-- A two-line row: class "pop-row two", and a <span class="pop-desc"> after the label inside .pop-txt. -->
</div>
```

Extension boundary:
- Pages use only the names above. Do not guess unlisted components or tokens.
- Page-specific classes are scoped Svelte styles. Global additions to `app.css` must be tokens or shared surfaces used by two or more components.
- Scoped styles may lay out primitives but must not change their typography, radius, fill or states.

## 6. Copy and Number Formats

- All visible text and every `aria-label` comes from `t()` (`src/lib/i18n/messages/*`), with zh and en entries. No literal English in markup. [MUST]
- The app's name is "Aogiri" (梧桐). The account, the engine and the gateway keep the name "LynShen". [MUST]
- Titles are nouns ("终端", "提交历史"). Buttons are verbs ("拉取", "重新打开授权页面"). Errors: what failed, then what to do ("在设置中重新登录 LynShen 后再试。"). [SHOULD]
- Durations `48.3s`, tokens `18.4k` with ↑ input / ↓ output, line changes `+42 −7`, in mono. Placeholder for a missing value: `—`. [SHOULD]
- A shortcut shows in three places only: as `.pop-hint` text at the right of a menu row (a mode menu's digits in mono `--dim2`), after the label in a tooltip ("收起侧栏 · ⌘B", `withShortcut`), and as bordered `kbd` chips on the shortcuts page and dialog. Use `shortcutLabel` (Ctrl on Windows and Linux). Buttons, nav items, list rows and input placeholders do not show shortcuts. [SHOULD] — Decision 2026-10-14, same feedback as "Status, attention and emphasis". To be implemented in: the empty conversation's hint line and the suggestion placeholder. Open: the approval card's buttons show digit keys.
- An input placeholder names the action in a few words ("回复", "输入 / 使用命令"). It does not list options or shortcuts. [SHOULD]
- A prototype or a page with sample data shows one `--dim2` line "原型 · 示例数据" outside the window frame. It shows no design annotations, rule numbers or imitation OS chrome. [SHOULD] — Decision 2026-10-14.

## 7. Anti-Patterns

- A second vertical rail or column beside the navigator (for workspaces, accounts or settings). The collapsed navigator is the window's only rail. [MUST]
- A turn rail, marker or gutter control that overlaps the text column. [MUST]
- A strip pinned over the transcript with a transparent, translucent or blurred fill. [MUST]
- A tool panel that replaces the visible conversation when there is room to split. [MUST]
- Literal English `aria-label`s or titles in the Chinese UI. [MUST]
- A centered hero with a card grid as the default structure of a page. [SHOULD]
- Cards inside cards. [SHOULD]
- Decorative icon tiles or colored icon backgrounds. [SHOULD]
- Font sizes, font weights, radii or colors outside the tokens. [SHOULD]
- Small low-contrast (`--dim2`) text for primary information. [SHOULD]
- Pill labels for ordinary metadata (pills are for counts and state only). [SHOULD]
- Outlines around rows or tabs to show selection (use the fill). [SHOULD]
- Brand purple as a fill or button color. [SHOULD]
- Glow, halo, rim light or a tinted container to make a group stand out. [SHOULD]
- Glyph bullets (◆, ▲, ●●●) or an icon in front of a card title to signal status. [SHOULD]
- A checklist that expands in place in the conversation. [SHOULD]
- Tokens that `src/lib/app.css` does not define, including in prototypes. [MUST]

## 8. Implementation and Integration

- Style entry: `src/lib/app.css`, imported once in `src/routes/+layout.svelte`. Component styles are scoped `<style>` blocks.
- Fonts: `@fontsource-variable/inter` and `@fontsource-variable/geist-mono`, imported at the top of `app.css`.
- Theme: `initTheme()` / `setTheme()` in `src/lib/theme.svelte.ts` set `data-theme` (`light｜dark`, resolved from `system｜light｜dark`) on `<html>`. Platform and preference attributes on `<html>`: `data-os`, `data-vibrancy`, `data-glass`, `data-canvas-bg` (`src/lib/prefs.svelte.ts`).
- Icons: `phosphor-svelte`, defaults set by `IconContext` in `+layout.svelte` (regular weight, `aria-hidden`).
- Browser fixtures for rendered checks: `tests/browser` (`?shell`: the frame with one conversation; `&theme=light`, `&preview`, `&empty`).

## Glossary

| Concept | Name in code |
|---|---|
| Window frame | `.app` in `src/routes/+page.svelte` |
| Title bar | `TitleBar` |
| Navigator (expanded) / icon rail (collapsed) | `Sidebar` (`collapsed`), `SIDEBAR_RAIL_WIDTH` |
| Account row / account card | `SidebarFooter`, `AccountCard` |
| Canvas | `Mosaic`, `.canvas`, `.stage` |
| Leaf / tab | `LeafNode`, `TileTab` |
| Conversation tile | `chat:<sessionId>` panel, `ChatPane` |
| Tool panel | panel kinds `plan` `goal` `agents` `team` `changes` `turns` `files` `git` `term` `browser` `diag` `audit`; prefixed `preview:` `proposal:` `subagent:` `agentdiff:` `tui:` |
| Turn rail | `TurnRail` |
| Top strips | `.owner`, `TaskStrip`, `FindBar` |
| Composer / mode menu | `Composer`, `ModeMenu` |
| Approval card | `ApprovalCard` |
| Progress line / plan tool panel | `ProgressTray` (today), `PlanPanel` |
| Plan proposal | `PlanCard`, `ProposalPane` |
| File preview | `FilePreview` |
| Page over the canvas | `HomePage`, `ProjectPage` |
| Full-panel page | `SettingsPage`, `DeskPage` |
| First-run page | `Welcome`, `SignalRaster` |
