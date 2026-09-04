export interface ShortcutResult {
  pending?: boolean;
  cancelled?: boolean;
  error?: string;
  accelerator?: string;
}

export const DEFAULT_SHORTCUT = "CommandOrControl+Shift+L";
const modifierKeys = new Set(["Meta", "Control", "Alt", "Shift"]);

export function display(shortcut: string | null): string {
  if (!shortcut) return "Disabled";
  const symbols: Record<string, string> = {
    CommandOrControl: "⌘",
    Command: "⌘",
    Control: "⌃",
    Alt: "⌥",
    Shift: "⇧",
    Space: "Space",
    Return: "↩",
    Up: "↑",
    Down: "↓",
    Left: "←",
    Right: "→"
  };
  return shortcut.split("+").map((part) => symbols[part] || part).join("");
}

export function acceleratorFromEvent(event: KeyboardEvent): ShortcutResult {
  if (modifierKeys.has(event.key)) return { pending: true };
  if (event.key === "Escape") return { cancelled: true };

  let key = "";
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
  else if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.code)) key = event.code;
  else key = ({
    Space: "Space",
    Enter: "Return",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right"
  } as Record<string, string>)[event.code] || "";

  if (!key) return { error: "Use a letter, number, function key, arrow, Space, Return, Tab, or Delete." };
  const modifiers: string[] = [];
  if (event.metaKey) modifiers.push("Command");
  if (event.ctrlKey) modifiers.push("Control");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (!modifiers.some((modifier) => ["Command", "Control", "Alt"].includes(modifier)) && !key.startsWith("F")) {
    return { error: "Include Command, Control, or Option so normal typing is not captured." };
  }
  return { accelerator: [...modifiers, key].join("+") };
}
