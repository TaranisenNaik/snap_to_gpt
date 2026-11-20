# Snap to ChatGPT (Chrome extension)

Opens ChatGPT in Chrome's side panel and sends it a screenshot of the page you're working on.
The screenshot only ever contains the page area. The side panel is never in it, even when it's already open.

## Install
1. Unzip this folder.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `snap-to-chatgpt` folder.
4. Log in to ChatGPT once at https://chatgpt.com in a normal tab. The side panel uses the same login.

## Shortcuts
| Shortcut | What it does |
|---|---|
| **Ctrl+Shift+S** | **Ask:** screenshots the page, opens ChatGPT in the side panel, attaches the image and sends it with your **default prompt** |
| **Ctrl+Shift+H** | **Pick prompt:** screenshots the page, opens ChatGPT, attaches the image and leaves the input box **empty and focused**, with a scrollable list of your past prompts above it (newest at the bottom) |
| **Ctrl+Shift+Y** | **Send selection:** pastes the text you've selected on the page into ChatGPT and sends it (no screenshot). Works in PDFs too: the extension presses Ctrl+C for you |

You can change the shortcuts at `chrome://extensions/shortcuts`. On a Mac, Ctrl becomes Command (Cmd+Shift+S / Cmd+Shift+H).

### In the prompt picker
- **↑ / ↓** step through past prompts. Each one fills the input box; going below the newest clears the box.
- **Enter** sends. The prompt is saved to history and the message goes out once the image upload finishes.
- **Esc** hides the list. Click a prompt to fill the box, or double-click it to send right away.
- Type anything to write a new prompt. It gets saved to the list when you send it.

Clicking the toolbar icon just opens the side panel.

## Settings (right-click the icon → Options, or ⚙ in the panel)
- The default prompt for the Ask shortcut

- New chat for every screenshot on/off
- View, add or delete saved prompts

## Notes
- Chrome won't take screenshots of `chrome://` pages, the Chrome Web Store or other extensions' pages. On those pages the panel shows an error.
- ChatGPT normally blocks being shown inside a frame. The extension removes those blocking headers **only for the side panel frame**, so your normal chatgpt.com tabs aren't affected.
- The extension finds ChatGPT's input box and Send button by their page markup. If OpenAI changes the site and something stops working, the selectors to update are at the top of `content.js` (`getEditor`, `SEND_SELECTORS`).
- If the side panel was already open, Chrome may leave keyboard focus on the page. If so, click once in the ChatGPT input.


## Feedback
Bug reports, feedback and feature ideas: naiktaranisen07@gmail.com

Made with ❤ from India 🇮🇳

- In PDFs, Chrome briefly shows a "Snap to ChatGPT started debugging this browser" bar when you use Ctrl+Shift+Y. That's Chrome's notice that the extension pressed Ctrl+C for you; it closes on its own.
