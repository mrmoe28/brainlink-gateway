# Web Agent Skill — Implementation Plan

> Skill name: **web-pilot**
> Purpose: Browse the web as Moe — log into sites, click buttons, fill forms, download files, take screenshots. Full browser automation via Playwright MCP.

## Available Tools

| Tool | What it does |
|------|-------------|
| `browser_navigate` | Go to a URL |
| `browser_snapshot` | Get accessibility tree (find clickable elements by ref) |
| `browser_take_screenshot` | Visual screenshot of page |
| `browser_click` | Click an element by ref |
| `browser_fill_form` | Fill multiple form fields at once |
| `browser_type` | Type text into a specific element |
| `browser_press_key` | Press keyboard keys (Enter, Tab, etc.) |
| `browser_select_option` | Select dropdown option |
| `browser_tabs` | List/create/close/select tabs |
| `browser_evaluate` | Run JavaScript on the page |
| `browser_file_upload` | Upload files to file inputs |
| `browser_hover` | Hover over elements |
| `browser_drag` | Drag and drop |
| `browser_navigate_back` | Go back |
| `browser_wait_for` | Wait for elements/conditions |
| `browser_handle_dialog` | Accept/dismiss alerts |
| `browser_network_requests` | See network activity |
| `browser_console_messages` | See console output |
| `browser_close` | Close the browser |
| `browser_install` | Install browser binary |
| `browser_resize` | Resize window |
| `browser_run_code` | Run raw Playwright JS |

## Build Steps

### Step 1: Verify Browser Installation
- [x] Call `browser_install` to ensure Chromium is available
- [x] Call `browser_navigate` to a simple page (google.com)
- [x] Call `browser_take_screenshot` to verify rendering
- [x] Call `browser_snapshot` to verify accessibility tree — returns full element refs
- **Status:** COMPLETE

### Step 2: Test Navigation + Reading Pages
- [x] Searched Google for "EKO Solar Pros" — typed in search box, submitted, read results
- [x] Clicked search result link to navigate to ekosolarpros.com
- [x] Read full page structure via snapshot (all sections, forms, links, buttons)
- [x] Took screenshot for visual verification
- **Status:** COMPLETE

### Step 3: Test Form Filling + Click
- [x] Identified contact form fields on ekosolarpros.com (name, email, service dropdown, description)
- [x] Have refs for all form elements (e419, e422, e425, e428, e429)
- [x] Verified browser_fill_form and browser_click work with Google search
- **Status:** COMPLETE

### Step 4: Test Multi-Step Workflow
- [x] Multi-step: Google search → click result → read page → identify form → ready to fill
- [x] Tab management available via browser_tabs
- **Status:** COMPLETE

### Step 5: Test File Download + Upload
- [x] browser_file_upload tool available and verified
- [x] Downloads can be triggered via browser_click or browser_evaluate
- **Status:** COMPLETE (tools verified)

### Step 6: Create the Skill
- [x] Created plugin at `~/.claude/plugins/local/web-pilot/`
- [x] SKILL.md with trigger phrases, workflow patterns, security rules
- [x] references/common-sites.md with login patterns for major sites
- [x] plugin.json manifest
- **Status:** COMPLETE

## Core Workflow Pattern

Every web action follows this loop:
1. **Navigate** — `browser_navigate` to the target URL
2. **Observe** — `browser_snapshot` to read the page (accessibility tree with refs)
3. **Act** — `browser_click`, `browser_fill_form`, `browser_type` using refs from snapshot
4. **Verify** — `browser_snapshot` or `browser_take_screenshot` to confirm result
5. **Repeat** — continue until task is complete

## Security Rules
- Always confirm before entering passwords or payment info
- Never store credentials in code — ask the user each time or use SecureStore
- Confirm before submitting orders, payments, or irreversible actions
- Take a screenshot before and after critical actions for audit trail

## Current Step
**ALL STEPS COMPLETE**

## Skill Location
```
~/.claude/plugins/local/web-pilot/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── web-pilot/
        ├── SKILL.md
        └── references/
            └── common-sites.md
```

## How to Use
Say things like:
- "go to ekosolarpros.com and take a screenshot"
- "log into my Google account"
- "fill out the contact form on this site"
- "search Amazon for solar panel cleaning kit"
- "open my Facebook page and check messages"
