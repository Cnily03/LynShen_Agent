---
name: aogiri-desktop-design
description: Presentation rules for the Aogiri desktop app window (Tauri + Svelte; called LynShen Desktop up to 0.5) — the window frame and title bar, the navigator and its collapsed rail, the workbench canvas with the conversation and tool panels, pages that cover the canvas, full-panel pages, the first-run page, popovers and dialogs. For a dense developer tool used for hours at a time, in Chinese and English, in light and dark themes.
version: 2026-10-15
---

# Aogiri desktop design.md

## 1. Scope and Priority

Applies to every surface inside the desktop window: the title bar, the navigator (expanded, or collapsed to its icon rail), the canvas and its tiles, pages that cover the canvas, full-panel pages, the first-run page, popovers, menus, modals and toasts. Light and dark themes.

Does not apply to: the phone remote page (`src/routes/remote`), the web chat (`src/routes/(web)`), the marketing site, the CLI TUI, or the `/workbench` dev demo.

Conflict order: user facts and requirements → accessibility and keyboard use → the reader's current task (the conversation) → the conventions below → brand expression → decoration.

- The owner chose the visual direction on 2026-10-14 (§2). This ends the earlier freeze on new type pairings, palettes and surface styles. The §5 token table holds its values; since desktop 0.8.0 they are in `src/lib/app.css` and the constants it names. Components use the token names, never those values as literals; a prototype outside the app takes the values from §5. [SHOULD] — Decision 2026-10-14; implemented 2026-10-15.

## 2. Brand and Readers

- Readers are developers who keep the window open all day beside an editor. They scan long transcripts, diffs and terminal output. Desktop pointer and keyboard; minimum window 1040 × 680.
- Direction: an editor's frame around a quiet conversation. The frame follows VS Code: one tone, thin dividers, small type, small radii. The conversation follows Claude and Codex: a centred column, bare assistant text, a soft user bubble, a rounded composer. Decision 2026-10-14 (owner) — Source: the owner named the five references below and chose a serif for display moments only (D1), no status bar (D2) and an edge-to-edge canvas with dividers (D3). Reference values come from each vendor's shipped CSS and VS Code's MIT source, recorded in the task record; none was measured in a rendered app. [SHOULD]
- What we take from each reference, and nothing else:
  - VS Code (Dark / Light Modern): one frame tone behind a lighter content tone, 1px lines between regions, 13px interface text, the 2/4/6/8px radius steps, square tabs whose active tab joins its content, the activity bar's sizes for the collapsed rail, the focus ring drawn inside list rows.
  - Old Cursor (before 2.0): the same frame in near-black neutrals with the frame darker than the content, a one-line header on code blocks, mode and model as text dropdowns under the composer text.
  - Codex: the conversation as the main canvas, the system UI font, one slim control row under the composer, a tool call as one text line, 16px between conversation items and 4px inside a group.
  - Claude: bare assistant text, a 12px user bubble at most 85% of the column, a 14px composer radius, the popover shadow, a serif kept as a title voice.
  - hark.com: one easing curve for color and opacity changes (`--ease-base`), a serif kept for display sizes.
- "Like a tool": the title bar, the navigator and the tab bars share one fill, and 1px lines mark where regions meet. Nothing in the frame has a shadow, gradient or translucency. [SHOULD]
- "Dense, not cramped": frame text is one type step smaller than conversation text (`--fs-sm` against `--fs-md`), and list and menu rows hold one line with little padding. [SHOULD]
- "A quiet conversation": the assistant's text sits directly on the canvas. Only the reader's own messages and the item that waits for the reader have a fill. [SHOULD]
- "Quiet color": near-black, off-white and neutral grays carry the interface (slightly warm in the light theme). Color appears only for meaning (state, error, focus, links). [SHOULD]
- Copy tone: short, plain, second person. Labels name the object ("终端", "Git"), buttons name the action ("在浏览器中授权"). No exclamation marks, no marketing words. [SHOULD]

## 3. Page Structure and Composition

### Window frame (all page types)
- The window is two bands. On top, a 38px title bar across the full width. Below it, the navigator and the canvas side by side, flush with the window's left, right and bottom edges. Nothing sits left of the navigator. [SHOULD] — Decision 2026-10-14, for the frame sizes in this chapter (title bar 38px, rows and menu rows 28px, rail 48px, settings rows 48px): VS Code uses a 35px title bar, 22–24px rows, a 48px activity bar with a bar on the current item, and 32px tabs; Codex a 44px title bar and 31px rows. The values sit between them so 13px Chinese keeps a usable target.
- There is no status bar. Window-level status shows in the composer footer and at the bottom of the navigator. [MUST] — Decision 2026-10-14 (owner, D2).
- The frame tone fills the chrome: `.app` is `--rail`, and the title bar has no fill, border or shadow of its own, so it shows `--rail`. The navigator and the tab bars are `--sidebar`, which equals `--rail` (§4 Color). On macOS the frame rounds its corners to the window (12px); on Windows and Linux it is square. [SHOULD]
- The canvas is edge to edge: `--bg`, with no inset margin, corner radius, border or shadow. A 1px `--divider` line marks each region boundary: under the title bar (full width), at the navigator's right edge, under a tab bar, and between two leaves. [MUST] — Decision 2026-10-14 (owner, D3): edge to edge with dividers, not an inset rounded "paper" on the frame tone.

### Title bar
- Left: a lead area as wide as the navigator (it follows the navigator's width and its collapse animation), or as wide as its own contents when they are wider: on macOS the traffic lights take an 84px inset, so with the navigator collapsed the lead is wider than the rail and the title starts right of the canvas edge. The lead holds the navigator toggle (`SidebarSimpleIcon`). [SHOULD]
- Middle, starting at the canvas's left edge: the title of the object in front (`--fs-sm`/500, `--text`, ellipsized), then its context (`--fs-xs`, `--dim2`), for example the conversation title and then the project name. Full-panel pages show their page name with no context. [SHOULD]
- Right: the front object's actions and the "+" menu that opens a panel beside the focused tile. Title bar buttons are 28px squares, `--r-sm`, 16px icons, `--dim`, with a `--surface2` fill and `--text` on hover. [SHOULD]
- On macOS the native traffic lights are centred vertically on the title bar, on the same centre line as the navigator toggle. [MUST] — Source: owner bug report (PR #26); the value is `trafficLightPosition` in `src-tauri/tauri.macos.conf.json`: y 16.5 for the 38px bar (y 21.5 centred the 48px bar; tao makes the title bar container the close button's height + y, so the buttons' centre moves 1:1 with y). Not yet verified on a macOS build.
- On Windows and Linux three drawn window controls end the bar: 46px wide, full bar height, `--dim`; the close control turns `--err` with `--on-accent` on hover. macOS keeps its native traffic lights. [SHOULD]
- The first-run page hides the navigator toggle. [SHOULD]

### Navigator
- Expanded: 240–460px wide (the user drags its right edge; default 272px), `--sidebar` fill. From top to bottom: the logo mark (a 30px `--text` tile with the mark in `--bg` and its light in `--logo-light-tile`) with the drawn wordmark (`aogiri-wordmark.svg`, 18px high, `--text`), the primary navigation rows, a toolbar of quiet 28px icon buttons, the list, and the account row at the bottom. [SHOULD]
- Navigation and list rows are 28px high, with 8px side padding, a 16px icon and `--r-sm`. The selected row has a `--surface2` fill and `--text`. [SHOULD]
- The 对话 list groups conversations by state: 等你处理 (waiting for an answer, or failed), 进行中, 已完成 (unread first), each under a plain heading (`--fs-xs` 600 `--dim2`, its count in mono) and without empty groups. A conversation's place in its group is set when it enters the group, so a row moves only when its state changes, and then to the top of its new group. The look changes at once; then the row moves there in 400ms on `--ease-in-out` (`moveRow`) while the others make room, above them on the list's own fill. A heading that appears fades in and settles 4px (240ms, `--ease-enter`, after 80ms). While the pointer is in the list or a row's menu is open, rows only change their look and keep their places; they move once it leaves. Reduced motion: no movement. The toolbar's 对话按状态分组 switches to the time order (newest first) and keeps the choice. [SHOULD] — Decision 2026-10-17 (owner approved proposal 1 of the Claude motion study, by state as the default): Claude groups sessions by state and moves a row to its new group in about 0.4s on a symmetric curve after its style changes; users of Claude complained about sessions moving on their own, hence the hold under the pointer.
- Collapsed (⌘B or the title bar toggle): the same panel narrows to the icon rail, `SIDEBAR_RAIL_WIDTH` (48px). This is the window's only vertical rail. Its items are 44px high with 20px icons, centred on the rail; the current item has a 2px `--text` bar on the rail's left edge and a `--text` icon, the others are `--dim`. It shows the logo (which expands the navigator and shows the panel icon on hover), the primary navigation with tooltips to their right, a dot on an icon for a pending count, and the account avatar. Labels and lists fade out; the icons keep their position. [SHOULD]
- Peek: hovering or focusing the collapsed rail opens the full navigator over the canvas; the canvas does not move. The open panel has the `--sidebar` fill, a 1px `--divider` right edge and `--shadow-pop`. It folds back when the pointer leaves. [SHOULD]
- While a conversation's turn runs sub-agents, the 对话 list shows them under its row: the ones at work and the ones just finished, in the order they started, four at most, then one row 还有 N 个 that opens the conversation. A sub-agent row is 26px high and 14px in, on a 1px `--border-strong` line that hangs from the conversation's status slot. It follows the row rules: at work, its name sweeps like a running title; done, `--text` at 500, in place and at once; failed, the `--err` dot. A click or Enter opens the sub-agent's page. The sub-agents are items of the list, so the rows below make room with the row move, and they move with their conversation when it changes group. Each one fades in and settles 4px (240ms, `--ease-enter`), after 80ms and then 120ms apart. They stay 30 s after the turn ends, then fade out (140ms) while the rows below move up. The pointer in the list or an open row menu holds them, as it holds a move. Reduced motion: they come and go at once. The rail and its peek show none. [SHOULD] — Decision 2026-10-17 (owner approved proposal 5 of the Claude motion study): Claude nests a session's parallel tasks under it and fades them in about 130ms apart; four rows keep a busy turn from filling the navigator. They are the subagents card's rows (`agentRows`), so the two agree.
- Full-panel pages lay out their own navigation at the expanded width, whether the navigator is collapsed or not. [SHOULD]
- The account row (28px avatar, name, balance) opens the account card: a `.pop` surface above the row, or to the right of the avatar on the rail. It holds an identity block, at most two summary lines that link to the account page (a quota shows as a slim meter), then `.pop-row` actions with the destructive action last in `--err`. Preferences such as theme and currency are not in the card. [SHOULD]

### Workbench canvas (conversation + tools)
- First viewport: the conversation fills the canvas. The transcript column is centred, and its width `--chat-w` follows the chat pane. The default setting ("自适应") is 75% of the pane width, at least 844px where the pane has room and at most 1120px. The setting also offers "标准" (844px) and "铺满" (the pane minus its side padding). The pane keeps 32px beside the column on each side, 56px while the turn rail shows. On a narrow pane the column keeps 640px while the pane can hold it with 32px each side; below that it shrinks with the pane and keeps the 32px. The composer, the approval card and the trays above the composer share the column's width. [SHOULD] — Decision 2026-10-13: user feedback that a widened window left large blank margins beside a fixed 844px column; the cap keeps lines readable, and the setting covers both tastes.
- Turn rail: with two or more user messages, `TurnRail` shows one tick per user message in the left gutter of the chat pane, 4px from the pane's edge, centred vertically. A tick is an 18 × 2px bar in `--dim2` at 55% opacity, drawn at 56% of its length; the tick in view is longer and `--text`; at most 30 ticks show and the edge ticks fade where more lie beyond. Hovering a tick previews that message in one line on a `--panel` popover with `--shadow-pop`; clicking it scrolls there. [SHOULD]
- The turn rail sits in the gutter outside the text column and never overlaps text, at any pane width. Its ticks end 26px from the pane's edge, and the text column starts at least 32px from it. [MUST]
- Strips at the top of the transcript (the session's owner line, the background-task strip, the find bar) sit above the scrolling transcript, never over it. Each has an opaque fill, `--bg` (the find bar `--panel`), and a `--hairline` bottom edge; over a custom background it shows the canvas veil like the rest of the canvas. Scrolled content never shows through a strip. A strip that stays visible while the transcript scrolls is placed outside the scroll area; if it is sticky inside one, it takes an opaque `--bg` fill, with no transparency, blur or gradient. [MUST]
- Assistant text sits on `--bg` with no fill, border or avatar; its paragraphs are 12px apart. A user message is a right-aligned bubble: `--surface2`, `--r-xl`, 10 × 14px padding, at most 85% of the column, `--fs-md` text. [SHOULD] — Decision 2026-10-14 (this rule and the next three): Claude and Codex leave assistant text bare and give user messages a 5–8% bubble (Claude 12px radius, at most 85% wide); Codex spaces conversation items 16px, 4px inside a group; old Cursor heads code blocks with one line. The 32px turn gap has no reference value.
- Spacing in the transcript: 16px between blocks of one turn, 4px between consecutive tool-call lines, 32px above the user bubble that starts a new turn. [SHOULD]
- A tool call is one line: a 16px icon and `--fs-xs` `--dim` text, no card. Opened, its output sits in a `--surface` block (`--r-md`, mono `--fs-xs`). A failed call opens by itself. [SHOULD]
- A code block in a message has a `--surface` fill, a 1px `--hairline` edge and `--r-md`; its text is mono at 13px (0.87em of the body) with a 20px line height. A 28px header line shows the language at the left and the copy action at the right (`--fs-xs`, `--dim`). [SHOULD]
- Composer: a box (`--panel`, 1px `--border`, `--r-2xl`, `--shadow-float`) holding the text (`--fs-md`, 24px line height, 12 × 14px padding) and, at its right end, the voice and send buttons (28px, round; send uses `--accent`). While it has focus, its border turns `--border-strong`, with no glow and no larger shadow. Under the box, one slim footer row, edges aligned with it: add, mode and branch at the left; model, effort and context at the right. Footer controls are text dropdowns (28px, `--fs-xs`, `--dim`, `--surface2` fill on hover) with no borders; the branch is mono `--fs-2xs` `--dim2`. Suggestion, slash and question trays open inside the box above the text. [SHOULD] — Decision 2026-10-14: Claude's 14px composer, Codex's 28px buttons and row under the box, VS Code's border-only chat input.
- A conversation with no messages centres the composer vertically in the column, with the empty-conversation greeting (§4 Type) one line above it. After the first message the composer sits at the bottom. [SHOULD] — Decision 2026-10-14: Codex and Claude open a new conversation this way.
- The files a turn changed show under its reply as one change pill: an outlined chip (24px, 1px `--border`, `--r-md`, `--fs-xs`) with a 14px file icon, the file count, and `+added` in `--ok` and `−removed` in `--err` in mono. It opens the Changes panel. It is not a full pill. [SHOULD] — Decision 2026-10-15: the approved prototype (v3) draws the change as an outlined `--r-md` button; the reply footer had the same figures as plain text.
- A turn that ends with changes, or with the engine's suggested next prompt (`prompt_suggestion`), hands control back with a recap card in the column above the composer: `--panel`, 1px `--border`, `--r-lg`, `--shadow-float` (it waits for a decision, so it is raised). It holds 本轮完成 (`--fs-sm`/500), one result line (the turn's change figures in mono, then the reply's last paragraph as plain text, two lines at most), a question, the suggestion as the one primary button (one line, ellipsis; without a suggestion, 查看改动), 暂不 as the secondary button and × at the top right. ⌘↵ (Ctrl+↵) picks the primary and Esc closes it while the composer is empty and no menu is open; the keys show only in the tooltips. While it shows, the composer does not offer the suggestion. It fades in like any card that waits for the reader. After a choice it closes its height (`collapse`, `--t-base`, `--ease-base`) and the turn keeps a one-line `--fs-xs` `--dim` receipt under its reply (已选择：… / 未采用：…; × leaves none). No card after a failed or stopped turn, while a turn runs or anything else waits above the composer (an approval, the gate, a queued message), or for a reloaded transcript. [SHOULD] — Decision 2026-10-17 (owner approved proposal 4 of the Claude motion study): Claude ends a turn with a result, a question and the next step as a button; the engine's suggestion was only grey text in the composer.
- Composer modes: the footer's mode label opens the mode menu upward. It is a `.pop` with a head line (title, and the cycle key, ⇧Tab on macOS, in mono `--dim2`), then one two-line `.pop-row.two` per mode: label with an optional "推荐" tag (`--fs-2xs`, `--dim` on `--surface2`, `--r-full`), a `.pop-desc` line that wraps inside the row, a check column for the current mode, and the mode's digit in mono `--dim2`. A risky mode's label is `--warn` in the menu and in the footer. The menu stays inside the window and scrolls its rows when the space above the label is short. [SHOULD]
- Reply styles (回复风格, LynShen conversations): the "+" tray has a 回复风格 section after 模式, one row per style (its name, its description, a trailing check on the style the conversation uses). A pick applies from the next message. The current style shows only there: no footer label, pill or tag on the composer. Settings → 回复风格 sets the style of new conversations and edits the personal styles. [SHOULD] — Decision 2026-10-16 (owner's request for reply styles; status as menus only, §4 Status).
- Tool panels (git, terminal, files, plan, changes, browser, …) open beside the conversation, in a leaf to its right with 42% of the area. Later tools stack as tabs in that leaf. A tool must not replace the conversation in its leaf while the chat would keep at least 560px after the split. Below that width the tool stacks as a tab in the chat leaf. The exception is the user's preference to open tool windows as tabs next to the conversation. [MUST]
- A canvas with one leaf and one tab hides the tab bar. With two or more tabs the bar shows: 32px high, `--sidebar`, with the `--divider` line under it. Tabs are square, `--fs-sm`, at most 240px wide, divided by 1px `--divider` lines. The active tab has the `--bg` fill, `--text` and no line under it, so it joins its content; the other tabs show `--dim`. [SHOULD] — Decision 2026-10-14: VS Code Modern tabs.
- A file opened from a message opens as a tab in the side leaf, one tab per file, labelled with the file name and no glyph. The tab shows a header row and then the viewer: read-only code, a fitted image, folded records, or a facts card for a file it cannot show. Prose files read in a 760px column. [SHOULD]
- An approval request is a card in the column above the composer: `--panel`, 1px `--border`, `--r-lg`, `--shadow-float`. Its head line is `--fs-sm`/500. When several requests wait (parallel tool calls, background subagents), they queue in the order they came and the card shows the first; its head line ends with its place in the run, "第 1/3 个" (`--fs-xs`, `--dim`, tabular figures), as the question tray's head does. A single request shows no place. Facts sit on key–value lines (`--fs-xs`; key `--dim`; a value is one ellipsized line, paths and commands in mono), and a long command opens to its full text. Actions are `size="sm"` buttons in one wrapping row: one primary, secondary choices after it, then the danger action; ghost utilities, if any, at the far right. [SHOULD]

### Pages that cover the canvas (home, project)
- With no conversation in front, the home page covers the canvas; the navigator stays. Content is one centred column, 760px (1120px for wide boards), starting 72px from the top with the empty-conversation greeting as a centred `h1` in the display type (§4 Type), then the start box (`--panel`, 1px `--border`, `--r-lg`), then sections. A project page uses the same column with a sans `h1` (`--fs-xl`/600). [SHOULD]
- The canvas never shows an empty state of its own when there is no conversation. The empty state of the tile area (no open tab) is one `--fs-md` line, one `--fs-xs` `--dim2` hint, one primary action and a grid of panel buttons, centred. [SHOULD]

### Full-panel page (settings, workbench overview)
- The page covers the navigator and the canvas. Its navigation column, at the navigator's expanded width, starts with a back arrow and an `h2` (`--fs-lg`/600), then a search field and a flat list of items (28px; the selected item has a `--surface2` fill and a filled icon). Groups of items are divided by a hairline gap, not by headings. [SHOULD]
- Settings content: a left-aligned column, max-width 680px plus 48px padding each side, starting with an `h1` (`--fs-lg`/600). Sections have an `h3` (`--fs-sm`/600) with an optional `--fs-xs` `--dim` description, then plain rows (at least 48px) divided by `--hairline`. There is no card around a section. [SHOULD]
- Workbench overview content: a centred column, 760px for reading lists, 1120px for wide boards, with an `h1` (`--fs-xl`/600). [SHOULD]
- A quota or usage figure shows as text with a 4px meter under it. [SHOULD]

### First-run page
- It covers the window below the title bar (all of it on macOS) on `--bg`. One copy column at the left (at most 440px): the logo lockup (`aogiri-lockup.svg`, 26px high), an `h1` in the display type (§4 Type), a lede (`--fs-md`, `--dim`), then the action column (at most 320px): one primary action, at most one secondary action, then a text link to skip or go back. The `SignalRaster` field fills the right part of the window behind the copy, with masked fades. The legal line sits at the bottom left in `--fs-xs`. [SHOULD]

### Launch screen
- On every cold start the desktop app's main window shows the logo on the theme's `--bg` from its first frame (`#launch` in `src/app.html`), centred: the mark 96px high, the drawn wordmark under it, and plays its whole entrance. The two trunks rise from the ground (the short one 100 ms, the tall one 260 ms after the first frame, 700 ms each), the light slides in along its slant (820 ms, 640 ms long) and its glow comes and goes once (1100 ms, 700 ms long), the wordmark fades in (1450 ms, 600 ms long); the entrance ends at 2.05 s. It is the one motion longer than `--t-enter` (§4 Motion): a brand moment that is seen once per start. Only transform and opacity animate (no filter or blur), every entrance holds only its start (`backwards`), and nothing stays transformed afterwards. [MUST] — Decision 2026-10-17 (owner): "启动软件可以设计一个展示 Logo 的动画欢迎页"; 2026-10-18 (owner, on 0.10.0, whose 1.22 s entrance left as soon as the app was ready): "启动展示logo的动画时间太快了,根本就没有动画展示". Timing in `src/lib/launch.ts` and the logo kit's 欢迎页说明.md.
- After the entrance the finished logo holds 450 ms, then fades out (320 ms, `--ease-base`) over the app, which is built under it: the fade starts 2.5 s after the first frame, or when the canvas is built if that is later. It takes no clicks while it fades, and leaves on the first click or key (140 ms). It leaves at 3.4 s after the start whatever the app's state, and if the scripts never run, app.html takes it away at 4.5 s. With reduced motion it shows the still logo, leaves as soon as the canvas is built and fades in 120 ms. The phone page, the web chat and the browser windows have none. [MUST]
- The glow, the gradient and the drawn wordmark belong to the logo (§4 Color, "Brand marks"). They are not a pattern for the interface. [SHOULD]

## 4. Visual Rules

### Type
- Sans: `--font-sans`, the system UI face first (SF Pro with PingFang SC on macOS, Segoe UI with Microsoft YaHei on Windows), then the bundled Inter as the Linux fallback. Mono: `--font-mono` (Geist Mono Variable) for code, paths, branches, token counts and keyboard keys. [SHOULD] — Decision 2026-10-14: VS Code and Codex set their interface in the system UI font; the current stack names no Windows Chinese face.
- Display: `--font-display` (Noto Serif SC / Source Han Serif SC, SIL OFL) at weight 500 and `--fs-2xl`, never under 24px, sets exactly two display moments: the first-run page title and the empty-conversation greeting (the home page `h1`, and the line above the composer of a conversation with no messages). All other text is sans, including assistant replies, other page titles, the title bar and settings. Latin letters in a display line use the same font. [MUST] — Decision 2026-10-14 (owner, D1).
- Every font size uses a `--fs-*` step. No literal px sizes in component styles. Markdown inside a message sizes its headings and code in `em` of the body size. [MUST]
- Roles: display moments, see above · canvas-page and overview titles `--fs-xl`/600 · settings page title, dialog titles and navigation heads `--fs-lg`/600 · settings section heads `--fs-sm`/600 · conversation text (assistant text, user bubble, composer, long text in a preview) `--fs-md`/400 · frame text (title bar title, rows, tabs, menus, buttons, settings rows, tool panels, tooltips) `--fs-sm` · metadata, descriptions, title bar context, group heads, times `--fs-xs` · badges, key glyphs, mono labels `--fs-2xs`. [SHOULD] — Decision 2026-10-14 (this rule and the next two): VS Code sets its workbench at 13px / 1.4 with weights 400 and 600 only and shows selection with a fill; Codex uses 13 / 12px; Claude's prose is 16 / 24 and its code 13 / 19; 15 / 24 keeps Chinese at a 1.6 line height.
- Line heights: frame text 18px, conversation text 24px, metadata 16px, code in a message 20px, terminal and diff 18px (mono `--fs-xs`). [SHOULD]
- Weights: 400 for text and the frame; 500 for the title bar title, card head lines and the display moments; 600 only for page, section and group titles. Selection shows as a fill, never as bold. [SHOULD]
- Numbers in stats and badges use the mono font with tabular figures. [SHOULD]

### Color
- Only the tokens in `src/lib/app.css` and the tokens that the §5 proposal adds (`:root` dark, `[data-theme='light']` light). No color literals in component styles, except `color-mix()` over tokens and the fixed dark overlay of the full-window image viewer. [MUST]
- `--accent` is the neutral emphasis: primary buttons, selected state, counts. `--brand` / `--brand-bright` are for links and the focus ring only. [SHOULD]
- Status: `--ok` success, `--info` information, `--warn` caution, `--err` error. An error surface uses `color-mix(in oklab, var(--err) 10–11%, transparent)` with `--err` text. [SHOULD]
- Text: `--text` primary, `--dim` secondary, `--dim2` tertiary (section heads, hints). Primary information never uses `--dim2`. [MUST]
- Two tones: the frame tone and the canvas tone. `--rail` and `--sidebar` hold the same value, one visible step darker than `--bg` in both themes. `--panel` is only for floating surfaces. [SHOULD] — Decision 2026-10-14: VS Code Modern, Claude, Codex and old Cursor each put one frame tone behind a lighter content tone. It replaces the 2026-10-13 step that made `--rail` darker than `--sidebar`. In the dark theme the navigator, lighter than the canvas today, becomes darker.
- Light theme: no surface larger than a card, a menu or an input is pure white. `--bg` is an off-white with CIE L* between 95.5 and 97 and a slightly warm, low-chroma hue. `--panel` may be lighter than `--bg`, up to L* 99. [MUST] — Decision 2026-10-13: user feedback that the white light theme is glaring while the dark theme is comfortable; the warm hue matches the Aogiri brand.
- Contrast, both themes, measured on `--bg` and the frame tone: `--text` at least 12:1, `--dim` at least 7:1, `--dim2` at least 4.5:1. A status color used as text is at least 4.5:1 on the surface it sits on. [MUST]
- Launch: the native window background and the first painted frame use the active theme's `--bg`. A white frame must not show before the interface in either theme. [MUST]
- Brand marks: the logo is 04 林光, two trunks and a light (owner's choice 2026-10-17, the logo kit in `design/icon/`). Its trunks and letters take the text colour of where they sit; only its light has a colour, from `--logo-light` (Aogiri's amber on the canvas), `--logo-light-tile` (on a `--text` tile), `--logo-light-from` / `--logo-light-to` (the gradient, on the launch screen only) and `--lynshen-light` (LynShen's teal, for its engine and gateway). Each holds 3:1 on what it sits on. Under 32px the marks are drawn on their own pixel grid with a flat light (`aogiri-mark.svg` 30px, `lynshen-mark.svg` 16px); a large mark is never scaled down instead. [MUST]

### Surfaces and depth
- Layers back to front: the frame tone (`--rail`, `--sidebar`) → `--bg` (canvas) → `--panel` with `--shadow-float` (composer, approval card) → `--panel` with `--shadow-pop` (menus, popovers, tooltips, the peeking navigator) → `--shadow-modal` (dialogs). [SHOULD]
- Strokes: `--divider` draws the region boundaries (§3 Window frame) and the lines between tabs, nothing else. `--hairline` divides rows inside lists, settings sections and strips. `--border` outlines inputs, buttons and the floating controls (composer, approval card, home start box). [SHOULD]
- Shadows belong to floating items only. The frame, the canvas, tabs, rows and the cards that sit flat in the transcript have none. The composer and the approval card have their 1px `--border` and at most a faint blur (`--shadow-float`, none in the dark theme); menus and popovers have a `--divider` ring and a soft drop (`--shadow-pop`). [SHOULD] — Decision 2026-10-14: all five references keep the frame flat; Codex's composer shadow is a faint ring and blur, VS Code's chat input has a border only; `--shadow-pop` follows Claude's popover shadow.
- Radii use `--r-*`. Exceptions: marks under 4px (ticks, key glyphs, 1–3px) and the macOS window frame (12px, the system corner). [MUST]
- Two radius families. The frame, menus, popovers, cards and dialogs stay at 8px or less: `--r-xs` key glyphs and small marks, `--r-sm` buttons, inputs, list rows and title bar buttons, `--r-md` menu rows, tooltips, code blocks and tool output, `--r-lg` menus, popovers, cards and dialogs. The conversation has two larger radii: `--r-xl` for the user bubble and `--r-2xl` (14px) for the composer. Tabs are square. `--r-full` is for counts, small tags, switches and round buttons. [SHOULD] — Decision 2026-10-14: VS Code's 2/4/6/8px steps, Claude's 12px bubble and 14px composer. Codex's 22px composer and Hark's pills look like another product beside a square frame.
- Window frost ("窗口磨砂": macOS vibrancy, Windows Mica) is off by default. When it is off, no native effect is applied, and on Windows the window is opaque, not transparent. [MUST] — Decision 2026-10-13: user feedback that the frost does not match the interface; on Windows a transparent window with Acrylic lags behind the pointer while it is dragged.
- When window frost is on, only the window chrome (`--vibrancy-chrome` over `--rail`) and the navigators (`--vibrancy-tint` over `--sidebar`) let it show. Their fills stay opaque enough that the contrast rule above holds over a white and over a black backdrop. The canvas, panels and the title bar text stay opaque. On Windows the effect is Mica (Windows 11); there is no Acrylic fallback. [SHOULD]
- Glass (Settings → 通用 → 玻璃透明度) thins floating surfaces to `--float-tint` with `--glass-filter` and a light rim (`--glass-rim`): the composer, the approval card and toasts. Menus and popovers (`.pop`) stay solid `--panel` at every level, so text behind them never shows between their rows. They keep the rim. [MUST] — Decision 2026-10-14: review of the mode menu, where the transcript's hints showed through it (in WebKit even a 98% fill let them through).
- A custom background image (Settings → 通用 → 背景) covers the whole window. The chrome lets it through at `--chrome-tint`; the canvas lays a veil of `--bg` over it (`--canvas-veil`); the conversation column sits on a blurred, feathered plate. Floating surfaces keep their fills. [SHOULD]

### Controls and states
- Hover: a `--surface2` fill. Selected: `--surface2` fill and `--text` color. Unselected tabs and nav items: `--dim` until hover. [SHOULD]
- Focus: keyboard focus shows the global `:focus-visible` ring (2px `--brand-bright`, offset 2px). Text inputs show focus through their border. Do not remove the ring. [MUST]
- On list rows and tabs the focus ring is drawn inside the element (offset −2px), so it does not cover the next row. [SHOULD] — Decision 2026-10-14: VS Code draws list focus inside the row.
- Disabled: opacity 0.4–0.45 and the default cursor. [SHOULD]
- Row actions in lists appear on hover and on `:focus-within`, not only on hover. [MUST]
- Loading: the `.spin` class on a Phosphor `CircleNotchIcon`. Live state: the `.pulse` class. [SHOULD]
- Empty states: one line of `--dim` text in the place where the list would be. No illustrations in tool panels. [SHOULD]
- Errors in a conversation: an inline card with title, one line of cause, then the fixing action as a button and raw details behind a disclosure. [SHOULD]

### Menus and popovers
- Every menu and picker uses the `.pop` surface: `--panel`, `--r-lg`, `--shadow-pop`, 4px padding. Rows are `.pop-row`: at least 28px, `--r-md`, `--fs-sm`, a 16px `--dim` icon column, a `--surface2` fill on hover and on the keyboard selection. A two-line row (`.two`) adds a `.pop-desc` line (`--fs-xs`, `--dim2`). A risky row (`.warn`) colors its icon, label and check `--warn`. [SHOULD]
- A menu opens from its anchor (`drop-in` downward, `pop-in` upward, `--t-pop`) and stays inside the window: it flips to the side with room and scrolls its own rows when neither side holds it. A click outside, Escape or a selection closes it. [SHOULD]

### Status, attention and emphasis
Decision 2026-10-14 for this section. The owner's feedback was that a prototype with glowing groups, glyph bullets, pills and shortcut chips everywhere "looks machine-made". Implemented (0.8.0) in the session list's status marks (`SessionMark`, `Sidebar`), the approval card, and the plan and subagents cards (`ProgressCards`), which replace the progress tray.
- An item that waits for the reader (an approval, a question) shows a 6px `--warn` dot before its title. The reason is `--dim` text on the line below. A list of such items has a plain `--fs-xs` 600 `--dim2` heading with its count. The heading has no fill, border, glow or colored text. [SHOULD]
- In the navigator a row keeps a 6px slot before its title for that dot, so titles line up; a failed conversation shows an `--err` dot there and an unread reply a `--text` dot. [SHOULD] — Decision 2026-10-15: the dot replaces the breathing "待确认" pill and the colored failure icon.
- A conversation at work has one signal in the navigator: its title reads as `--dim` and a light sweeps across it, left to right, every 1600ms (a 1120ms sweep, then a 480ms rest, linear). Every running title sweeps on one clock. The title keeps `--text` under a veil in the row's own fill (30% dark, 22% light), and only the veil's transform moves (`shimmer`, `src/lib/ui/shimmer.ts`). No spinner after the title and no breathing. With the window frost or a background image behind the navigator the veil cannot match the row, so the title breathes (opacity 1 ↔ 0.55, 1.8s). Reduced motion: the title stays `--dim`. Home rows and tabs keep the `.spin` mark. [SHOULD] — Decision 2026-10-17 (owner approved proposal 2 of the Claude motion study): Claude sweeps every working title on one beat; the old sweep moved `background-position` and repainted each row at every frame (removed 2026-10-10). In Chromium, nine running rows paint nothing over 2s with the veil.
- Status, risk and scope inside a card are plain `--dim` text, joined with " · ". A status color appears only as one 6px dot, or as the text color of an error. [SHOULD]
- While a turn has a to-do list or runs subagents, the chat leaf shows a column of cards at its top right. The plan card shows the label, the count and the current step ("计划 3/7 · 跑单元测试"), then the checklist. The subagents card shows one row per agent: role, a 6px state dot, the current action and the elapsed time; a click opens that agent's conversation. Each card collapses to its title line. The cards sit beside the transcript column when the chat leaf leaves at least 280px to its right; a centred column that leaves less moves left, and narrows down to 640px, to make that room, and the composer and the approval card move with it. Otherwise each card shows only its title line at the top right, on a strip above the transcript, and a click opens it as a solid popover (`.pop`) over the transcript, closed by Escape or a click outside. A step that fails or waits for the reader opens the plan card. What the reader collapsed is kept per conversation. On the phone page each title line is a chip under the header, and a tap opens the card as a sheet from the bottom. Nothing about plans or subagents sits on the composer's top edge, and no tray opens upward from it. The cards have no ring, segmented bar or colored beads. A bar shows only byte or time progress. [SHOULD] — Decision 2026-10-14 (owner, stated several times): plan and subagents are cards on the right. Implemented in 0.8.0; the tray above the composer is gone.
- While a turn works, one line under the transcript says what it is doing: one sign (a 12px asterisk in `--dim` that turns once in 2400ms, still under reduced motion), the step as a verb and its object ("正在运行 `pnpm vitest run`", "正在读取 `cache.ts`", "正在思考"; the object mono `--fs-2xs`, one ellipsized line), then "· 24s" (whole seconds of this step, mono `--dim2`, tabular figures) and "›" while a tool call runs, which opens that call's card in the transcript. The words change at once when the step does; nothing else on the line moves. [SHOULD] — Decision 2026-10-17 (owner approved proposal 3 of the Claude motion study): Claude's status line names the action and its object; the five phase glyphs said only "生成中" or "执行工具".
- In the transcript, only the item that needs the reader's action is raised (`--panel` + `--shadow-float`). Earlier turns, summaries and finished cards sit flat on `--bg`. Blocks inside a raised item use a `--surface` fill, never a second shadow or border. [SHOULD]
- A view region has one primary button. Secondary actions are `secondary` or `ghost` buttons, or a menu. [SHOULD]
- Outside the window, the number of conversations that wait for the reader (the ones with the `--warn` dot) shows as the Dock badge on macOS, an overlay icon on the Windows taskbar button (a `--warn` disc with the count, "9+" above nine) and "(2) " before the window's title. At 0 all three are cleared. Failed and unread conversations do not count. [SHOULD] — Decision 2026-10-17 (owner approved proposal 7 of the Claude motion study): Claude's agent view writes the number awaiting input into the tab title; a waiting conversation should be seen while the window is behind others.

### Icons
- Phosphor (`phosphor-svelte`), regular weight; `fill` marks the selected nav item. Frame icons (navigation, title bar, toolbars) and row actions 16px, the collapsed rail 20px, tab and inline icons 12–14px. Icons beside a label are `aria-hidden`. [SHOULD] — Decision 2026-10-14: VS Code's codicons are 16px; its activity bar uses 24px, and Phosphor's thin stroke reads at 20px on the narrower rail.

### Motion
- Use the keyframes in `app.css` (`scrim-in`, `sheet-in`, `pop-in`, `drop-in`, `pane-in`, `msg-in`, `rise`, `fade`, `spin`, `pulse`) with the `--t-*` durations (`fast`, `med`, `base`, `slow`, `pop`, `exit`, `enter`, `wait`) and the `--ease-*` curves. Switching conversations and pages crossfades only the canvas. Exits use the Svelte transitions in `src/lib/ui/motion.ts`. A window being resized runs no transitions. Reduced motion collapses all animation (global media query). [MUST]
- A card that waits for the reader (the approval card, the requirement gate, the plan-revision strip and the recap card above the composer) fades in: `fade`, `--t-wait` (180ms), `--ease-enter`, fill backwards, no movement and no blur. Messages in the transcript keep `msg-in`. [SHOULD] — Decision 2026-10-17 (owner approved proposal 6 of the Claude motion study): Claude's suggested-tasks card fades in over about 180ms without moving; the decision should be there at once, not slide under the pointer.
- Motion is short and does not bounce: no animation is longer than `--t-enter` (the launch screen's entrance excepted, "Launch screen"); color and opacity changes use `--ease-base`; `--ease-spring` is only for small controls (switch knobs, chevrons). [SHOULD] — Decision 2026-10-14: the five references animate in 0.06–0.3s with one main curve and no bounce.

## 5. Available Primitives

| Role | Name | Source | Use | Status |
|---|---|---|---|---|
| Tokens | `--bg` `--sidebar` `--rail` `--divider` `--panel` `--surface` `--surface2` `--hairline` `--border` `--border-strong` `--text` `--dim` `--dim2` `--accent*` `--on-accent` `--brand*` `--ok` `--info` `--warn` `--err` `--font-sans` `--font-mono` `--font-display` `--fs-*` `--r-*` `--t-*` `--ease-*` `--shadow-*` `--scrim` | `src/lib/app.css` | All styling | Implemented |
| Logo marks | `aogiri-mark.svg` (navigator tile), `aogiri-wordmark.svg`, `aogiri-lockup.svg` (first run, Settings → 更新), `lynshen-mark.svg` (14–19px; `BackendIcon`, `Vendor`), all `?raw` inline SVG in `currentColor` with the light from a token | `src/lib/`, sources and icon files from `design/icon/make-aogiri-icons.mjs` | Every place that shows the logo; no other drawing of it | Implemented |
| Launch screen | `#launch` (app.html), `initLaunch`, `launchReady`, `LaunchScreen`, `LAUNCH` | `src/app.html`, `src/lib/launch.ts` | The cold start of the desktop window only | Implemented |
| Display face | Noto Serif SC 500 (`@font-face` in `app.css`), a subset of the display lines and printable ASCII; SIL OFL 1.1 | `src/lib/fonts/noto-serif-sc-display.woff2`, `src/lib/fonts/OFL.txt`, `scripts/subset-display-font.py` | The two display moments | Implemented |
| Glass, frost, background | `--float-tint` `--chrome-tint` `--glass-filter` `--glass-rim` `--glass-strong` `--vibrancy-chrome` `--vibrancy-tint` `--canvas-veil`; root attributes `data-glass` `data-vibrancy` `data-canvas-bg` | `src/lib/app.css`, `src/lib/prefs.svelte.ts` | Set by preferences; components read them, never set them | Implemented |
| Window frame | `.app` (`--rail`), `.body`, `.panel`, `.canvas` (`--bg`), `.stage` | `src/routes/+page.svelte` | The one frame | Implemented |
| Title bar | `TitleBar` `leftWidth` `sidebarOpen` `onToggleSidebar` `showToggle` `heading` `title` `subtitle` `addOptions` `actions` | `src/lib/shell/TitleBar.svelte` | The window's only title bar; `heading` makes the title the view's `h1` (a conversation in front) | Implemented |
| Navigator | `Sidebar` `width` `collapsed`; `SIDEBAR_RAIL_WIDTH` (48), `SIDEBAR_DEFAULT_WIDTH` (272) | `src/lib/Sidebar.svelte`, `src/lib/shell/sidebarState.ts` | Expanded panel or the icon rail | Implemented |
| Status mark | `SessionMark` (`status`, `compact`); `sessionStatus(chat)` (`input` carries `what`, the request in one line) | `src/lib/SessionMark.svelte`, `src/lib/sessionStatus.ts` | Navigator rows, home rows, tabs | Implemented |
| 对话 by state | `orderedList`, `heldList`, `changedGroup`, `GroupPlaces`, `readListOrder`; `moveRow`, `listIn` (`ui/motion.ts`) | `src/lib/shell/sidebarGroups.ts`, `src/lib/Sidebar.svelte` | The navigator's 对话 list | Implemented |
| Running title | `shimmer` (`use:shimmer` on the veil), `SHIMMER_MS`, `SHIMMER_FRAMES` | `src/lib/ui/shimmer.ts`, `.veil` in `src/lib/Sidebar.svelte` | A navigator row at work | Implemented |
| Account row and card | `SidebarFooter` (`collapsed`), `AccountCard` (`side: top｜right`) | `src/lib/workbench/` | Bottom of the navigator | Implemented |
| Button | `Button` `variant: primary｜secondary｜ghost｜danger｜success`, `size: sm｜md｜icon`, `full` | `src/lib/ui/Button.svelte` | One `primary` per view region | Implemented |
| Icon button | `IconButton` `size: xs｜sm｜md`, `label` | `src/lib/ui/IconButton.svelte` | Icon-only actions; pass a `label` | Implemented |
| Segmented | `Segmented` `value` `options` `onChange` | `src/lib/ui/Segmented.svelte` | 2–4 exclusive options in a settings row | Implemented |
| Switch, Checkbox, Select, TextField | same names | `src/lib/ui/` | Settings rows and forms | Implemented |
| Model pickers | `ModelPicker` (`variant: field｜inline`, `extras`), `QuickSwitcher`, `ModelBrowser` (in a `Modal`), `ModelLine`; `gatewayCatalog` | `src/lib/models/`, `src/lib/composer/ModelMenu.svelte` | Every model choice: the composer's model menu, the settings model rows, the home start box, the first run. Not `Select` | Implemented |
| Chip, Collapse | `Chip` (`selected`), `Collapse` (`open`) | `src/lib/ui/` | Toggle chips in pickers; animated disclosure | Implemented |
| Notice | `Notice` `tone: error｜warn｜info`, `mono` | `src/lib/ui/Notice.svelte` | Inline messages inside panels and forms | Implemented |
| Modal | `Modal` `placement: center｜top`, `width`, `footer` | `src/lib/ui/Modal.svelte` | Dialogs (frosted sheet on `--glass-strong`) | Implemented |
| Menus | `PopMenu` (`items`, `placement: up-left｜up-right｜down-left｜down-right`, `fit`); global classes `.pop` `.pop-head` `.pop-row` `.two` `.warn` `.pop-ico` `.pop-txt` `.pop-label` `.pop-desc` `.pop-hint` `.pop-check`; `fitMenu` | `src/lib/ui/PopMenu.svelte`, `app.css`, `src/lib/ui/menuFit.ts` | Every menu and picker | Implemented |
| Tooltip | `title` or `data-tip` (+ `data-tip-side="right"`) | `src/lib/ui/TooltipHost.svelte` | Every tooltip; no native tooltips | Implemented |
| Shortcut text | `shortcutLabel(id)`, `withShortcut(label, id)` | `src/lib/shortcuts.ts` | Keys in menus and tooltips | Implemented |
| Toast, confirm | `toast.info｜success｜warn｜error`, `confirm()` | `src/lib/ui/toast.svelte.ts`, `confirm.svelte.ts` | Transient feedback, destructive confirmation | Implemented |
| Settings layout | `SettingsSection` (`title` `description` `action`), `SettingsRow` (`stacked`) | `src/lib/settings/` | Every settings page | Implemented |
| Canvas | `Mosaic` (`hideSoloBar`); `openElsewhere`, `openChatTab`, `TOOL_SIDE_RATIO` (0.42), `TOOL_SPLIT_MIN_CHAT` (560); `splitLeaf` | `src/lib/workbench/Mosaic.svelte`, `canvas.ts`, `tiles.ts` | All tile placement | Implemented |
| Chat column | `--chat-w`, `--chat-pad`, and `--col-l` `--col-r` while the cards sit beside the column; `chatColumnWidth`, `chatColumnPad`, `CHAT_PAD` (32), `CHAT_PAD_RAIL` (56) | `src/lib/chatWidth.ts`, `src/lib/ChatPane.svelte` | Transcript, composer, approval card and trays | Implemented |
| Turn rail | `TurnRail` `marks` `current` `onJump` | `src/lib/TurnRail.svelte` | Left gutter of the chat pane | Implemented |
| Change pill | `.change` in the reply footer; `TurnPart.change` (`turnParts`); `MessageList` `onChanges`, `ChatPane` `onOpenChanges` | `src/lib/MessageList.svelte`, `src/lib/turnStats.ts` | The files a turn changed | Implemented |
| Recap card | `RecapCard` (`recap` `keys` `composer` `onPick` `onSkip` `onClose`), `RecapReceipt` (`outcome`); `recapOf`, `lastParagraph`, `isPickKey`, `keysFree` (`recap.ts`); `collapse` (`ui/motion.ts`) | `src/lib/RecapCard.svelte`, `src/lib/RecapReceipt.svelte`, `src/lib/recap.ts` | The end of a turn: its next step | Implemented |
| Top strips | owner line `.owner`, `TaskStrip`, `FindBar` | `src/lib/ChatPane.svelte`, `src/lib/TaskStrip.svelte`, `src/lib/shell/FindBar.svelte` | Above the transcript | Implemented |
| Composer | `Composer`, `ModeMenu` (`items` `current` `onSelect` `onCycle`; `ModeItem.tone: 'warn'`), `ComposerTray` | `src/lib/Composer.svelte`, `src/lib/composer/` | The chat input | Implemented |
| Reply styles | `Composer` `styleMenu` (the "+" tray section); `StylesSection`, `StyleDialog`; `replyStyles` (lists per project), `styleName`, `styleDescription` | `src/lib/Composer.svelte`, `src/lib/settings/`, `src/lib/styles.ts`, `src/lib/styles.svelte.ts` | The composer's style rows and Settings → 回复风格 | Implemented |
| Work status line | `Indicator` (`phase` `call` `messages` `onDetails`); `workStep`, `workElapsed` | `src/lib/Indicator.svelte`, `src/lib/workStatus.ts` | Under the transcript while a turn works | Implemented |
| Approval card | `ApprovalCard` | `src/lib/ApprovalCard.svelte` | A request that waits for the reader | Implemented |
| Plan and subagents cards | `ProgressCards` (`beside`), `ProgressSheet` (phone page); bodies `PlanBody`, `AgentsBody`, `CardTitle`; `cardsLayout`, `CARD_LANE` (280) | `src/lib/agents/`, `src/lib/agents/progressCards.ts`; `PlanPanel` reuses `PlanBody` | A turn with to-dos or subagents | Implemented |
| Sub-agents in the navigator | `subagentsOf`, `withSubagents`, `arrivals`, `SUBAGENT_ROWS` (4), `SUBAGENT_STAY_MS` (30 000); `childIn`, `listOut` (`ui/motion.ts`) | `src/lib/shell/sidebarSubagents.ts`, `src/lib/Sidebar.svelte` | A conversation's sub-agents under its row in 对话 | Implemented |
| File preview | `FilePreview` (`path` `root`); panel `preview:<path>` (`previewPanel`) | `src/lib/preview/` | A file opened from a message | Implemented |
| Session title | `shownTitle(title)` | `src/lib/chat.svelte.ts` | Show any session title (translates the placeholder) | Implemented |

### Token table (Decision 2026-10-14, implemented 2026-10-15 for desktop 0.8.0)

The values of the direction in §2. Values are light / dark where they differ; "Before" is what 0.7.x had. `src/lib/themeTokens.test.ts` holds the scale, the radii, the frame tone, the shadows and the contrast numbers below; `src/lib/displayFont.test.ts` holds the display face.

| Token or constant | Before | Value | Role | Status |
|---|---|---|---|---|
| `--font-sans` | `'Inter Variable'` first | `-apple-system, BlinkMacSystemFont, 'Segoe UI Variable', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Inter Variable', Inter, 'Noto Sans SC', system-ui, sans-serif` | All interface and conversation text | Implemented: `src/lib/app.css` |
| `--font-display` | — | `'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', serif`, used at weight 500 | The two display moments only | Implemented: `src/lib/app.css`, face in `src/lib/fonts/` |
| `--fs-2xs` `--fs-xs` `--fs-sm` `--fs-md` `--fs-lg` `--fs-xl` `--fs-2xl` | 12 · 13 · 15 · 16 · 18 · 24 · 36px | 11 · 12 · 13 · 15 · 18 · 22 · 28px | Type roles (§4 Type) | Implemented: `src/lib/app.css` |
| `--r-xs` `--r-sm` `--r-md` `--r-lg` `--r-xl` `--r-2xl` | 5 · 8 · 10 · 14 · 20 · 26px | 2 · 4 · 6 · 8 · 12 · 14px; `--r-full` unchanged | Radius families (§4 Surfaces) | Implemented: `src/lib/app.css` |
| `--rail` | #e5e3de / #141414 | #f0efeb (L* 94.4) / #141414 | Frame tone | Implemented: `src/lib/app.css` |
| `--sidebar` | #eeece8 / #202020 | equal to `--rail` | Frame tone | Implemented: `src/lib/app.css` |
| `--divider` | — | #e0ded9 / #2a2a2a | Region boundaries, lines between tabs | Implemented: `src/lib/app.css` |
| `--shadow-float`, `--shadow-float-strong` | 1px ring + 22–36px drop | both `0 2px 8px rgba(28, 25, 23, 0.05)` / `none`; focus shows as `--border-strong` | Composer, approval card | Implemented: `src/lib/app.css` |
| `--shadow-pop` | 28–32px drop + 1px ring | `0 0 0 1px var(--divider), 0 8px 24px rgba(28, 25, 23, 0.12), 0 2px 6px rgba(28, 25, 23, 0.08)` / `0 0 0 1px var(--divider), 0 8px 24px rgba(0, 0, 0, 0.32), 0 2px 6px rgba(0, 0, 0, 0.2)` | Menus, popovers, tooltips, the peeking navigator | Implemented: `src/lib/app.css` |
| `--shadow-canvas` | defined, used by no component | removed | No inset canvas (D3) | Implemented (removed) |
| Title bar height | 48px | 38px | §3 Title bar | Implemented: `.titlebar`, `src/lib/shell/TitleBar.svelte` |
| `trafficLightPosition.y` | 26 (21.5 with PR #26) | 16.5, centred on the 38px bar | §3 Title bar | Implemented: `src-tauri/tauri.macos.conf.json`; not yet checked on a macOS build |
| `--logo-light` `--logo-light-tile` | — | #c2581f / #f0a465 and #f0a465 / #c2581f | The Aogiri mark's light on the canvas and on a `--text` tile (§4 Color, "Brand marks") | Implemented: `src/lib/app.css` (Decision 2026-10-17) |
| `--logo-light-from` `--logo-light-to` | — | #d9652f → #b24e1a / #ffe3bc → #f0a465 | The light's gradient on the launch screen | Implemented: `src/lib/app.css`, repeated in `src/app.html` (`brand.test.ts`) |
| `--lynshen-light` | — | #0e7f94 / #24b3cd | LynShen's mark (engine, gateway) | Implemented: `src/lib/app.css` |
| `SIDEBAR_RAIL_WIDTH` | 62 | 48 | Collapsed rail | Implemented: `src/lib/shell/sidebarState.ts` |
| Navigator default width | 292 | 272 | Expanded navigator | Implemented: `SIDEBAR_DEFAULT_WIDTH`, `src/lib/shell/sidebarState.ts` |

Unchanged: `--bg` (#f6f5f2 / #1a1a1a), `--panel`, `--surface`, `--surface2`, `--hairline`, `--border`, `--border-strong`, the text, accent, brand and status colors, `--shadow-modal`, `--t-*`, `--ease-*`. With the frame tone, `--text` / `--dim` / `--dim2` measure 15.3 / 8.2 / 5.3:1 (light) and 15.6 / 8.0 / 5.2:1 (dark), so the contrast rule holds; the light `--bg` is L* 96.5 and `--panel` L* 98.3.

Menu row, as `PopMenu` renders it (hand-built menus use the same nesting):

```svelte
<div class="pop" role="menu">
  <button class="pop-row" role="menuitem">
    <span class="pop-ico"><GearIcon size={16} /></span>
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
- A shortcut shows in three places only: as `.pop-hint` text at the right of a menu row (a mode menu's digits in mono `--dim2`), after the label in a tooltip ("收起侧栏 · ⌘B", `withShortcut`), and as bordered `kbd` chips on the shortcuts page and dialog. Use `shortcutLabel` (Ctrl on Windows and Linux). Buttons, nav items, list rows and input placeholders do not show shortcuts. [SHOULD] — Decision 2026-10-14, same feedback as "Status, attention and emphasis". Open: the approval card's buttons show digit keys.
- An input placeholder names the action in a few words ("回复", "输入 / 使用命令"). It does not list options or shortcuts. [SHOULD]
- A prototype or a page with sample data shows one `--dim2` line "原型 · 示例数据" outside the window frame. It shows no design annotations, rule numbers or imitation OS chrome. [SHOULD] — Decision 2026-10-14.

## 7. Anti-Patterns

- A second vertical rail or column beside the navigator (for workspaces, accounts or settings), including a persistent activity bar, upright or laid across the top of the navigator. The collapsed navigator is the window's only rail. [MUST]
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
- Blue or brand purple as a fill: a blue status bar, a blue primary button, a colored selected row. [SHOULD]
- Pill-shaped (fully rounded) navigation or list rows. [SHOULD]
- Large pill buttons that invert their colors on hover. [SHOULD]
- A WebGL or animated background behind the transcript, by default or as a theme. [SHOULD]
- A user message drawn as a full-width bordered card. [SHOULD]
- Uppercase or letter-spaced group headings (an "EXPLORER" label). [SHOULD]
- A second icon set beside Phosphor (codicons, an icon font). [SHOULD]
- A mascot, sprite animation or hero video in the window. [SHOULD]
- Glow, halo, rim light or a tinted container to make a group stand out. [SHOULD]
- Glyph bullets (◆, ▲, ●●●) or an icon in front of a card title to signal status. [SHOULD]
- A checklist that expands in place in the conversation. [SHOULD]
- Tokens that neither `src/lib/app.css` nor the §5 token proposal defines, including in prototypes. [MUST]

## 8. Implementation and Integration

- Style entry: `src/lib/app.css`, imported once in `src/routes/+layout.svelte`. Component styles are scoped `<style>` blocks.
- Fonts: `@fontsource-variable/inter` and `@fontsource-variable/geist-mono`, imported at the top of `app.css`. The system UI faces in `--font-sans` need no loading. The display face is a 15 KB subset of Noto Serif SC 500 (SIL OFL 1.1, licence in `src/lib/fonts/OFL.txt`) declared by the one `@font-face` in `app.css`: the glyphs of the display lines and printable ASCII. A new or changed display line needs `scripts/subset-display-font.py` run again; `src/lib/displayFont.test.ts` fails until it is.
- The phone remote page and the web chat are outside this file's scope and keep the type scale and radii they were made with: `app.css` restores them under `:root:has(.remote, .web, .signin)`.
- Theme: `initTheme()` / `setTheme()` in `src/lib/theme.svelte.ts` set `data-theme` (`light｜dark`, resolved from `system｜light｜dark`) on `<html>`. Platform and preference attributes on `<html>`: `data-os`, `data-vibrancy`, `data-glass`, `data-canvas-bg` (`src/lib/prefs.svelte.ts`).
- Icons: `phosphor-svelte`, defaults set by `IconContext` in `+layout.svelte` (regular weight, `aria-hidden`).
- Browser fixtures for rendered checks: `tests/browser` (`?shell`: the frame with one conversation; `&theme=light`, `&preview`, `&empty`, `&collapsed`, `&home`, `&settings[=<section>]` (with `&chats[=empty|error|old|all]` for 聊天连接), `&approval`, `&states`, `&cards`, `&tool`, `&textOnly`, `&models[=old]`, `&planStop=quota|inactive|none|notInPlan` (a turn the plan stopped); `&trial[=used|full|ended|web]` with `&funding=plan` for who pays; `?remote&cards` for the phone page).

## Glossary

| Concept | Name in code |
|---|---|
| Window frame | `.app` in `src/routes/+page.svelte` |
| Frame tone / region divider | `--rail` = `--sidebar` / `--divider` |
| Display type | `--font-display` |
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
| Plan card / subagents card | `ProgressCards`, `ProgressSheet` (phone page), `PlanPanel` |
| Model quick switcher / model browser | `QuickSwitcher`, `ModelBrowser`, `ModelPicker` |
| Plan proposal | `PlanCard`, `ProposalPane` |
| File preview | `FilePreview` |
| Page over the canvas | `HomePage`, `ProjectPage` |
| Full-panel page | `SettingsPage`, `DeskPage` |
| First-run page | `Welcome`, `SignalRaster` |
| Launch screen | `#launch` in `src/app.html`, `LaunchScreen` (`src/lib/launch.ts`) |
| Logo marks / logo light | `aogiri-mark.svg` `aogiri-wordmark.svg` `aogiri-lockup.svg` `lynshen-mark.svg` / `--logo-light*` `--lynshen-light` |
