---
name: lynshen-desktop-design
description: Presentation rules for the LynShen Desktop app window (Tauri + Svelte) — the workbench canvas, side navigators, full-panel pages such as settings and the workbench overview, the first-run welcome page, popovers and dialogs. For a dense developer tool used for hours at a time, in Chinese and English, in light and dark themes.
version: 2026-10-14
---

# LynShen Desktop design.md

## 1. Scope and Priority

Applies to every surface inside the desktop window: title bar, workspace rail, navigator (session list, settings nav, workbench nav), the mosaic canvas and its tiles, full-panel pages, the welcome page, popovers, modals and toasts. Light and dark themes.

Does not apply to: the phone remote page (`src/routes/remote`), the marketing site, the CLI TUI, or the `/workbench` dev demo.

Conflict order: user facts and requirements → accessibility and keyboard use → the reader's current task (the conversation) → the conventions below → brand expression → decoration.

## 2. Brand and Readers

- Readers are developers who keep the window open all day beside an editor. They scan long transcripts, diffs and terminal output. Desktop pointer and keyboard; minimum window 1040 × 680.
- "Quiet": near-black, off-white and neutral grays carry the interface (slightly warm in the light theme). Color appears only for meaning (state, error, focus, links). [SHOULD]
- "Dense but calm": rows are 38px, body text 15–16px, and separation comes from fills and spacing, not from outlines. [SHOULD]
- Copy tone: short, plain, second person. Labels name the object ("终端", "Git"), buttons name the action ("在浏览器中授权"). No exclamation marks, no marketing words. [SHOULD]

## 3. Page Structure and Composition

### Window frame (all page types)
- Title bar 48px across the full width. It shows the front object's title, then its context in `--dim2` (session title + project name). [SHOULD]
- Workspace rail 68px on the far left, chrome color `--rail`. Account and settings sit at its bottom. [SHOULD]
- Navigator column 240–460px (default 292px), `--sidebar` fill. ⌘B and the title bar's panel button collapse it to a 62px icon rail (logo, primary nav as icons with tooltips, the account avatar); full-panel pages keep the expanded width. The account row (avatar, name, balance) sits at its bottom and opens the account card (settings, currency, theme, log out). [SHOULD]
- The content panel has one rounded top-left corner (`--r-lg`) and uses `--bg`. [SHOULD]

### Workbench canvas (conversation + tools)
- First viewport: the conversation fills the canvas. The transcript column is centered, and its width `--chat-w` follows the chat pane. The default setting ("自适应") is 75% of the pane width, at least 844px where the pane has room and at most 1120px. The setting also offers "标准" (844px) and "铺满" (the pane minus its side padding). On a narrow pane the column shrinks to the pane, down to 640px. The composer is pinned to the bottom of the same column and has the same width. [SHOULD] — Decision 2026-10-13: user feedback that a widened window left large blank margins beside a fixed 844px column; the cap keeps lines readable, and the setting covers both tastes.
- Tool panels (git, terminal, files, plan, diff review, browser, …) open beside the conversation, in a leaf to its right with 42% of the area. Later tools stack as tabs in that leaf. A tool must not replace the conversation in its leaf when the chat would keep at least 560px after the split. Below that width the tool stacks as a tab in the chat leaf. [MUST] — Decision: source `src/lib/workbench/canvas.ts` `openToolTab`, `TOOL_SIDE_RATIO`, `TOOL_SPLIT_MIN_CHAT`. Reason: a covered conversation hides the agent's progress while the user inspects its work.
- A canvas with one leaf and one tab hides the tab bar. With two or more tabs the bar shows. [SHOULD]
- Empty canvas (no project): the wordmark at 16% opacity, one line of `--dim` text, and at most two buttons, centered. [SHOULD]

### Full-panel page (settings, workbench overview)
- The page covers the content panel. The navigator becomes the page's own nav: back arrow and `h2` title at the top, then grouped items. [SHOULD]
- Content column: max-width 720px for forms (settings), 760px for reading lists, 1120px for wide boards. The column starts at the left of the centered area with an `h1` page title (`--fs-xl`, 600). [SHOULD]
- Settings content is grouped into sections. A section has a `--fs-md` 600 heading and a card. Rows inside the card are separated by `--hairline`. [SHOULD]

### Welcome page (first run)
- Two columns: copy and actions on the left (max 320px wide action column), the `SignalRaster` field on the right. One primary action, one secondary action, then a text link. The legal line sits at the bottom left in `--fs-2xs`. [SHOULD]

## 4. Visual Rules

### Type
- Sans: `--font-sans` (Inter Variable, then PingFang SC / Noto Sans SC). Mono: `--font-mono` (Geist Mono Variable) for code, paths, branches, token counts and keyboard keys. [SHOULD]
- Every font size uses a `--fs-*` step. No literal px sizes in component styles. [MUST]
- Roles: page title `--fs-xl`/600 · section title `--fs-lg`/600 (nav heads) or `--fs-md`/600 (settings sections) · chat body and inputs `--fs-md`/400, line-height 1.55–1.6 · lists, tabs, controls `--fs-sm` · metadata, descriptions `--fs-xs` · badges, mono labels `--fs-2xs`. [SHOULD]
- Numbers in stats and badges use the mono font with tabular figures. [SHOULD]

### Color
- Only the tokens in `src/lib/app.css` (`:root` dark, `[data-theme='light']` light). No color literals in component styles, except `color-mix()` over tokens. [MUST]
- `--accent` is the neutral emphasis: primary buttons, selected state, counts. `--brand` / `--brand-bright` are for links and the focus ring only. [SHOULD]
- Status: `--ok` success, `--info` information, `--warn` caution, `--err` error. An error surface uses `color-mix(in oklab, var(--err) 10–11%, transparent)` with `--err` text. [SHOULD]
- Text: `--text` primary, `--dim` secondary, `--dim2` tertiary (section heads, hints). Primary information never uses `--dim2`. [MUST]
- Light theme: no surface larger than a card, a menu or an input is pure white. `--bg` is an off-white with CIE L* between 95.5 and 97 and a slightly warm, low-chroma hue. `--sidebar` and `--rail` are each one visible step darker than the layer in front of them. `--panel` may be lighter than `--bg`, up to L* 99. The dark theme is unchanged. [MUST] — Decision 2026-10-13: user feedback that the white light theme is glaring while the dark theme is comfortable; the warm hue matches the Aogiri brand.
- Contrast, both themes, measured on `--bg` and on `--sidebar`: `--text` at least 12:1, `--dim` at least 7:1, `--dim2` at least 4.5:1. A status color used as text is at least 4.5:1 on the surface it sits on. [MUST]
- Launch: the native window background and the first painted frame use the active theme's `--bg`. A white frame must not show before the interface in either theme. [MUST]

### Surfaces and depth
- Layers back to front: `--rail` → `--sidebar` → `--bg` → `--panel` with `--shadow-float` (composer, cards) → `--panel` with `--shadow-pop` (menus) → `--shadow-modal` (dialogs). [SHOULD]
- Strokes are `--hairline`. Use `--border` only for inputs and buttons. [SHOULD]
- Radii use `--r-*` only: rows and tabs `--r-md`, cards and menus `--r-lg`, chat bubbles `--r-xl`, composer `--r-2xl`, pills `--r-full`. [MUST]
- Window frost ("窗口磨砂": macOS vibrancy, Windows Mica) is off by default. When it is off, no native effect is applied, and on Windows the window is opaque, not transparent. [MUST] — Decision 2026-10-13: user feedback that the frost does not match the interface; on Windows a transparent window with Acrylic lags behind the pointer while it is dragged.
- Glass (Settings → 通用 → 玻璃透明度) thins floating surfaces: the composer, cards and toasts follow `--float-tint`. Menus and popovers (`.pop`) stay solid `--panel` at every level, so text behind them never shows between their rows. [MUST] — Decision 2026-10-14: review of the mode menu, where the transcript's hints showed through it (in WebKit even a 98% fill let them through).
- When window frost is on, only `--rail` and `--sidebar` let it show. Their fills stay opaque enough that the contrast rule above holds over a white and over a black backdrop. The canvas, panels and the title bar text stay opaque. On Windows the effect is Mica (Windows 11); there is no Acrylic fallback. [SHOULD]

### Controls and states
- Hover: a `--surface2` fill. Selected: `--surface2` fill and `--text` color. Unselected tabs and nav items: `--dim` until hover. [SHOULD]
- Focus: keyboard focus shows the global `:focus-visible` ring (2px `--brand-bright`, offset 2px). Text inputs show focus through their border. Do not remove the ring. [MUST]
- Disabled: opacity 0.4–0.45 and the default cursor. [SHOULD]
- Row actions in lists appear on hover and on `:focus-within`, not only on hover. [MUST]
- Loading: the `.spin` class on a Phosphor `CircleNotchIcon`. Live state: the `.pulse` class. [SHOULD]
- Empty states: one line of `--dim` text in the place where the list would be. No illustrations in tool panels. [SHOULD]
- Errors in a conversation: an inline card with title, one line of cause, then the fixing action as a button and raw details behind a disclosure. [SHOULD]

### Icons
- Phosphor (`phosphor-svelte`), regular weight; `fill` marks the selected nav item. Navigation icons 18px, row actions 16px, tab and inline icons 11–13px. Icons beside a label are `aria-hidden`. [SHOULD]

### Motion
- Use the keyframes in `app.css` (`scrim-in`, `sheet-in`, `pop-in`, `drop-in`, `pane-in`, `rise`, `fade`) with `--t-fast/med/slow` and `--ease-*`. Reduced motion collapses all animation (global media query). [MUST]

## 5. Available Primitives

| Role | Name | Source | Use | Status |
|---|---|---|---|---|
| Tokens | `--bg` `--sidebar` `--rail` `--panel` `--surface` `--surface2` `--hairline` `--border` `--text` `--dim` `--dim2` `--accent*` `--brand*` `--ok` `--info` `--warn` `--err` `--fs-*` `--r-*` `--t-*` `--ease-*` `--shadow-*` | `src/lib/app.css` | All styling | Implemented |
| Button | `Button` `variant: primary｜secondary｜ghost｜danger｜success`, `size: sm｜md｜icon` | `src/lib/ui/Button.svelte` | One `primary` per view region | Implemented |
| Icon button | `IconButton` `size: xs｜sm｜md` | `src/lib/ui/IconButton.svelte` | Icon-only actions; always pass a label | Implemented |
| Segmented | `Segmented` | `src/lib/ui/Segmented.svelte` | 2–4 exclusive options in a settings row | Implemented |
| Switch, Checkbox, Select, TextField | same names | `src/lib/ui/` | Settings rows and forms | Implemented |
| Notice | `Notice` `tone: error｜warn｜info` | `src/lib/ui/Notice.svelte` | Inline messages inside panels and forms | Implemented |
| Modal | `Modal` `placement: center｜top` | `src/lib/ui/Modal.svelte` | Dialogs (frosted sheet) | Implemented |
| Menus | `PopMenu`; global classes `.pop` `.pop-row` `.pop-ico` `.pop-label` `.pop-desc` `.pop-hint` | `src/lib/ui/PopMenu.svelte`, `app.css` | Every menu and picker | Implemented |
| Toast, confirm | `toast.*`, `confirm()` | `src/lib/ui/toast.svelte.ts`, `confirm.svelte.ts` | Transient feedback, destructive confirmation | Implemented |
| Settings layout | `SettingsSection`, `SettingsRow` (`stacked`) | `src/lib/settings/` | Every settings page | Implemented |
| Canvas | `Mosaic` + `tiles.ts` / `canvas.ts` transforms (`openToolTab`, `openChatTab`, `splitLeaf`) | `src/lib/workbench/` | All tile placement | Implemented |
| Session title | `shownTitle(title)` | `src/lib/chat.svelte.ts` | Show any session title (translates the placeholder) | Implemented |

Extension boundary:
- Pages use only the names above. Do not guess unlisted components or tokens.
- Page-specific classes are scoped Svelte styles. Global additions to `app.css` must be tokens or shared surfaces used by two or more components.
- Scoped styles may lay out primitives but must not change their typography, radius, fill or states.

## 6. Copy and Number Formats

- All visible text and every `aria-label` comes from `t()` (`src/lib/i18n/messages/*`), with zh and en entries. No literal English in markup. [MUST]
- Titles are nouns ("终端", "提交历史"). Buttons are verbs ("拉取", "重新打开授权页面"). Errors: what failed, then what to do ("在设置中重新登录 LynShen 后再试。"). [SHOULD]
- Durations `48.3s`, tokens `18.4k` with ↑ input / ↓ output, line changes `+42 −7`, in mono. Placeholder for a missing value: `—`. [SHOULD]
- Keyboard keys render as mono `kbd` chips (`⌘K`). Use Ctrl on Windows and Linux (`shortcutLabel`). [SHOULD]

## 7. Anti-Patterns

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

## 8. Implementation and Integration

- Style entry: `src/lib/app.css`, imported once in `src/routes/+layout.svelte`. Component styles are scoped `<style>` blocks.
- Fonts: `@fontsource-variable/inter` and `@fontsource-variable/geist-mono`, imported at the top of `app.css`.
- Theme: `initTheme()` / `setTheme()` in `src/lib/theme.svelte.ts` set `data-theme` on `<html>` (`system｜light｜dark`). Platform chrome: `data-os` and `data-vibrancy` on `<html>` (`src/lib/prefs.svelte.ts`).
- Icons: `phosphor-svelte`, defaults set by `IconContext` in `+layout.svelte`.

## Glossary

| Concept | Name in code |
|---|---|
| Workspace rail | `WorkspaceRail` |
| Navigator (session list) | `Sidebar` |
| Canvas | `Mosaic`, `.canvas`, `.stage` |
| Leaf / tab | `LeafNode`, `TileTab` |
| Conversation tile | `chat:<sessionId>` panel, `ChatPane` |
| Tool panel | panel kinds `plan` `goal` `agents` `team` `changes` `turns` `files` `git` `term` `browser` `diag` `audit` |
| Composer | `Composer` |
| Full-panel page | `SettingsPage`, `DeskPage` |
