export function isManualEditKey(key: string, modifier = false) {
  if (modifier) return ["v", "x", "z", "y"].includes(key.toLowerCase());
  return key.length === 1 || ["Backspace", "Delete", "Process", "Unidentified"].includes(key);
}
